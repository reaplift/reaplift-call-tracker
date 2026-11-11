# ReapLift Call Tracker

Call history and call reports for ReapLift's employees, from an Android app that syncs calls on their company SIMs (and, from M6, the phone's call recordings). ReapLift's CRM reads the data through our API.

Start with [docs/project-tracker.md](docs/project-tracker.md). The design is in [docs/requirements-and-hld.md](docs/requirements-and-hld.md), and the build-versus-Callyzer costs are in [docs/cost-comparison.md](docs/cost-comparison.md).

## Run it locally (Mac)

Needs Node 22+, pnpm 10, Docker. Ports are 3307 (MariaDB 11.8, Hostinger's version), 3100 (server) and 5174 (panel), so `reaplift-bsp` can run at the same time.

```bash
cp .env.example .env
pnpm install
pnpm db:up
pnpm migrate
pnpm dev
```

- Server health: http://localhost:3100/healthz
- Panel: http://localhost:5174
- Checks: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:int`. `test:int` drops every table in its database, so
  it uses `TEST_DATABASE_URL` (default: the `calls_test` database that `pnpm db:up` creates), never `DATABASE_URL`.
- Local logins: `pnpm --filter @reaplift/calls-server cli seed-dev` creates company 1, `super@reaplift.local` and
  `admin@reaplift.local` (password `calls-dev-1`).

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
