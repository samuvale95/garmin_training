#!/bin/bash
# One-time setup, run on the server with sudo:
#   sudo bash /opt/passo/repo/deploy/homeserver/install.sh
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
install -m 440 "$DIR/passo-deploy.sudoers" /etc/sudoers.d/passo-deploy
visudo -cf /etc/sudoers.d/passo-deploy
cp "$DIR"/passo-*.service "$DIR"/passo-*.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now passo-autodeploy.timer passo-agents-cron.timer
systemctl enable passo-api passo-web
# First release (later ones come from the timer).
sudo -u samu -H env PATH="/home/samu/.local/bin:$PATH" /opt/passo/repo/deploy/homeserver/deploy.sh
echo "OK: auto-deploy attivo"
