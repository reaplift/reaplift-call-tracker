# M0 test evidence

Run on 7 November 2026 on the owner's Mac (macOS 26.5, Apple silicon), Node 26.11, pnpm 10.28, Docker, JDK 21.0.13 (Homebrew `openjdk@21`), Android SDK platform 36 and build-tools 36.0.0. Nothing committed yet, so no commit hash.

## Server, panel, shared

```bash
pnpm install
pnpm lint          # no output: clean
pnpm typecheck     # packages/shared, apps/web, apps/server: Done
pnpm test          # apps/web: 2 passed; apps/server: 7 passed (healthz 4, config 3)
pnpm build         # apps/web built; apps/server Done
```

## Database and migrations

```bash
cp .env.example .env
pnpm db:up
pnpm migrate       # "applied":["0001_init.sql"]
pnpm migrate       # "applied":[]   (second run changes nothing)
docker exec reaplift-calls-postgres-1 psql -U calls -c 'create database calls_test'
DATABASE_URL=postgres://calls:calls@localhost:5433/calls_test pnpm test:int   # Tests 1 passed
```

## `/healthz`

```bash
cd apps/server && npx tsx --env-file-if-exists=../../.env src/main.ts &
curl -s localhost:3100/healthz
```

```json
{"status":"ok","version":"dev","db":"ok"}
```

## Android

```bash
cd apps/android
./gradlew assembleDebug test lint --console=plain
```

`BUILD SUCCESSFUL`; `HealthCheckTest`: tests="5" failures="0" errors="0"; `app-debug.apk` built (about 30 MB, debug build).

## Not run yet

- Demo step 2: the debug APK on a real phone reaching the laptop's `/healthz` (needs a test phone, E1).
- Demo step 3: CI on GitHub (the repo is not on GitHub yet; `.github/workflows/ci.yml` runs on pull requests and pushes to `main`, and the work branch is added once named).
