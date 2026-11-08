#!/usr/bin/env bash
# Runs a test ("pilot") server on this Mac and puts it on the internet through a Cloudflare quick tunnel,
# so testers' phones can reach it before the VPS exists (M7). Owner's choice, 8 November 2026.
#
#   scripts/pilot.sh start     database, build, tunnel, server, and an APK built for the tunnel's address
#   scripts/pilot.sh stop      stops the server and the tunnel
#   scripts/pilot.sh status    is it running, and at which address
#   scripts/pilot.sh admin <email> <name>   creates a panel admin with a random password, printed once
#
# The tunnel's address changes every time it starts, and the APK has the address built in: after a restart,
# testers need the new APK. The Mac must stay on, awake (this script keeps it awake while the server runs,
# but closing the lid still sleeps it unless it is on power with an external display) and online.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOME_DIR="$HOME/.reaplift-calls"
LOGS="$HOME_DIR/logs"
APK_DIR="$HOME_DIR/apk"
PORT=3200
DB_URL="postgres://calls:calls@localhost:5433/calls_pilot"
export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home}"
mkdir -p "$LOGS" "$APK_DIR"

running() { [ -f "$HOME_DIR/$1.pid" ] && kill -0 "$(cat "$HOME_DIR/$1.pid")" 2>/dev/null; }

stop() {
  for p in server tunnel; do
    if running "$p"; then kill "$(cat "$HOME_DIR/$p.pid")" && echo "stopped $p"; fi
    rm -f "$HOME_DIR/$p.pid"
  done
}

status() {
  for p in tunnel server; do running "$p" && echo "$p: running" || echo "$p: stopped"; done
  [ -f "$HOME_DIR/pilot-url" ] && echo "address: $(cat "$HOME_DIR/pilot-url")"
  if [ -f "$HOME_DIR/pilot-url" ]; then curl -fsS "$(cat "$HOME_DIR/pilot-url")/healthz" && echo; fi
}

start() {
  stop >/dev/null
  cd "$ROOT"
  echo "== database"
  pnpm db:up >/dev/null
  until docker exec reaplift-calls-postgres-1 pg_isready -U calls >/dev/null 2>&1; do sleep 1; done
  docker exec reaplift-calls-postgres-1 psql -U calls -tc "select 1 from pg_database where datname = 'calls_pilot'" | grep -q 1 ||
    docker exec reaplift-calls-postgres-1 psql -U calls -c 'create database calls_pilot' >/dev/null
  (cd apps/server && DATABASE_URL="$DB_URL" npx tsx src/main.ts --mode=migrate) | tail -1

  echo "== build server and panel"
  pnpm --filter @reaplift/calls-shared build >/dev/null
  pnpm --filter @reaplift/calls-server build >/dev/null
  pnpm --filter @reaplift/calls-web build >/dev/null

  echo "== tunnel"
  : > "$LOGS/tunnel.log"
  nohup cloudflared tunnel --no-autoupdate --url "http://localhost:$PORT" >>"$LOGS/tunnel.log" 2>&1 &
  echo $! > "$HOME_DIR/tunnel.pid"
  URL=""
  for _ in $(seq 1 60); do
    URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOGS/tunnel.log" | head -1 || true)
    [ -n "$URL" ] && break
    sleep 1
  done
  [ -n "$URL" ] || { echo "the tunnel gave no address; see $LOGS/tunnel.log"; stop; exit 1; }
  echo "$URL" > "$HOME_DIR/pilot-url"
  echo "address: $URL"

  echo "== server"
  (
    cd apps/server
    MODE=api PORT=$PORT LOG_LEVEL=info DATABASE_URL="$DB_URL" APP_VERSION="pilot-$(date +%Y%m%d)" \
      PUBLIC_BASE_URL="$URL" PANEL_ORIGIN="$URL" SESSION_COOKIE_SECURE=true \
      PANEL_DIR="$ROOT/apps/web/dist" APK_DIR="$APK_DIR" \
      nohup caffeinate -i node dist/main.js >>"$LOGS/server.log" 2>&1 &
    echo $! > "$HOME_DIR/server.pid"
  )
  for _ in $(seq 1 30); do curl -fsS "http://localhost:$PORT/healthz" >/dev/null 2>&1 && break; sleep 1; done

  echo "== app for $URL"
  (cd apps/android && ./gradlew assembleRelease -PcallsServerUrl="$URL" --console=plain -q)
  VERSION=$(grep -oE 'versionName = "[^"]+"' apps/android/app/build.gradle.kts | cut -d'"' -f2)
  cp apps/android/app/build/outputs/apk/release/app-release.apk "$APK_DIR/latest.apk"
  cp apps/android/app/build/outputs/apk/release/app-release.apk "$HOME_DIR/ReapLift-Calls-$VERSION.apk"
  echo "APK to share: $HOME_DIR/ReapLift-Calls-$VERSION.apk"

  echo "== waiting for the address to answer from the internet"
  for _ in $(seq 1 60); do curl -fsS "$URL/healthz" >/dev/null 2>&1 && break; sleep 2; done
  status
}

admin() {
  local email="${1:?email}" name="${2:?name}"
  local password
  password=$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-16)
  (cd "$ROOT/apps/server" && printf '%s\n' "$password" | DATABASE_URL="$DB_URL" npx tsx src/cli.ts create-user --email "$email" --name "$name" --role admin)
  echo "password (shown once; change it by creating a new admin if lost): $password"
}

case "${1:-}" in
  start) start ;;
  stop) stop ;;
  status) status ;;
  admin) shift; admin "$@" ;;
  *) echo "usage: scripts/pilot.sh start|stop|status|admin <email> <name>"; exit 1 ;;
esac
