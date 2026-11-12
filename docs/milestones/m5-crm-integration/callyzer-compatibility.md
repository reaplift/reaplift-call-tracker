# Callyzer API v2.3 compatibility

Written 12 November 2026 after reading Callyzer's API reference v2.3 (developers.callyzer.co/v2.3/, one page). The client asked for "an API like Callyzer's" for their own CRM. The owner asked to check compatibility first and, if our data needs no change, add only a request and response translation.

**Result: no change to our tables or report definitions was needed.** Everything Callyzer's call-log API returns, we already store or can work out, except WhatsApp calls, video calls and leads, which we don't track. The translation lives in [`apps/server/src/modules/integration/callyzer.ts`](../../../apps/server/src/modules/integration/callyzer.ts). The only new table is `api_keys` (migration 0007).

## How a CRM switches

| | Callyzer | Ours |
| --- | --- | --- |
| Base URL | `https://api1.callyzer.co/api/v2.3/` | `https://callit.reaplift.com/api/v2.3/` |
| Key | Admin generates it in Callyzer | Admin creates it in our panel, **Settings → API keys for your CRM** (shown once). Or `cli create-api-key --company <id> --name <n>` |
| Header | `Authorization: Bearer <key>` | Same |
| Paths, request fields, response fields | v2.3 | Same names and types (differences below) |
| Rate limit | 1 request every 2 seconds | 5 requests a second per key; 429 with `Retry-After: 1` |
| Answer | `{ "result": ..., "message": "Success" }`, plus `total_records`, `page_no`, `page_size` on lists | Same |
| Error | `{ "result": null, "message": "..." }` | Same; 400 bad request, 401 bad key, 403 company suspended, 429 too many requests |

## Endpoints

| Callyzer endpoint | Ours | Notes |
| --- | --- | --- |
| `POST call-log/summary` | Built | |
| `POST call-log/employee-summary` | Built | Lists every active employee, including those with no calls, busiest first |
| `POST call-log/analysis` | Built | `longest_duration` holds the employee and, inside it, `call_log` |
| `POST call-log/never-attended` | Built | Groups by employee and client |
| `POST call-log/not-pickup-by-client` | Built | Ignores `call_types` (always unanswered outgoing calls) |
| `POST call-log/unique-clients` | Built | |
| `POST call-log/hourly-analytics` | Built | `working_hour_from`/`to` are optional (whole day, 24 slots, if absent) and count in whole hours |
| `POST call-log/daywise-analytics` | Built | Same |
| `POST call-log/history` | Built | |
| `POST call-log/get` | Built | 1 to 20 `unique_ids`; another company's IDs are silently left out |
| `POST call-log/history/stream` | Built | NDJSON, `{"result":{...}}` per line, then `{"type":"END",...}`; at most 100,000 calls per request |
| `GET employee/get` | Built | Also answers POST; filters can be a query string (lists as `a,b`) or a JSON body |
| `DELETE call-log/call-recording/remove` | Not built | Deleting recordings through the API waits for an owner decision; R2 deletes them after 12 months (D4) |
| `lead/*` | Not built | Leads stay in the client's CRM (D1) |
| Webhook | Not built yet | Callyzer's is set up in its dashboard; ours is M5 task 5.4 |

## Request fields

| Field | How we read it |
| --- | --- |
| `call_from`, `call_to` | Unix seconds, both inclusive; on the call's start time |
| `synced_from`, `synced_to` | Unix seconds; on the time the call reached our server |
| (no dates) | Today, India time. Callyzer's docs don't say |
| range | At most 180 days, as Callyzer |
| `call_types` | `Incoming`, `Outgoing`, `Missed`, `Rejected`; any capitalisation accepted |
| `duration_les_than`, `duration_grt_than` | Talk seconds, exclusive bounds |
| `ringing_time_les_than`, `ringing_time_grt_than` | Ringing seconds, exclusive |
| `emp_numbers` | The employee's company SIM, as `91-9876500000`, `9876500000` or `919876500000`. An unknown number is a 400, as Callyzer ("must exist") |
| `emp_tags` | Our **team names**. Unknown team is a 400 |
| `emp_codes`, `emp_name` | `employee/get` only: our employee code and exact name (case ignored) |
| `client_numbers` | Any format; normalised as our numbers are |
| `is_exclude_numbers` | Default true: the company's excluded numbers (panel) are left out |
| `call_method` | `PhoneCall` or absent: all calls. `WhatsAppCall`: none (we don't track WhatsApp). Callyzer requires it; we don't |
| `call_mode` | `Voice` or absent: all calls. `Video`: none. Callyzer requires it; we don't |
| `page_no`, `page_size` | Default 1 and 100; size 1 to 100 |

## Response fields

| Callyzer field | Our source |
| --- | --- |
| `id` | Our call ID, as a string of digits |
| `emp_name`, `emp_code` | Employee's name and code |
| `emp_country_code`, `emp_number` | Company SIM split: `919876500000` → `91`, `9876500000` |
| `emp_tags` | The employee's team names |
| `client_name` | Contact name the phone has for the number; `Private number` for a hidden caller; else empty |
| `client_country_code`, `client_number` | The number, split the same way (non-Indian numbers keep all digits, with an empty code) |
| `duration` | Talk seconds |
| `call_type` | `Incoming`, `Outgoing`, `Missed`, `Rejected` |
| `call_date`, `call_time` | Start time in India time, `yyyy-mm-dd` and `HH:mm:ss` |
| `note` | The after-call comment |
| `call_recording_url` | A link to the recording that **works for 24 hours**; ask again for a new one. `null` when there is none, or after 12 months. Callyzer's links look permanent: a CRM must not store ours |
| `crm_status` | The after-call outcome (for example `Interested`) |
| `reminder_date`, `reminder_time` | The follow-up date, India time |
| `synced_at`, `modified_at` | `yyyy-mm-dd HH:mm:ss IST`; modified is the later of the last update and the comment |
| `lead_id` | Always empty: leads stay in the CRM |
| `call_method`, `call_mode` | Always `PhoneCall`, `Voice` |
| `ringing_time` | Ringing seconds (0 when the phone didn't record it) |
| `total_working_hours`, `total_idle_time` | Our "active time" and "idle time" (HLD section 6), as `HH:mm:ss`; hours can pass 24 |
| `total_never_attended_calls`, `total_not_pickup_by_clients_calls` | Count of calls matching HLD section 6's definitions |
| `avg_*_duration`, `avg_duration_per_call` | `HH:mm:ss`, as in Callyzer's sample |
| `employee/get`: `registered_at` | When the current phone was paired (else when the employee was added) |
| `employee/get`: `last_sync_req_at` | The phone's last sync |
| `employee/get`: `is_call_recording_active` | A recording was uploaded in the last 7 days |
| `employee/get`: `device_details` | Brand and model, app version, Android version, SDK level; `board` empty |
| `employee/get`: `device_preference.is_app_uninstalled` | True when the employee has no paired phone (we can't see an uninstall) |
| `employee/get`: `battery_percentage` | `null` until M4's health check-in exists |
| `employee/get`: `is_lead_active` | Always false |

## Where Callyzer's own docs are unclear

We followed the sample answers where the tables and samples disagree. `employee-summary` returns `result.employees`, the other lists return `result` as an array. Day-wise entries include `total_calls`. Lists take `page_size` up to 100. If the client's CRM was written against Callyzer's live output and something differs, compare one real Callyzer answer with ours.

## Proof

`apps/server/test/m5.int.test.ts` (21 tests): every endpoint's fields, every filter, paging, the error messages, revoked and wrong keys, the rate limit, a suspended company, and one company's key never reading another company's calls.
