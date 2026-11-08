# M1 test evidence

Run on 8 November 2026 (India time) on the owner's Mac. Nothing committed yet, so no commit hash. Phone runs used the **Android 15 emulator** (`system-images;android-35;google_apis;arm64-v8a`, 320×640 screen, one SIM, "T-Mobile"), because no real phone was available. **The demo on real Samsung, Oppo and Vivo phones (E1), and on a dual-SIM phone with a personal SIM, is still to do; M1 is not Done until it is.**

## Automated checks

```bash
pnpm lint && pnpm typecheck
pnpm test                       # server 32 passed (phone numbers, call filter, access rules, healthz, config); panel 6 passed
DATABASE_URL=postgres://calls:calls@localhost:5433/calls_test pnpm test:int   # 17 passed
pnpm build
cd apps/android && ./gradlew assembleDebug test lint   # BUILD SUCCESSFUL; 16 unit tests; lint: warnings only
```

What the integration test (`apps/server/test/m1.int.test.ts`) proves against PostgreSQL: login and the 24-hour lock after 5 wrong passwords; every panel route needs a login and every phone route a device token (route-walking); company numbers normalised and duplicates refused; install page for a live code, pairing once, expired code refused, APK served; the worked example's calls stored once even when sent twice; future and too-old calls rejected by ID; filters by type, talk time and number; cursor pages; CSV in India time; a revoked phone and an employee marked as left stop syncing.

The **privacy test** is `CallSyncTest.personalSimCallsNeverReachTheOutbox` (apps/android): the worked example's call log with both SIMs mixed; only the four company-SIM rows reach the outbox, and the personal call ("Mom") is never read again. `aRowWithNoSimIsSkippedOnADualSimPhone` covers rows with no SIM.

## Panel in a browser (Playwright, Chromium)

```bash
pnpm migrate && pnpm --filter @reaplift/calls-server cli seed-dev   # admin@reaplift.local / calls-dev-1, employee Ravi Kumar
pnpm dev
```

Logged in, opened Employees, clicked **Pair phone** for Ravi: QR code, code `504 377`, expiry and link shown ([screens/pair-dialog.png](screens/pair-dialog.png)).

## Phone flow on the emulator

`.env`: `PUBLIC_BASE_URL=http://10.0.2.2:3100` (the emulator's address for the laptop), `APK_DIR=../../apk`, `SESSION_COOKIE_SECURE=false`.

1. Opened the install page's link `reaplift-calls://pair?code=504377&server=http://10.0.2.2:3100`: the wizard started at step 1.
2. Consent → **I agree**; permissions: Android asked for call logs, notifications and "make and manage phone calls" (its wording for phone state); battery: "Let app always run in background?" → Allow (`dumpsys deviceidle whitelist` lists `com.reaplift.calls`); SIM: "SIM 1 · T-Mobile, 15551234567" chosen.
3. Pair step showed the code and server filled in from the link ([screens/phone-pair.png](screens/phone-pair.png)); **Connect** paired as Ravi Kumar. The tracking service runs in the foreground with type `specialUse` (`types=0x40000000`).

   ```
    name       | brand  | model              | android_version | sim_slot | sim_carrier | phone_account_id | consent_version
    Ravi Kumar | Google | sdk_gphone64_arm64 | 15              | 0        | T-Mobile    | 1                | 1
   ```

4. Calls simulated with the emulator console (`adb emu gsm call / accept / cancel`):

   ```sql
   select device_call_id, number, type, talk_seconds, ring_seconds, synced_at - started_at as delay from calls order by id;
   ```
   ```
    1 | 919900011111 | outgoing | 0 | 0 | 00:00:03   (test call; the emulator never connected it)
    2 | 919900011111 | incoming | 9 | 7 | 00:00:18   (rang about 6 s, talked about 10 s)
    3 | 918800022222 | missed   | 0 | 8 | 00:00:10   (rang about 8 s)
   ```

   The wizard showed "Test call synced ✓". The panel's Call history listed the three calls ([screens/history.png](screens/history.png)).
5. **No internet**: Wi-Fi and data off, missed call from 9700012345; the server had 0 rows for it; network back on: it arrived at once (`919700012345 | missed | ring 5`).
6. **Reboot**: after `adb reboot` the tracking service was running again without opening the app; an answered call (`919600054321 | incoming | talk 5 | ring 5`) synced. `select count(*), count(distinct device_call_id) from calls` gave `5 | 5`: nothing duplicated.
7. **Unpair** from the panel: the employee shows "Not paired"; a call made afterwards never reached the server (0 rows); the app shows "This phone was unpaired" ([screens/phone-unpaired.png](screens/phone-unpaired.png)) and its service stopped. Audit log: `pairing_code.created`, `device.paired`, `device.revoked`.
8. Installing a new build over the old one kept the app's state.

## Not run yet

- Demo steps 3 to 10 on real phones (E1): setup timed with someone new to it, the dual-SIM privacy check, moving the company SIM to the other slot, and brand guides checked against Samsung, Oppo and Vivo menus (T1 to T3).
- An outgoing call that connects (the emulator cannot answer an outgoing call).
- Release APK signing (task 1.8): needs ReapLift's signing key.
