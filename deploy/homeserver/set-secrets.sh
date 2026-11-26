#!/bin/bash
# Asks for Passo's secrets one at a time and writes them straight to the home server
# (/opt/passo/api.env and /opt/passo/web.env, mode 600). Nothing is saved on this Mac.
# Press Enter on a value to keep what is already there.
#   bash deploy/homeserver/set-secrets.sh
set -euo pipefail
SERVER="${PASSO_SERVER:-samu@192.168.0.177}"

API_KEYS="DATABASE_URL SUPABASE_URL TOKEN_ENCRYPTION_KEY STRAVA_CLIENT_ID STRAVA_CLIENT_SECRET OPENRUTER_API_KEY AGENTS_CRON_SECRET PASSO_ADMIN_USER_IDS PASSO_DIAGNOSTICS_TOKEN"
WEB_KEYS="NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY"

edit_file() { # $1 = remote file, rest = keys
  local file="$1"; shift
  local current; current="$(ssh "$SERVER" "cat $file")"
  local key old val
  for key in "$@"; do
    old="$(printf '%s\n' "$current" | grep -m1 "^$key=" | cut -d= -f2- || true)"
    if [ -n "$old" ]; then hint=" [già impostato, Invio per tenerlo]"; else hint=""; fi
    read -r -s -p "$key$hint: " val; echo
    [ -z "$val" ] && continue
    current="$(printf '%s\n' "$current" | grep -v "^$key=" || true)"$'\n'"$key=$val"
  done
  printf '%s\n' "$current" | ssh "$SERVER" "umask 077; cat > $file.tmp && mv $file.tmp $file"
  echo "→ $file aggiornato"
}

echo "== Backend (valori da Render → Environment) =="
edit_file /opt/passo/api.env $API_KEYS
echo "== Frontend (valori da Vercel → Settings → Environment Variables) =="
edit_file /opt/passo/web.env $WEB_KEYS
echo "Fatto. Torna da Claude e scrivi: segreti inseriti."
