# P1. Move to MariaDB and serve many companies

- Status: Planned, waiting for the owner's review of this spec (11 November 2026)
- Owner: unassigned
- Starts after: nothing; it pauses M2, which continues on MariaDB afterwards
- External prerequisites: none to build; the hosting check (task P1.6) needs SSH to Hostinger, which works
- Decisions: D10 (Hostinger shared hosting and MariaDB), D11 (many companies) and D12 (legal sign-off per company and per employee), tracker decision log, 11 November 2026

P1 is a platform change rather than a flow, so it has no phone demo of its own. M1's flow, run again on MariaDB with two companies, is its acceptance.

## Outcome

The server, panel and tests run on MariaDB 11.8, the database Hostinger's shared hosting provides, instead of PostgreSQL. Every table that holds a company's data carries `company_id`, the same number the CRM uses for that company. Each company's admins and managers see only their own company. A ReapLift super admin manages companies. No phone can be tracked until its company's agreement, the employee's signed policy and the employee's in-app consent are all recorded (D12). Everything M1 and M2 already do still works and still passes its tests.

## Flow diagram

```mermaid
flowchart TD
  SA["Super admin (ReapLift)"] -->|"adds company 4 = BSNL,<br/>with the CRM's company_id"| CO[("companies")]
  SA -->|"adds BSNL's admin"| U[("users, company_id 4")]
  U -->|"BSNL admin adds employees,<br/>issues a pairing code"| E[("employees, company_id 4")]
  E -->|"phone pairs with the code"| D[("devices, company_id 4")]
  D -->|"company-SIM calls"| C[("calls, company_id 4")]
  C --> R["Reports: always one company at a time"]
  X["Country Roads admin<br/>(company 7)"] -. "asks for a BSNL call or employee" .-> NF["404 NOT_FOUND"]
```

## Worked example

- The super admin creates **BSNL** (CRM company 4) and **Country Roads** (CRM company 7), and one admin for each.
- BSNL's admin adds Ravi (`919812345678`) and pairs his phone. Country Roads' admin adds Meena (`919876500000`).
- Ravi's calls get `company_id = 4` from his device, never from anything the phone sends.
- Country Roads' admin opens Reports and sees Meena's calls only. Asking for Ravi's employee ID returns 404.
- Country Roads' admin tries to add an employee with Ravi's number `919812345678`: refused with `NUMBER_IN_USE`, because a company SIM number belongs to one employee in one company.
- The super admin picks BSNL in the panel's company picker and sees exactly what BSNL's admin sees. Reports never add up companies together.

## Scope

In:
- MariaDB 11.8 locally in Docker, the Kysely MySQL dialect with `mysql2`, and new migration files written for MariaDB.
- `companies` table; `company_id` on every company-data table; roles `super_admin`, `admin` (a company's admin), `manager`.
- One scope function that applies company first, then role, to every employee-data query.
- Super admin: companies page and a company picker in the panel.
- Every existing query moved to MariaDB SQL, with every existing test passing on MariaDB.
- New tests that prove one company can never read or change another's data.
- A short hosting check on `callit.reaplift.com` (P1.6).

Out:
- Deploying the real service (M7, which is reshaped by D10).
- A person working for two companies on two SIMs in one phone (case B in the decision log; only if it is needed).
- Linking our companies and employees to the CRM's live data (M5).
- Billing or per-company plans.

## Tasks

P1.1 comes first. P1.2 and P1.6 can run alongside each other after it. P1.3 needs P1.2, P1.4 needs P1.3, and P1.8 needs P1.4. P1.5 runs throughout, and P1.7 comes last.

### P1.1 Local MariaDB and the database layer

- `infra/compose.dev.yml`: replace `postgres:16` with `mariadb:11.8` on port **3307** (3306 left free for other projects), with a healthcheck.
- Server: `mysql2` and Kysely's `MysqlDialect` replace `pg`. Every connection sets `time_zone = '+00:00'` so stored times are UTC.
- `.env.example`: `DATABASE_URL=mysql://calls:calls@localhost:3307/calls`.
- `pnpm migrate` applies the new MariaDB files.
- Tests: `/healthz` reports `db: ok` against MariaDB.

### P1.2 Schema for MariaDB with companies

- New migration set: `0001_init.sql` to `0003_reports_m2.sql` are replaced by MariaDB files. This is the one exception to "never edit a merged migration", allowed because nothing has been deployed and there is no real data (D10). Local databases are dropped and recreated. The registry in the tracker is updated in the same commit.
- Type mapping:

| PostgreSQL | MariaDB 11.8 |
| --- | --- |
| `timestamptz` | `datetime(3)`, always UTC |
| `uuid` with `gen_random_uuid()` | `uuid` with `default uuid()` |
| `jsonb` | `json` |
| `bigint generated always as identity` | `bigint unsigned auto_increment` |
| `check (...)` | `check (...)`, which MariaDB enforces |
| generated columns | `... as (...) stored` |

- New table `companies`: `id int unsigned primary key` (the CRM's company ID, set by hand, not auto-numbered), `name`, `status` (`active`, `suspended`), `created_at`.
- `company_id int unsigned not null` with a foreign key to `companies` on `employees`, `pairing_codes`, `devices`, `calls`, `teams`, `team_members`, `team_managers`, `excluded_numbers`, `daily_employee_stats` and `jobs` (`null` for jobs that are not about one company). `users` and `audit_logs` get it as nullable, because a super admin and system events belong to no company.
- Uniqueness changes:
  - `employees.company_number` is unique across all companies (D11).
  - `emp_code` and `teams.name` are unique within a company.
  - `excluded_numbers` has the primary key (`company_id`, `number`).
  - `users.email` stays unique across all companies.
- Indexes start with `company_id` where reports filter by it, for example `calls (company_id, employee_id, started_at)`.
- Join tables (`team_members`, `team_managers`) carry `company_id`, and the server refuses to link a team and an employee or manager from different companies. A test proves it.
- Tests: the migrations apply to an empty database; a dump of the schema is checked in and compared in CI.

### P1.3 Move the queries

The server code that touches the database is about 1,800 lines in 16 files, with about 55 PostgreSQL-only spots, 22 of them in `modules/reports/routes.ts`. Each is moved to MariaDB SQL:

| PostgreSQL | MariaDB |
| --- | --- |
| `insert ... returning` | `insert ... returning`, which MariaDB supports |
| `update ... returning` | update, then read the row again in the same transaction |
| `on conflict ... do update` | `on duplicate key update` |
| `count(*) filter (where ...)` | `sum(case when ... then 1 else 0 end)` |
| `= any($1)` | `in (...)` |
| `::int`, `::date` and similar casts | `cast(... as ...)`, or nothing |
| `pg_advisory_lock` | `get_lock()` / `release_lock()` |
| `for update skip locked` (jobs) | `for update skip locked`, which MariaDB 10.6+ supports |
| India day: `at time zone 'Asia/Kolkata'` | `convert_tz(started_at, '+00:00', '+05:30')`. India has no daylight saving, so a fixed offset is safe and needs no time-zone tables on the server |

Modules in order: `lib` (db, audit), `auth`, `employees`, `device`, `calls`, `reports`, `install`, `cli`. Each module is done only when its unit and integration tests pass on MariaDB.

### P1.4 Companies and roles

- Roles: `super_admin` (`company_id` null, sees every company through the picker), `admin` (one company), `manager` (their teams in one company).
- One scope function: `scope(user, selectedCompany)` returns the company and, for a manager, their team employees. Every employee-data route calls it, and a route-walking test fails CI for any panel route that does not.
- Device routes take the company from the device row, never from the request body. Pairing takes it from the pairing code's employee.
- Panel:
  - A **Companies** page for the super admin (add, rename, suspend).
  - A company picker in the header for the super admin. Admins and managers never see it.
- A suspended company: its panel users cannot log in, and its devices get `403 COMPANY_SUSPENDED` and stop syncing. Calls already stored are kept.
- New routes:

| Method | Route | Who |
| --- | --- | --- |
| GET, POST | `/api/companies` | super admin |
| PATCH | `/api/companies/:id` | super admin |

- New error codes: `NUMBER_IN_USE` (409, a company SIM number already belongs to another employee), `COMPANY_SUSPENDED` (403).
- `/device/v1/pair` adds `company: { name }` to its response so the app can show which company the phone is paired to. The app's privacy rule is unchanged.

### P1.5 Tests

- Every existing unit and integration test passes on MariaDB. `pnpm test:int` uses its own MariaDB database and drops it, as it does today.
- New isolation tests, with two companies in every fixture:
  - For each panel route, a company 7 admin or manager gets 404 for company 4's IDs and never sees company 4's rows in lists, reports or the CSV export.
  - A device paired to company 4 can never write a call into company 7, even if the request body claims to.
  - A team and an employee from different companies cannot be linked.
  - `NUMBER_IN_USE` across companies.
- The M2 hand-count report test runs for two companies at once and each company's numbers still match its own hand count.
- The privacy test (no personal-SIM call uploaded) still passes.

### P1.6 Hosting check on Hostinger (parallel, small, no real data)

Proves the D10 path before M7 depends on it:
- `callit.reaplift.com` set up in hPanel as a Node.js web app (Node 22), as `billit.reaplift.com` is. The DNS record goes in Cloudflare, which runs `reaplift.com`'s DNS.
- A temporary build of the server with `/healthz` only, connected to a new, empty Hostinger MariaDB database (for example `u436365342_callit`).
- Record:
  - HTTPS works.
  - How long the first request takes after the app has been idle.
  - Whether hPanel cron can run a command every minute (for the worker and scheduler).
  - How much memory the app uses.
- Removed or left as the empty placeholder afterwards. Results go in this folder's `test-evidence.md`.

### P1.8 Legal sign-off per company and per employee (D12)

Tracking cannot start for anyone until both sign-offs exist. The server enforces it, not just the panel.

**Company level: the agreement between ReapLift and the client**
- The super admin records each company's signed agreement: kind (`data_processing`), version, date signed, signed by (name and title), where the signed copy is kept, and who recorded it. A new version replaces the old one; old ones are kept.
- Until a company has a current agreement:
  - its admins can add employees but cannot issue pairing codes (`409 COMPANY_AGREEMENT_MISSING`);
  - its devices cannot sync (`403 COMPANY_AGREEMENT_MISSING`).
- ReapLift's own internal company records its internal employee policy the same way.

**Company level: the consent text**
- Each company has its own consent text, approved by legal, naming that company. It is versioned. The super admin publishes it, and a published version is never edited, only replaced.
- The app shows the text from the server, not a text built into the app. One APK serves every company.

**Employee level: signed policy and in-app consent**
1. **Signed policy:** the company's admin records that the employee signed the company's call-tracking policy (date, document reference). Until then, no pairing code can be issued for that employee (`409 EMPLOYEE_POLICY_MISSING`).
2. **In-app consent:** at pairing, the app fetches the company's current consent text and the employee taps Agree. The server stores who, which text version, when, which device and which app version. It is stored per employee as well as per device.
3. **New consent version:** when the company publishes a new text, each device gets `consentRequired` in `/device/v1/config`. Sync pauses (calls stay queued on the phone, nothing is uploaded) until the employee accepts the new version.
4. **Withdrawal:** the app has **Withdraw consent**. The server records it, the device is unpaired, and sync stops at once. The admin sees it. What happens to calls already stored is a legal question (Q12); until it is answered they are kept under the normal retention.

**Panel**
- Companies page: agreement status, current consent text version.
- Employees list: policy signed (date), app consent (version, date), withdrawn.
- **Consent register** CSV per company, as proof for legal: every agreement, policy record, consent and withdrawal with times.
- Every sign-off action is written to `audit_logs`.

**App changes** (setup wizard step 1 and settings)
- Consent screen shows the server's text for the pairing code's company, so the pairing code is entered before the consent step. The wizard order becomes: enter or scan code, consent, permissions, keep running, company SIM, test call.
- Re-consent screen when `consentRequired` is set.
- **Withdraw consent** in the app's settings.

**Tests**
- No agreement: pairing code refused, device sync refused.
- No signed policy: pairing code refused.
- Consent stored with the right text version; a new version pauses sync until accepted, and nothing is uploaded while paused (Android test plus server test).
- Withdrawal unpairs the device and the next sync gets 401 `DEVICE_REVOKED`.
- Company 7 cannot see company 4's agreements, consents or register.

### P1.7 Docs and evidence

- `test-evidence.md`: commands, the MariaDB schema, the isolation test output, P1.6's results.
- CLAUDE.md, the HLD, `data-model-and-api.md` and the tracker are updated to match what was built, not just what was planned.

## Data and API

- Tables: `companies` (new); `company_id` added as listed in P1.2; uniqueness as listed in P1.2. For P1.8: `company_agreements`, `consent_texts`, `employee_consents` (new); `employees.policy_signed_at`, `policy_document_ref`, `policy_recorded_by` (new columns). Full columns in `data-model-and-api.md`.
- Routes: `/api/companies` (P1.4); the pair response adds `company`. For P1.8:

| Method | Route | Who |
| --- | --- | --- |
| GET, POST | `/api/companies/:id/agreements` | super admin (company admin reads its own) |
| GET, POST | `/api/companies/:id/consent-texts` | super admin publishes; company admin reads |
| PUT | `/api/employees/:id/policy` | admin |
| GET | `/api/consent-register.csv` | admin, super admin (selected company) |
| GET | `/device/v1/consent-text?code=` | before pairing, by pairing code; no token |
| POST | `/device/v1/consent` | device: accept the current version |
| POST | `/device/v1/consent/withdraw` | device |

  `/device/v1/pair` adds `consentTextId` to its body; `/device/v1/config` adds `consentRequired`.
- Errors: `NUMBER_IN_USE` 409, `COMPANY_SUSPENDED` 403, `COMPANY_AGREEMENT_MISSING` 409 (pairing code) or 403 (device), `EMPLOYEE_POLICY_MISSING` 409, `CONSENT_REQUIRED` 403 (a device syncing without the current consent).
- Settings: `DATABASE_URL` becomes a `mysql://` URL. No new setting names.

## Open questions

| Question | Default | Who decides |
| --- | --- | --- |
| Does anyone work for two companies today, and on separate SIMs? | No. Case B (two SIMs in one phone) only if real cases appear | Owner |
| Who creates companies and their first admin? | The super admin, using the CRM's company ID | Owner |
| Does each client company need its own consent text and DPDP agreement? Under the DPDP Act, each client is likely the data fiduciary for its employees and ReapLift the processor | One consent text naming the employee's company, until legal advice says otherwise (Q4, Q9) | Owner, with legal advice |
| Does hPanel cron allow every-minute jobs? | Yes; checked in P1.6 | P1.6 |

## Acceptance

1. `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm test:int` pass on MariaDB, including the new isolation tests.
2. M1's flow run again on the Android emulator against MariaDB with two companies: each company's admin sees only their own employee's calls. The real-phone demo stays part of M1 (E1).
3. M2's hand-count test matches for both companies.
4. P1.6's hosting results are recorded.
5. P1.8 on the emulator: a company without an agreement cannot pair a phone; after the agreement, the employee's policy and in-app consent, the phone pairs and syncs; publishing a new consent text pauses sync until accepted; withdrawing unpairs the phone. The consent register CSV shows each step.
6. Estimate: 3 to 4 working days for P1.1 to P1.7, plus about 2 days for P1.8 (server, panel and app), so 5 to 6 in all.
