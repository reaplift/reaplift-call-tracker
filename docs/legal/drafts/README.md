# Callit legal drafts (13 November 2026)

First drafts prepared by ReapLift for review by ReapLift's lawyer and company secretary, then by each client company's legal team. They are written in plain language and describe what Callit actually does today. **They are not legal advice.** Text in [square brackets] is to be filled in or decided.

Each document is here as Markdown (`.md`), as a Word file (`.docx`) for lawyers to edit with tracked changes, and all six together in `Callit-legal-drafts.pdf` for reading.

| # | Document | Whose document | Signed or approved by |
| --- | --- | --- | --- |
| 1 | Callit Service Agreement, with how ReapLift handles the data | Between the client company and ReapLift | Signed by both companies |
| 2 | Company SIM and Call Tracking Policy | The client company's, issued to its employees | Approved by the client's legal team or HR; signed by each employee |
| 3 | Message the app shows before tracking starts | ReapLift's app, the client's wording | Approved by the client's legal team; each employee taps "I agree" |
| 4 | Telling customers that calls are recorded | The client company's | Approved by the client's legal team |
| 5 | Callit Privacy Policy, and answers for Google Play's data form | ReapLift's, published on the web | Approved by ReapLift's lawyer and the client's legal team |
| 6 | How long Callit keeps data | The client company decides | Signed by the client company; becomes part of the agreement |

## Blanks ReapLift fills before sending to a client

- ReapLift Private Limited's CIN, registered address, contact email, and grievance officer.
- Fees (agreement, Schedule C).
- Service levels: availability and fix times (agreement, sections 2.2 and 2.3).
- Backups: how often and how long they are kept (agreement, Schedule B). To confirm with Hostinger's plan.
- Where Cloudflare stores recordings (Cloudflare → R2 → the bucket's settings).
- The city whose courts have jurisdiction (agreement, 11.1).

## What changes in Callit once these are approved

- The app shows the approved text (document 3) as consent version 3.
- The privacy policy (document 5) is published at a public address, for example https://callit.reaplift.com/privacy, which Google Play requires.
- Callit deletes call details automatically after the agreed periods (document 6); today only recordings are deleted automatically, after 12 months.
- Each employee's signed policy and consent are recorded in Callit (decision D12 in the project tracker).
