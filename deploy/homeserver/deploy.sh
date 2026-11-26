#!/bin/bash
# Builds a commit into its own release directory and switches to it only once the build
# has succeeded, so a broken push never takes the running app down.
#
#   /opt/passo/repo/deploy/homeserver/deploy.sh [git-ref]   (default: origin/development)
#
# Layout on the server:
#   /opt/passo/repo            bare-ish clone used only to fetch and export commits
#   /opt/passo/releases/<sha>  one directory per deployed commit (code, .venv, web/.next)
#   /opt/passo/current         symlink to the live release (what the systemd units run)
#   /opt/passo/{api,web}.env   secrets, never in git
set -euo pipefail

BASE=/opt/passo
BRANCH="${PASSO_BRANCH:-development}"
REF="${1:-origin/$BRANCH}"
UV="$HOME/.local/bin/uv"
KEEP=3

exec 9>"$BASE/deploy.lock"
flock -n 9 || { echo "Another deploy is running"; exit 0; }

cd "$BASE/repo"
git fetch -q origin "$BRANCH"
SHA="$(git rev-parse "$REF")"
REL="$BASE/releases/$SHA"
CURRENT="$(readlink -f "$BASE/current" 2>/dev/null || true)"

if [ "$CURRENT" = "$REL" ]; then
  echo "$SHA" > "$BASE/deployed-sha"
  echo "Already live: ${SHA:0:8}"
  exit 0
fi

echo "Building ${SHA:0:8} ($(git log -1 --format=%s "$SHA"))"
rm -rf "$REL.tmp"
mkdir -p "$REL.tmp"
git archive "$SHA" | tar -x -C "$REL.tmp"

# Backend: its own venv, so the running API never sees half-installed packages.
"$UV" venv -q --python 3.13 "$REL.tmp/.venv"
VIRTUAL_ENV="$REL.tmp/.venv" "$UV" pip install -q "$REL.tmp"

# Frontend: reuse the live node_modules when the lockfile has not changed.
cd "$REL.tmp/web"
if [ -n "$CURRENT" ] && cmp -s package-lock.json "$CURRENT/web/package-lock.json"; then
  cp -al "$CURRENT/web/node_modules" node_modules
else
  npm ci --no-audit --no-fund --silent
fi
set -a; . "$BASE/web.env"; set +a
GIT_COMMIT="$SHA" npm run build

mv "$REL.tmp" "$REL"
ln -sfn "$REL" "$BASE/current.new" && mv -T "$BASE/current.new" "$BASE/current"
sudo /usr/bin/systemctl restart passo-api passo-web

# Wait for both to answer before calling it done.
for i in $(seq 1 30); do
  if curl -sf -o /dev/null http://127.0.0.1:8000/health && curl -sf -o /dev/null http://127.0.0.1:3000/login; then
    echo "$SHA" > "$BASE/deployed-sha"
    echo "Live: ${SHA:0:8}"
    break
  fi
  sleep 2
done
[ -f "$BASE/deployed-sha" ] && [ "$(cat "$BASE/deployed-sha")" = "$SHA" ] || { echo "Health check failed for ${SHA:0:8}"; exit 1; }

# Keep the last few releases for a quick manual rollback (ln -sfn + restart).
cd "$BASE/releases"
ls -1t | grep -v '\.tmp$' | tail -n +$((KEEP + 1)) | while read -r old; do
  [ "$BASE/releases/$old" != "$REL" ] && rm -rf "$old"
done
