# Open questions

Questions waiting on ReapLift. Add new ones here. When one is answered, move it to "Answered" with the date, the source, and the spec it changed. Decisions with a default the build follows are in the tracker (D1 to D9); these are the questions with no safe default.

## For ReapLift

| # | Question | Why it matters | What we assume until answered |
| --- | --- | --- | --- |
| Q1 | Phone survey (E2): each employee's brand, model, Android version and default dialer | Decides who can have recordings and how many company phones to buy | Mostly Oppo, Vivo, Samsung; some on the Google dialer |
| Q2 | Will ReapLift buy phones for employees whose phone cannot record? Which model? | Test one unit of the exact model before buying in bulk: auto-record, no "this call is being recorded" announcement, our app finds the file | Yes, case by case |
| Q3 | Who are the managers, and which employees does each manage? | Teams and manager access (M2) | Admins only until M2 |
| Q4 | Has ReapLift's HR or legal reviewed employee consent for call tracking and recording under the DPDP Act 2023? Is there a written policy employees sign? | The app's consent screen should match the policy | The app's own consent text, written in M1 and approved by the owner |
| Q5 | Do customers need to be told calls are recorded? | Some industries and customers expect it | Not told; ReapLift to decide |
| Q6 | Which CRM pages should show call data: an employee page, a contact page, a reports page? | Shapes M5 | A Call Reports page and a call list on each employee |
| Q7 | Does the CRM already store each employee's company SIM number? | The CRM can push employees to us (M5) instead of admins typing them twice | Typed in our panel until M5 |
| Q8 | Who receives the daily email, and at what time? | M3 | Admins and each manager (their teams), 08:00 India time |

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
