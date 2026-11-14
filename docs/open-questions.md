# Open questions

Questions waiting on ReapLift. Add new ones here. When one is answered, move it to "Answered" with the date, the source, and the spec it changed. Decisions with a default the build follows are in the tracker (D1 to D9); these are the questions with no safe default.

## For ReapLift

| # | Question | Why it matters | What we assume until answered |
| --- | --- | --- | --- |
| Q1 | Phone survey (E2): each employee's brand, model, Android version and default dialer | Decides who can have recordings and how many company phones to buy | Mostly Oppo, Vivo, Samsung; some on the Google dialer |
| Q2 | Will ReapLift buy phones for employees whose phone cannot record? Which model? | Test one unit of the exact model before buying in bulk: auto-record, no "this call is being recorded" announcement, our app finds the file | Yes, case by case |
| Q3 | Who are the managers, and which employees does each manage? | Teams and manager access (M2) | Admins only until M2 |
| Q4 | Has ReapLift's HR or legal reviewed employee consent for call tracking and recording under the DPDP Act 2023? Is there a written policy employees sign? | The app's consent screen should match the policy | The app's own consent text, written in M1 and approved by the owner |
| Q6 | Which CRM pages should show call data: an employee page, a contact page, a reports page? | Shapes M5 | A Call Reports page and a call list on each employee |
| Q7 | Does the CRM already store each employee's company SIM number? | The CRM can push employees to us (M5) instead of admins typing them twice | Typed in our panel until M5 |
| Q8 | Who receives the daily email, and at what time? | M3 | Admins and each manager (their teams), 08:00 India time |
| Q9 | For client companies (D11): who is the data fiduciary under the DPDP Act, each client or ReapLift? Does each client need its own consent text and an agreement with ReapLift as processor? | The app's consent screen and the contract with each client | One consent text that names the employee's company, until legal advice says otherwise |
| Q10 | Does anyone work for two client companies at once, and if so, on a separate SIM for each? | Two companies on two SIMs in one phone needs app changes; one SIM for two companies cannot be told apart reliably | No one does; each company SIM number belongs to one employee in one company (owner, 11 November 2026) |
| Q12 | When an employee withdraws consent or leaves, what happens to their calls and recordings already stored: kept for the retention period, or deleted? | DPDP Act rights; the tracker must do what legal says (P1.8) | Recommended (11 November 2026, for legal to confirm): stop collecting at once (D12); keep stored calls and recordings under the company's retention period, then delete automatically; give the company admin an audited "erase this employee's data" action for when legal requires deletion. The DPDP Act's "legitimate uses" for employment may allow keeping work-call records without relying only on consent |
| Q13 | Where are signed agreements and policies kept: R2 (a separate private bucket, uploaded through the panel) or ReapLift's own files? | P1.8 stores a reference; uploading needs R2 credentials | Recommended (11 November 2026): a separate private R2 bucket (for example `reaplift-legal-docs`), apart from recordings; only the super admin and that company's admin can open a file, through short-lived links, each view logged; HR keeps the originals. P1 stores a reference until R2 is connected |
| Q11 | Who creates a company in the tracker and its first admin: ReapLift's super admin, or automatically from the CRM? | P1 builds it by hand; automatic needs M5 | ReapLift's super admin, by hand, using the CRM's company number |
| Q14 | Dashboard caching: keep each dashboard result for 5 minutes or 1 hour before asking the database again? (asked 13 November 2026) | Load on the shared hosting database against how fresh the numbers look; call history stays live either way | Recommended 5 minutes plus browser caching; not built until answered |
| Q15 | Delete the 684 calls from before pairing that were stored before the pairing-window fix (13 November 2026)? | The client called them a bug; new pairings no longer send them | Kept until the owner says delete |
| Q16 | Santhosh (OPPO, Google Phone): after setting ODialer as default phone app with auto-record on, send screenshots of the default app, the auto-record setting and the recordings folder in Files | If the files exist but the app still sees 0 files, add an all-files-access fallback (M6) | Recordings from his phone stay missing |
| Q17 | Create the live super admin login with the CLI command (owner, in their own terminal) | Needed to add companies on callit.reaplift.com | Not created yet |
| Q18 | Real-phone check of M10: send a template from real WhatsApp and WhatsApp Business, contact-name prefill, and Telugu or Hindi text | M10 is proven only on the emulator with a stand-in WhatsApp | App 0.6.0 is live; marked built, not done |
| Q19 | Legal drafts in `docs/legal/drafts/`: fill CIN, addresses, fees, backup period, R2 location and courts city; then ReapLift's lawyer and CS review | Needed before a Play Store launch | Beta continues with the app file |

## For the test phones (answered by trying, in M1 and M6)

| # | Question | Milestone |
| --- | --- | --- |
| T1 | On each brand, is the call log's phone-account ID the subscription ID or the SIM serial? Does it change when the SIM moves slot? | M1 |
| T2 | Does outgoing talk time include ringing on any brand? | M1 |
| T3 | Which foreground service type survives a full day on Android 14 and 15 on each brand? | M1 |
| T4 | Where does each brand's dialer save recordings, in which format, and what is in the file name? | M6 |
| T5 | Is the Google dialer's recordings folder really unreadable by our app on these phones? | M6 |
| T6 | Does any dialer announce the recording to the customer? | M6 |

## Answered

| # | Question | Answer | Date and source |
| --- | --- | --- | --- |
| A1 | Working hours? | None; marketing calls at any time. Reports use active time (first to last call) and all 24 hours | Owner, 7 November 2026 |
| A2 | Company phones or personal? | Company SIMs in employees' personal phones | Owner, 7 November 2026 |
| A3 | Where is the CRM hosted? | PHP and MySQL on Hostinger shared hosting | Owner, 7 November 2026 |
| A4 | How many employees? | 50 now, up to 100 | Owner, 7 November 2026 |
| A5 | Only ReapLift's own employees, or its client companies too? | Client companies (BSNL, Country Roads and others); each company's own employees install the app. Decision D11; changed the HLD, data model and CLAUDE.md, and added P1 | Owner, 11 November 2026 |
| A6 | Where does the service run? | Hostinger shared hosting as a Node.js web app with MariaDB, not a VPS. Decision D10; changed M7 and added P1 | Owner, 11 November 2026 |
| A7 | Do customers need to be told calls are recorded? (was Q5) | Yes: the employee says at the start of each call that it is recorded and monitored for quality, and each company's privacy notice says so. Employees must not use the company SIM for personal calls. Decision D13 | Owner, 11 November 2026 |
