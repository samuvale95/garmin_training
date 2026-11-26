#!/bin/bash
# Run every minute by passo-autodeploy.timer: deploys origin/development when it moves.
# A commit whose build failed is not retried until a newer commit lands (or you run
# deploy.sh by hand), so a broken push does not rebuild in a loop on the old CPU.
set -uo pipefail
BASE=/opt/passo
BRANCH="${PASSO_BRANCH:-development}"
REMOTE="$(git -C "$BASE/repo" ls-remote origin "refs/heads/$BRANCH" | cut -f1)"
[ -n "$REMOTE" ] || { echo "Cannot reach GitHub"; exit 0; }
[ "$REMOTE" = "$(cat "$BASE/deployed-sha" 2>/dev/null)" ] && exit 0
[ "$REMOTE" = "$(cat "$BASE/failed-sha" 2>/dev/null)" ] && exit 0
# Run this commit's own deploy scripts (they live in the repo too).
git -C "$BASE/repo" fetch -q origin "$BRANCH" && git -C "$BASE/repo" checkout -q --detach "$REMOTE"
if "$BASE/repo/deploy/homeserver/deploy.sh" "$REMOTE"; then
  rm -f "$BASE/failed-sha"
else
  echo "$REMOTE" > "$BASE/failed-sha"
  echo "Deploy of ${REMOTE:0:8} FAILED; still serving $(cat "$BASE/deployed-sha" 2>/dev/null | cut -c1-8)"
  exit 1
fi
