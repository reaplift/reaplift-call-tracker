# Callit: questions for your legal team before launch

Prepared by ReapLift, 13 November 2026. Today Callit is installed by APK for a small beta. Before rolling it out to all employees, and publishing it on Google Play, we need your legal team's answers and approval on the points below. This is a list of questions, not legal advice.

## What Callit does (facts for your lawyers)

- Employees install the Callit app on a phone with a **company SIM**. The app reads the phone's call log and sends **only calls on the company SIM** to our server: number, contact name saved on the phone, call type, time, talk and ringing time. Calls on a personal SIM never leave the phone.
- If the phone's own dialer records calls, the app finds the recording of each company-SIM call and uploads it. **Callit doesn't record calls itself.** Recordings are kept for **12 months**, then deleted.
- After each call the employee can add an outcome, a comment and a follow-up date.
- Managers see call history, reports and recordings in a web panel. Your CRM can read the same data through an API key.
- Admins can list numbers that are **never recorded or stored** (for example a director or a family member), and can delete past calls with those numbers.
- Planned: employees send fixed WhatsApp message templates to clients from their own WhatsApp.
- Where the data is kept: our server and database on Hostinger (India, Mumbai data centre); recordings on Cloudflare R2 (storage location to confirm).

## 1. Who is responsible for the data (DPDP Act 2023)

1. Is your company the **data fiduciary** and ReapLift the **data processor** for employees' and customers' call data?
2. What must the **agreement between your company and ReapLift** contain: purpose, security, breach reporting, deletion at the end of the contract, audits, and our sub-processors (Hostinger, Cloudflare)?
3. Is it acceptable for recordings to be stored outside India if Cloudflare's storage isn't in India, or must all data stay in India?
4. Who handles a breach notification to the Data Protection Board and to affected people, and within what time?

## 2. Employees

5. On what basis can you process employees' company-SIM call data: **consent**, or a "legitimate use" for employment purposes under the Act? Do you want both?
6. Please approve or edit the **employee call-tracking policy**: company SIM for work only, what is collected, who sees it, how long it's kept, what happens when someone leaves.
7. Please approve or edit the **consent text shown in the app** before tracking starts. Today it explains the company-SIM calls, recordings and the after-call form. We'll send the current text.
8. If an employee **withdraws consent**, what should happen: stop tracking only, or also delete their data?
9. When an employee **leaves**, how long do you keep their calls and recordings?
10. Does anything change for employees on contract, interns, or in states with specific employment rules?

## 3. Customers on the other end of the call

11. Customers' numbers, names and voices are personal data. What **notice** must they get? We plan for the employee to say at the start of each call: *"This call is recorded and monitored for quality."* Is that wording enough, and is it needed on every call?
12. Should your website's **privacy notice** mention call recording and the CRM, and what should it say?
13. How do you want to handle a customer asking to **see or delete** their calls or recordings? The never-record list and deletion feature can support this.
14. Are any of your customers in a **regulated sector** (banking, insurance, health, government) with extra rules on recording or retention?

## 4. Call recording

15. Is recording by one party to the call (the employee's phone) lawful for your business in India, given the notice in question 11?
16. Is **12 months** the right retention for recordings, and for call details (which we keep longer for reports)? Should it be shorter or longer?
17. Who in your company may **listen** to recordings? Every play is logged today.

## 5. WhatsApp templates (planned)

18. Employees will send fixed messages from **their own WhatsApp** to clients they just spoke with. Do you need the client's **opt-in** first, and is there any wording to avoid (marketing versus service messages)?
19. Must employees use **WhatsApp Business** on the company SIM rather than personal WhatsApp?

## 6. Publishing on Google Play instead of APK

20. Google Play only allows apps to read the call log for approved uses. We would apply under the **"enterprise CRM"** use, with a permissions declaration and a video of the app. Is your company the right **publisher**, or ReapLift? (An organisation developer account needs the company's D-U-N-S number.)
21. Play needs a public **privacy policy** URL and a **Data safety** form describing what is collected and shared. Who approves those texts?
22. Would you prefer a **private app** through Managed Google Play, installed only on your employees' phones, instead of a public listing? It still goes through Google's review, but it isn't public.

## Documents we need back

| Document | Who drafts | Who approves |
| --- | --- | --- |
| Company ↔ ReapLift agreement, with data processing terms | ReapLift / your legal team | Both companies |
| Employee call-tracking policy, signed by each employee | Your legal / HR | Your legal |
| In-app consent text | ReapLift (draft) | Your legal |
| Customer notice line and privacy notice update | Your legal | Your legal |
| Public privacy policy and Play Store Data safety answers | ReapLift (draft) | Your legal |
| Retention periods (recordings, call details, ex-employees) | Your legal | Your management |

Once these are approved, we'll put the final texts into the app and panel, record each employee's signed policy and consent, and prepare the Google Play submission.
