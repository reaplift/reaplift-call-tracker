# Cost: build our own vs Callyzer

Worked out on 7 November 2026 for the owner. The estimates are rough; the inputs are listed so they can be changed.

> **11 November 2026 (D10):** the server now runs on ReapLift's existing Hostinger shared plan, so the VPS cost below (about ₹1,000 to ₹1,600 a month) drops to ₹0 unless recordings later need a VPS. Object storage for recordings still costs as estimated.

## Actual bill (owner, 7 November 2026)

**ReapLift pays Callyzer about ₹1.5 lakh a year** (about ₹12,500 a month), which is far below the recording-storage estimates further down. Those estimates assume more storage than ReapLift really uses, or features it does not have (likely the API add-on). The invoice's breakdown (numbers, plan, storage, add-ons) is needed to redo this page.

**Developer cost is not counted (owner, 7 November 2026):** the app is built in-house with Claude Code, targeting 5 days. On that basis:

| Per year | Callyzer | Our own |
| --- | --- | --- |
| Today's features | ₹1,50,000 | about ₹25,000 to ₹30,000 (VPS, storage, domain) |
| With the API for the CRM | about ₹2,56,000 | same |
| At 100 employees, with the API | about ₹5,10,000 | about ₹40,000 to ₹50,000 |

Saving: about ₹1.2 lakh a year now, ₹2.3 lakh once the CRM needs the API, and more as the team grows. Fixes for new Android versions and phone models still take some time each month.

The sections below are the first estimate from list prices, kept for reference; their developer-cost section no longer applies.

## Callyzer's list prices (INR, per month, before 18% GST)

From callyzer.co/pricing on 7 November 2026 (the figures the page shows for India).

| Item | Price |
| --- | --- |
| Basic plan (call tracking and every call report) | ₹175 per phone number billed monthly, ₹161 billed yearly |
| API + webhooks (needed for the CRM) | ₹150 per phone number |
| Call recording storage | ₹500 per 5 GB |

Below, Callyzer = Basic yearly + API for every employee + recording storage, plus 18% GST, at list price and with the assumed **25% discount**. Lead management (the Basic + Lead plan, ₹252 to ₹275) is not needed.

## Assumptions

| Input | Value | Why |
| --- | --- | --- |
| Working days | 26 a month | |
| Talk time per employee | 1, 2 or 4 hours a day | Not measured yet; the pilot will tell |
| Recording size | 0.5 MB per minute | A typical dialer AAC file; to measure on the test phones (T4). AMR files are about 5 times smaller |
| Recordings kept | 12 months (D4) | Storage grows for the first year, then stays level |
| Callyzer storage | Charged on everything stored, in 5 GB packs | How the price reads; confirm with Callyzer's sales team |
| Our server | Hostinger VPS, about ₹1,000 a month for 50 employees, ₹1,600 for 100 | From memory; check when buying (E4) |
| Our storage | Cloudflare R2 at about $0.015 per GB a month, ₹88 to the dollar | From memory; check (D6) |
| Our other costs | ₹300 a month (domain, small extras) | |

## Monthly running cost

"Year 1" is the average month in the first year, while storage grows. "After a year" is when 12 months of recordings are stored.

### 50 employees

| Talk a day | Recordings stored | Callyzer list | Callyzer −25% | Ours |
| --- | --- | --- | --- | --- |
| No recordings | none | ₹18,300 | ₹13,800 | ~₹1,300 |
| 1 hour | 250 GB year 1, 460 GB after | ₹47,800 → ₹72,600 | ₹35,900 → ₹54,500 | ~₹1,600 → ₹1,900 |
| 2 hours | 500 GB, 910 GB | ₹77,300 → ₹1,26,300 | ₹58,000 → ₹94,700 | ~₹2,000 → ₹2,500 |
| 4 hours | 990 GB, 1.8 TB | ₹1,35,800 → ₹2,34,300 | ₹1,01,800 → ₹1,75,700 | ~₹2,600 → ₹3,700 |

### 100 employees

| Talk a day | Recordings stored | Callyzer list | Callyzer −25% | Ours |
| --- | --- | --- | --- | --- |
| No recordings | none | ₹36,700 | ₹27,500 | ~₹1,900 |
| 1 hour | 500 GB, 910 GB | ₹95,700 → ₹1,44,700 | ₹71,800 → ₹1,08,500 | ~₹2,600 → ₹3,100 |
| 2 hours | 990 GB, 1.8 TB | ₹1,54,100 → ₹2,52,600 | ₹1,15,600 → ₹1,89,500 | ~₹3,200 → ₹4,300 |
| 4 hours | 2 TB, 3.7 TB | ₹2,70,900 → ₹4,68,600 | ₹2,03,200 → ₹3,51,400 | ~₹4,500 → ₹6,700 |

Ours excludes tax; adding 18% does not change the picture.

## What this shows

- **Recording storage is almost all of Callyzer's bill.** Without recordings, Callyzer is cheap (₹14,000 to ₹28,000 a month after the discount) and building our own mostly buys control and the CRM fit. With recordings, Callyzer's ₹500 per 5 GB is about 40 times what R2 charges, so the gap is ₹35,000 to ₹3.5 lakh a month.
- **Our running cost barely grows** with employees or talk time.
- **We can shrink recordings.** Converting them to a speech codec (Opus at 16 kbps, about 0.12 MB a minute) would cut our storage by about 4 times. That is an optional task for M6.
- **The biggest unknowns** are real talk time and real file size. Both get measured in M1 and M6, before the pilot.

## The cost of building it

Running costs leave out the main cost of building our own: developer time.

| Milestones | Rough effort for one developer |
| --- | --- |
| M0 foundation | 1 week |
| M1 install and call history (the Android app is most of it) | 4 to 5 weeks |
| M2 reports | 2 to 3 weeks |
| M3 daily email | 1 week |
| M4 phone health and updates | 2 weeks |
| M5 CRM integration | 2 weeks (depends on the CRM code) |
| M6 recordings | 3 to 4 weeks |
| M7 deploy | 1 week |
| **Total before the pilot** | **about 16 to 19 weeks (4 to 4.5 months)** |
| Ongoing upkeep (new Android versions, new phone models, fixes) | about 3 to 4 days a month |

**Payback** = build cost ÷ (Callyzer's monthly bill − our monthly cost − upkeep).

Example, with a developer costing ₹1.5 lakh a month:

- **Build:** about ₹6.5 lakh.
- **Upkeep:** about ₹25,000 a month.
- **50 employees, 2 hours of talk a day, recordings kept:** Callyzer costs about ₹58,000 a month after the discount in year 1. Building our own saves about ₹31,000 a month, so payback takes about 21 months.
- **After the first year:** the saving rises to about ₹67,000 a month, because Callyzer's storage keeps growing.
- **At 100 employees:** payback takes under 8 months.
- **Without recordings:** Callyzer is cheaper than our upkeep, so building only pays for itself through control and the CRM fit.

To check before deciding:

1. Ask Callyzer for a written quote: 50 and 100 numbers, the API, recordings, and how storage is charged.
2. Measure talk time from a week of call logs from five employees.
3. Measure one recording's size on each phone brand.
