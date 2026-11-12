# M6 test evidence

## 11 November 2026: recordings built and run end to end on the emulator

Android 15 emulator (`calls35`, `sdk_gphone64_arm64`), app 0.4.0 (debug), local server on MariaDB 11.8, and SeaweedFS 3.80 as the S3-compatible stand-in for Cloudflare R2 (same S3 protocol; MinIO no longer publishes community images). **Not yet run against R2 itself (waits on E6 keys) or on a real phone's dialer (E1, T4).**

### Automated

- Server `pnpm test:int`: 53 passed. `test/m6.int.test.ts` (9): 15-minute upload link under `c1/2026/11/<call id>-<random>.m4a`; "complete" refused until the file is in storage, then `uploaded` with its real size; a second "complete" is harmless and a second upload is refused; unknown call, non-audio type and oversized files refused; a phone cannot upload for another phone's call; missing recordings flagged, shown and filterable, and never overwrite an upload; a 5-minute play link with an audit row; another company gets 404; 410 after 365 days (D4); 503 when storage is not configured.
- App `./gradlew assembleDebug test lint`: 31 passed. `RecordingSyncTest` (9): the matcher scores time, length and number; a 40-second voice note is not taken for a 3-minute call; the best unused file wins and none is used twice; waits for the dialer to save, then reports missing after 10 minutes and tells the employee; only the call's window is searched; short and missed calls are not expected to have one; nothing is lost when offline, not configured or unpaired.

### On the emulator

1. **Upgrade 0.3.0 → 0.4.0** kept pairing and calls (phone database version 3). The home screen showed **"Allow call recordings"**; tapping Allow raised Android's "Allow ReapLift Calls to access music and audio?"; after Allow, `READ_MEDIA_AUDIO: granted=true` and the card went away.
2. **A 19-second answered call** from 9845099999 (`adb emu gsm call / accept / cancel`). Then, as a dialer would, a 20-second AAC file `Call recording 9845099999_20261112.m4a` was saved in `Recordings/Call/` and indexed (`relative_path=Recordings/Call/, duration=20160`).
3. **Without touching the phone**, the sync the tracking service schedules 30 seconds after a call found and uploaded it:

   ```
   device_call_id | number       | talk | status   | size_bytes | audio_seconds | mime_type | match_score | object_key
   11             | 919845099999 | 19   | uploaded | 39629      | 20            | audio/mp4 | 100         | c1/2026/11/11-55ebb4ded9a15080.m4a
   10             | 919845012345 | 9    | missing  |            |               |           |             |
   9              | 919900011111 | 7    | missing  |            |               |           |             |
   ```

   Calls 9 and 10 (no file on the phone, more than 10 minutes old) were flagged missing, and the phone showed **"Call recording missing — No recording was found for your call with +91 98450 12345. Turn on automatic call recording in your Phone app's settings."** Calls older than 3 days were not looked at (first-run look-back).
4. **Panel:** `/api/calls?recording=yes` listed the call with `recording = uploaded`; `/api/calls/<id>/recording` gave a signed link; the file downloaded through it (200, 39629 bytes) was **identical to the original** (same SHA-1). Audit: `recording.uploaded`, then `recording.played`.
5. The phone's home screen shows "Recording sent" on the call ([screens/phone-recording-status.png](screens/phone-recording-status.png)).

### Not run yet

- R2 itself (needs the four `S3_*` settings on the server, E6), including R2's lifecycle rules (Infrequent Access after 30 days, delete after 365).
- Real dialers: where Vivo, Samsung and Oppo save, and whether their files are in the media index (T4); a dual-SIM phone's personal-SIM recordings must never be uploaded (they match no company-SIM call).
- The panel's play button in a browser against R2 (the API and the downloaded bytes were checked).
