# M4 test evidence

## After-call pop-up and the app's call history (12 November 2026)

Client's request: a pop-up that opens by itself when a call ends, with ready-made notes and voice typing, and a call history screen like their reference app. App 0.5.0 on the Android 15 emulator (`calls35`, 320 dp wide), local server on MariaDB 11.8.

- **Automated:** server `pnpm test:int` 55 passed (`m4.int.test.ts` adds 2 for ready-made notes: six defaults per company in `/device/v1/config`, admins edit only their own company's); app `test` 31 passed and `lint` passed; panel build and tests passed.
- **Call history** ([screens/call-history.png](screens/call-history.png)): opens first; tabs All, Incoming, Outgoing, Missed (Missed shows missed and rejected); search "99999" narrowed the list to that call; each card shows the number, type, time, talk and ring time, Call, WhatsApp, ▶ Play for an uploaded recording, and "Tap here to add notes". **Found and fixed:** on a 320 dp screen the tab row pushed "Missed" off screen and cut the number; tabs now wrap and the time and duration moved under the name.
- **Pop-up** ([screens/after-call-popup.png](screens/after-call-popup.png)): with "Display over other apps" allowed, an answered call from 9700055555 ended on the home screen and the pop-up "Last call details" opened by itself (`topResumedActivity=…AfterCallActivity`) with the number, Incoming, 11 s (rang 4 s), Call, WhatsApp, the six outcomes and the note box. Interested was chosen, "/" typed in the note brought up the ready-made notes, "Site visit planned" picked, Tomorrow chosen, Save & exit. The server row:

  ```
  number       | type     | talk | outcome    | note               | follow_up_at            | commented_at
  919700055555 | incoming | 11   | Interested | Site visit planned | 2026-11-12 18:00:00.000 | 2026-11-12 03:00:59.621
  ```

  The pop-up closed to the home screen and no "How did the call go?" notification was shown for the call (the pop-up handled it).
- **Not run yet:** a personal-SIM call on a dual-SIM phone (the pop-up must close unseen; the emulator has one SIM), voice typing (the emulator has no speech service), Save & call again opening the dialer, and the panel's Settings page in a browser (its API is covered by the integration tests).

## Task 4.5: after-call form (11 November 2026)

Built ahead of the rest of M4 on the owner's instruction. Proven on the Android 15 emulator (`calls35`, `sdk_gphone64_arm64`, one SIM, T-Mobile) against a local server on MariaDB 11.8. **Not yet proven on a real phone (E1)**; the Country Roads beta tests it next with app 0.3.0.

### Automated

- Server: `pnpm test:int`, 44 passed, of which `test/m4.int.test.ts` has 8: default outcomes per company; an admin edits only their company's list and the phone sees only active ones; outcome, comment and follow-up saved and shown in `/api/calls` and the CSV; `commented=no` lists placed or answered calls only (missed calls are not asked about); a comment can be changed; `CALL_NOT_SYNCED` for a call not yet on the server; empty forms, switched-off outcomes and another company's outcomes refused; a phone comments only on its own calls.
- App: `./gradlew assembleDebug test lint` passed; `CommentSyncTest` (6): which calls get a notification (placed or answered, since pairing, within 6 hours), sending in order, keeping comments the server cannot take yet, dropping refused ones, nothing lost offline, the JSON sent, reading outcomes from config.

### On the emulator

1. **Upgrade from 0.2.0 kept everything.** App 0.2.0 (built from commit 0634929) was paired to the local server and synced an answered call; 0.3.0 was installed over it with `adb install -r`. The phone database moved from version 1 to 2 with no crash (`logcat -b crash` empty); pairing, tracking and every call were kept, and the home screen showed "Needs a comment (5)": this week's placed or answered calls, no missed ones.
2. **Notification after a call.** An answered incoming call from 9845012345 (`adb emu gsm call / accept / cancel`) gave the notification "How did the call go? Incoming call with +91 98450 12345. Tap to add the outcome and a comment." Tapping it opened the form for that call ([screens/after-call-form.png](screens/after-call-form.png)) with the company's six outcomes from the server, and the notification cleared.
3. **Found and fixed:** only the small radio circle was tappable, so tapping the words "Interested" or "Tomorrow" saved the comment with no outcome or follow-up. The whole row is now the tap target.
4. **From the needs-comment list**, after the fix: "Call back later", comment "Asked for price list", follow-up "In 3 days". The server row:

   ```
   device_call_id | number       | outcome         | note                 | follow_up_at            | commented_at
   9              | 919900011111 | Call back later | Asked for price list | 2026-11-13 18:00:00.000 | 2026-11-11 07:27:15.755
   ```

   (The emulator runs on US Pacific time, so 10:00 there is 18:00 UTC; an Indian phone gives 10:00 IST.)
5. The panel's `/api/calls?commented=yes` returned the call with its outcome and comment; `commented=no` returned the 5 still waiting.

### Notes

- With two or more after-call notifications, Android groups them; tapping the collapsed group opens the app's home screen (whose "Needs a comment" list has every call), and tapping one notification in the expanded group opens that call's form.
- Not run yet: a real phone (E1), an outgoing call that connects (the emulator cannot answer one), the panel's outcome editor (API only so far).
