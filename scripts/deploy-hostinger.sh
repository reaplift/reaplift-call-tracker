#!/usr/bin/env bash
# Deploys the server and panel to callit.reaplift.com on Hostinger shared hosting (D10; P1.6, then M7).
#
#   scripts/deploy-hostinger.sh            build, upload a new release, migrate, switch, restart, check /healthz
#   scripts/deploy-hostinger.sh rollback   switch back to the previous release
#
# Layout on the server (home folder of the Hostinger account):
#   callit-app/.env              settings and the database password; written by hand, never by this script
#   callit-app/releases/<id>/    one folder per deploy; the last 5 are kept
#   callit-app/current           link to the live release (LiteSpeed's PassengerAppRoot)
#   callit-app/apk/latest.apk    the app the install page offers
#   callit-app/logs/             the server's console log
#   domains/reaplift.com/public_html/callit/.htaccess   tells LiteSpeed to run current/start.cjs with Node 22
#
# Settings: DEPLOY_HOST (default u436365342@195.35.47.21), DEPLOY_PORT (65002), DEPLOY_KEY (~/.ssh/hostinger_reaplift).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOST="${DEPLOY_HOST:-u436365342@195.35.47.21}"
PORT="${DEPLOY_PORT:-65002}"
KEY="${DEPLOY_KEY:-$HOME/.ssh/hostinger_reaplift}"
URL="${DEPLOY_URL:-https://callit.reaplift.com}"
HOME_REMOTE="/home/${HOST%%@*}"
APP="$HOME_REMOTE/callit-app"
WEBROOT="$HOME_REMOTE/domains/reaplift.com/public_html/callit"
NODE_BIN="/opt/alt/alt-nodejs22/root/bin"
SSH=(ssh -i "$KEY" -p "$PORT" -o BatchMode=yes "$HOST")

remote() { "${SSH[@]}" "$@"; }

check_health() {
  local body="" host ip resolve=()
  # A Mac that looked the name up before the DNS record existed may still have "not found" cached.
  host="${URL#https://}"; host="${host%%/*}"
  ip="$(dig +short "$host" 2>/dev/null | grep -E '^[0-9.]+$' | head -1 || true)"
  [ -n "$ip" ] && resolve=(--resolve "$host:443:$ip")
  for _ in $(seq 1 20); do
    body=$(curl -fsS "${resolve[@]}" "$URL/healthz" 2>/dev/null || true)
    if echo "$body" | grep -q '"db":"ok"'; then echo "healthy: $body"; return 0; fi
    sleep 3
  done
  echo "NOT healthy: ${body:-no answer}"; return 1
}

rollback() {
  remote "set -e; cd $APP
    prev=\$(ls -1d releases/*/ | sed 's#/\$##' | sort | tail -2 | head -1)
    now=\$(readlink current)
    [ -n \"\$prev\" ] && [ \"\$prev\" != \"\$now\" ] || { echo 'no earlier release'; exit 1; }
    ln -sfn \"\$prev\" current.new && mv -T current.new current
    mkdir -p current/tmp && touch current/tmp/restart.txt
    echo \"now on \$prev (was \$now)\""
  check_health
}

deploy() {
  cd "$ROOT"
  [ -z "$(git status --porcelain)" ] || echo "warning: uncommitted changes are included in this build"
  local id
  id="$(date -u +%Y%m%d%H%M%S)-$(git rev-parse --short HEAD)"

  echo "== build $id"
  pnpm --filter @reaplift/calls-shared build >/dev/null
  rm -rf apps/server/dist && pnpm --filter @reaplift/calls-server build >/dev/null
  pnpm --filter @reaplift/calls-web build >/dev/null

  local stage
  stage="$(mktemp -d)/release"
  mkdir -p "$stage/shared"
  cp -R apps/server/dist "$stage/dist"
  cp -R packages/shared/dist "$stage/shared/dist"
  cp packages/shared/package.json "$stage/shared/package.json"
  cp -R apps/web/dist "$stage/panel"
  cp -R db/migrations "$stage/migrations"
  cp scripts/hostinger/start.cjs "$stage/start.cjs"
  echo "{\"version\":\"$id\"}" > "$stage/release.json"
  # The server's runtime dependencies, with the shared package from the release folder.
  node -e '
    const p = require("./apps/server/package.json");
    const deps = { ...p.dependencies, "@reaplift/calls-shared": "file:./shared" };
    console.log(JSON.stringify({ name: "reaplift-calls-release", private: true, type: "module", dependencies: deps }, null, 2));
  ' > "$stage/package.json"

  echo "== upload"
  remote "mkdir -p $APP/releases/$id $APP/apk $APP/logs"
  rsync -az --delete -e "ssh -i $KEY -p $PORT -o BatchMode=yes" "$stage/" "$HOST:$APP/releases/$id/"

  echo "== install, migrate, switch"
  remote "set -e; export PATH=$NODE_BIN:\$PATH; cd $APP/releases/$id
    npm install --omit=dev --no-audit --no-fund --loglevel=error >/dev/null
    MODE=migrate node start.cjs
    cd $APP
    # The first deploy replaces the P1.6 test app's folder with the release link.
    if [ -d current ] && [ ! -L current ]; then mv current releases/00000000000000-p1.6-check; fi
    ln -sfn releases/$id current.new && mv -T current.new current
    mkdir -p current/tmp && touch current/tmp/restart.txt
    ls -1d releases/*/ | sort | head -n -5 | xargs -r rm -rf
    cat > $WEBROOT/.htaccess <<'HTACCESS'
# callit.reaplift.com: the ReapLift call tracker (Node.js via LiteSpeed, as billit.reaplift.com runs).
# Written by scripts/deploy-hostinger.sh; settings live in ~/callit-app/.env.
PassengerAppRoot $APP/current
PassengerAppType node
PassengerNodejs $NODE_BIN/node
PassengerStartupFile start.cjs
PassengerBaseURI /
PassengerRestartDir $APP/current/tmp
SetEnv LSNODE_CONSOLE_LOG $APP/logs/console.log
HTACCESS"

  echo "== check $URL"
  check_health
}

case "${1:-deploy}" in
  deploy) deploy ;;
  rollback) rollback ;;
  *) echo "usage: scripts/deploy-hostinger.sh [deploy|rollback]"; exit 1 ;;
esac
