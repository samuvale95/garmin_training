#!/bin/bash
# Run every minute by passo-autodeploy.timer: deploys origin/development when it moves.
# A commit whose build failed is not retried until a newer commit lands (or you run
# deploy.sh by hand), so a broken push does not rebuild in a loop on the old CPU.
#
# The timer runs this file from /opt/passo/repo, so that checkout must always contain
# it: it only moves to commits that still ship these scripts. The deploy logic itself
# comes from the commit being deployed (falling back to the checkout's copy).
set -uo pipefail
BASE=/opt/passo
REPO="$BASE/repo"
BRANCH="${PASSO_BRANCH:-development}"
SCRIPTS=deploy/homeserver

REMOTE="$(git -C "$REPO" ls-remote origin "refs/heads/$BRANCH" | cut -f1)"
[ -n "$REMOTE" ] || { echo "Cannot reach GitHub"; exit 0; }
[ "$REMOTE" = "$(cat "$BASE/deployed-sha" 2>/dev/null)" ] && exit 0
[ "$REMOTE" = "$(cat "$BASE/failed-sha" 2>/dev/null)" ] && exit 0

git -C "$REPO" fetch -q origin "$BRANCH"
DEPLOY="$(mktemp)"
trap 'rm -f "$DEPLOY"' EXIT
git -C "$REPO" show "$REMOTE:$SCRIPTS/deploy.sh" > "$DEPLOY" 2>/dev/null || cp "$REPO/$SCRIPTS/deploy.sh" "$DEPLOY"

if bash "$DEPLOY" "$REMOTE"; then
  rm -f "$BASE/failed-sha"
  if git -C "$REPO" cat-file -e "$REMOTE:$SCRIPTS/autodeploy.sh" 2>/dev/null; then
    git -C "$REPO" checkout -q --detach "$REMOTE"
  fi
else
  echo "$REMOTE" > "$BASE/failed-sha"
  echo "Deploy of ${REMOTE:0:8} FAILED; still serving $(cut -c1-8 "$BASE/deployed-sha" 2>/dev/null)"
  exit 1
fi
