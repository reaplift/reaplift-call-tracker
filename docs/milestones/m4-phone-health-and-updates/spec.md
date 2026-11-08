# M4. Phone health and app updates

- Status: Not started
- Owner: unassigned
- Starts after: M1
- External prerequisites: E1 (test phones)

## Outcome

The panel's Phones page shows, for every employee, whether their phone is healthy: last check-in, last sync, app version, battery saving, permissions, company SIM present, calls waiting to send, default dialer. A phone that goes quiet or loses a permission is flagged and the admin and manager are emailed. The app updates itself when a new APK is published, and the employee can add a note to a call right after it ends.

## Flow diagram

```mermaid
flowchart TD
  A["App: check-in every 15 minutes"] --> B["POST /device/v1/checkin"]
  B --> C{"Healthy?"}
  C -- "yes" --> D["Phones page: green"]
  C -- "permission lost, battery saving on,<br/>SIM missing, calls waiting" --> E["Amber with the reason"]
  F["No check-in for 2 hours"] --> G["Red: Not syncing"]
  E --> H["Email to admin and manager (M3's outbox)"]
  G --> H
  I["Admin uploads a new APK"] --> J["App sees it in /device/v1/config"]
  J --> K["Downloads, checks SHA-256,<br/>asks the employee to install"]
  K -- "older than min supported" --> L["Sync paused until updated"]
  M["Call ends"] --> N["Notification: 'Add a note?'"]
  N --> O["PATCH note"]
```

## Worked example

Asha turns on her Oppo's battery saver at 13:00. Her 13:15 check-in reports it; the Phones page shows "Battery saving on" in amber and Vikram gets an email. Imran's phone is switched off overnight: at 02:00 it shows "Not syncing since 00:00" in red, and an email goes once, not every 15 minutes. Version 1.3 is published; Ravi's app downloads it and shows "Update ready"; he taps Install.

## Scope

In: check-ins, the Phones page and health rules, alert emails (deduplicated: one per problem until fixed), app releases and self-update (`REQUEST_INSTALL_PACKAGES`, SHA-256 check, minimum supported version), the note after a call, more brand guides, and the setup screen's device summary (brand, Android version, dialer) for the phone survey (E2).

Out: recording status (M6).

## Tasks

| Task | Name |
| --- | --- |
| 4.1 | Check-in endpoint, `device_checkins`, retention of 30 days |
| 4.2 | Health rules and the Phones page |
| 4.3 | Health alert emails, deduplicated |
| 4.4 | App releases: upload, `/device/v1/config` version, in-app update |
| 4.5 | Note after a call |
| 4.6 | Brand guides for any brand found in the phone survey |

## Data and API

Migration: `device_checkins`, `app_releases`, `devices.last_checkin_at`, `calls.note`. Settings: `CHECKIN_SILENT_MINUTES` (120).

## Open questions

- Should a manager be able to revoke a phone, or admins only? Default: admins only.

## Demo (milestone acceptance)

On each test phone: turn on battery saving, revoke the call-log permission, remove the SIM, switch the phone off; each shows on the Phones page with the right reason and one email. Publish a new version; the phone updates without losing pairing. Add a note after a call; it shows in call history.
