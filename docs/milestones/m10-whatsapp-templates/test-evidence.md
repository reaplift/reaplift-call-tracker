# M10 test evidence: WhatsApp message templates

Built 13 November 2026 (commit below), app 0.6.0. Run on the Android 15 emulator (`calls35`, 320 × 640) against a local server and the panel in headless Chrome. **Still to do on real phones:** a real WhatsApp and WhatsApp Business (the emulator has neither; see step 6).

## Automated tests

| Where | Tests | What they prove |
| --- | --- | --- |
| `apps/server/test/m10.int.test.ts` | 5 | Admins add, edit and switch off templates; managers and other companies can't; bad blank names refused; phones get only active templates plus the employee and company names; the send log is kept once per send, linked only to the phone's own call, shown in call history and the CSV; nothing kept for a never-record number |
| `apps/server/test/templates.test.ts` | 4 | The shared blank rules: listing, labels, invalid names, filling with gaps left visible, Unicode |
| `apps/android/.../WhatsAppTest.kt` | 5 | The app's blank rules match the server's; the log uploads 50 at a time, drops rejected sends, keeps everything offline |
| `apps/server/test/m12.int.test.ts` (new case) | 1 | App 0.6.0's version and calling app headers update the phone's record; bad values ignored; the Employees page shows them |

Totals at this commit: 99 server integration, 53 unit, 44 Android unit tests; lint and typecheck clean.

## End-to-end run on the emulator

Setup: local server on port 3100 (`adb reverse tcp:3100 tcp:3100`, because the emulator couldn't reach 10.0.2.2 that night), dev company "ReapLift (dev)", employee Ravi Kumar, app 0.6.0 debug installed over 0.5.0. Two templates added as the admin through the API: "Follow-up" (`{{name}}`, `{{employee_name}}`, `{{company_name}}`, `{{follow_up_date}}`, `{{site_name}}`) and "Welcome".

1. **Phone status.** Status tab → Sync now. The server's record for the phone changed from app 0.2.0 to **0.6.0** and calling app **com.google.android.dialer** (the emulator's dialer is Google Phone). The Status tab shows "Recordings can't be uploaded from Google Phone" with a button to change the phone app (`../m6-call-recordings/screens/status-dialer-warning.png`); the panel's Employees page shows the same warning (`screens/panel-employees.png`).
2. **Call.** `adb emu gsm call 9845022222`, accepted, 14 seconds, ended. The after-call pop-up opened (`screens/app-1-popup.png`).
3. **WhatsApp → templates.** The pop-up's WhatsApp button opened "Send on WhatsApp" with both templates, "Open chat without a template" and Cancel (`screens/app-2-templates.png`).
4. **Fill.** "Follow-up" asked for exactly the three blanks the app couldn't fill for an unsaved number: Client's name, Follow-up date (none picked), Site name, each "Needed before sending". Typed Asha, 14 Nov, Kondapur plot (`screens/app-3-fill.png`).
5. **Check.** "Hi Asha, this is Ravi Kumar from ReapLift (dev). Thanks for your time today. I'll call you on 14 Nov about Kondapur plot." To +91 98450 22222 · Follow-up (`screens/app-4-check.png`).
6. **WhatsApp not installed.** Send on WhatsApp → "WhatsApp is not installed"; the pop-up stayed open and nothing was logged (`screens/app-5-not-installed.png`). Then a test stand-in app with WhatsApp's package name (`com.whatsapp`, built only for this test, never shipped) was installed on the emulator to receive the chat link.
7. **WhatsApp opens.** Send on WhatsApp → the stand-in received `chat=919845022222 text=Hi Asha, this is Ravi Kumar from ReapLift (dev). Thanks for your time today. I'll call you on 14 Nov about Kondapur plot.` (logcat `WaStub`; `screens/app-6-whatsapp-opened.png`).
8. **Log reached the server.** `POST /device/v1/message-sends` → 200. `GET /api/calls` for that day: the call `919845022222 incoming` has `whatsapp: [{ title: "Follow-up", sentAt: … }]`. The panel's Call history shows a green "Follow-up" tag in the WhatsApp column (`screens/panel-call-history.png`).
9. **Panel Settings.** The templates list and the editor with blank buttons, a custom blank and the live preview, where the employee-filled blank stays highlighted (`screens/panel-settings-list.png`, `screens/panel-settings-edit.png`).

## Still to check on real phones

- WhatsApp and WhatsApp Business installed (Business is preferred when both are), the chat opening with the text, on a Vivo, an OPPO and a TECNO.
- A saved contact's name pre-filled in "Client's name".
- Telugu or Hindi text arriving intact in WhatsApp.
