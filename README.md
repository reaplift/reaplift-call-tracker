# ReapLift Call Tracker

Call history and call reports for ReapLift's employees, from an Android app that syncs calls on their company SIMs (and, from M6, the phone's call recordings). ReapLift's CRM reads the data through our API.

Start with [docs/project-tracker.md](docs/project-tracker.md). The design is in [docs/requirements-and-hld.md](docs/requirements-and-hld.md), and the build-versus-Callyzer costs are in [docs/cost-comparison.md](docs/cost-comparison.md).

## Run it locally (Mac)

Needs Node 22+, pnpm 10, Docker. Ports are 5433 (database), 3100 (server) and 5174 (panel), so `reaplift-bsp` can run at the same time.

```bash
cp .env.example .env
pnpm install
pnpm db:up
pnpm migrate
pnpm dev
```

- Server health: http://localhost:3100/healthz
- Panel: http://localhost:5174
- Checks: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:int` (drops its database's schema, so use a separate one:
  `DATABASE_URL=postgres://calls:calls@localhost:5433/calls_test pnpm test:int`, after
  `docker exec reaplift-calls-postgres-1 psql -U calls -c 'create database calls_test'`)

## Android app

Needs JDK 21 and the Android SDK (platform 36, build-tools 36.0.0, platform-tools). Without Android Studio:

```bash
brew install openjdk@21 android-commandlinetools
export JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
yes | sdkmanager --sdk_root=$ANDROID_HOME --licenses
sdkmanager --sdk_root=$ANDROID_HOME "platforms;android-36" "build-tools;36.0.0" "platform-tools"
echo "sdk.dir=$ANDROID_HOME" > apps/android/local.properties

cd apps/android
./gradlew assembleDebug test lint
```

The debug APK is `apps/android/app/build/outputs/apk/debug/app-debug.apk`. Install it with
`$ANDROID_HOME/platform-tools/adb install -r <apk>` (USB debugging on), or copy it to the phone.
The debug build allows plain http, so it can reach the laptop at `http://<laptop's Wi-Fi address>:3100`
(`ipconfig getifaddr en0`); the phone must be on the same Wi-Fi.
