#!/usr/bin/env bash
# Puts the Cloudflare R2 access key and secret into ~/callit-app/.env on Hostinger, without them being shown on screen,
# saved on this Mac, or passed on a command line. Use it again with a new token to replace the keys.
#
#   bash scripts/hostinger/set-r2-keys.sh
set -euo pipefail

HOST="${DEPLOY_HOST:-u436365342@195.35.47.21}"
PORT="${DEPLOY_PORT:-65002}"
KEY="${DEPLOY_KEY:-$HOME/.ssh/hostinger_reaplift}"
ENV_FILE="/home/${HOST%%@*}/callit-app/.env"

read -r -p "R2 Access Key ID: " access_key
read -r -s -p "R2 Secret Access Key (not shown): " secret_key
echo
[[ "$access_key" =~ ^[A-Za-z0-9]+$ ]] || { echo "The Access Key ID should be letters and digits only."; exit 1; }
[[ "$secret_key" =~ ^[A-Za-z0-9]+$ ]] || { echo "The Secret Access Key should be letters and digits only."; exit 1; }

# The keys travel inside the SSH connection's input, never as command-line arguments.
printf '%s\n%s\n' "$access_key" "$secret_key" | ssh -i "$KEY" -p "$PORT" -o BatchMode=yes "$HOST" "
  set -e
  read -r ak; read -r sk
  f='$ENV_FILE'
  grep -q '^S3_ACCESS_KEY_ID=' \"\$f\" || echo 'S3_ACCESS_KEY_ID=' >> \"\$f\"
  grep -q '^S3_SECRET_ACCESS_KEY=' \"\$f\" || echo 'S3_SECRET_ACCESS_KEY=' >> \"\$f\"
  tmp=\$(mktemp)
  awk -v ak=\"\$ak\" -v sk=\"\$sk\" '
    /^S3_ACCESS_KEY_ID=/ { print \"S3_ACCESS_KEY_ID=\" ak; next }
    /^S3_SECRET_ACCESS_KEY=/ { print \"S3_SECRET_ACCESS_KEY=\" sk; next }
    { print }' \"\$f\" > \"\$tmp\"
  cat \"\$tmp\" > \"\$f\" && rm -f \"\$tmp\"
  chmod 600 \"\$f\"
  mkdir -p /home/${HOST%%@*}/callit-app/current/tmp && touch /home/${HOST%%@*}/callit-app/current/tmp/restart.txt
"
unset access_key secret_key
echo "Saved on the server, and the app will restart on its next request. Tell Claude it is done."
