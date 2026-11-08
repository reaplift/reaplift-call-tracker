# Milestones

Each milestone is one flow and has its own folder with a `spec.md`. Status, order and the rules every milestone follows are in [project-tracker.md](../project-tracker.md). Every table and route is listed in [data-model-and-api.md](../data-model-and-api.md).

| Milestone | Spec |
| --- | --- |
| M0 | [Foundation](m0-foundation/spec.md) |
| M1 | [Install the app and see call history](m1-install-and-call-history/spec.md) |
| M2 | [Call reports](m2-call-reports/spec.md) |
| M3 | [Daily email report](m3-daily-email/spec.md) |
| M4 | [Phone health and app updates](m4-phone-health-and-updates/spec.md) |
| M5 | [CRM integration](m5-crm-integration/spec.md) |
| M6 | [Call recordings](m6-call-recordings/spec.md) |
| M7 | [Deploy](m7-deploy/spec.md) |
| M8 | [Pilot](m8-pilot/spec.md) |

## What every spec contains, in this order

1. **Header:** status, owner, starts after, external prerequisites.
2. **Outcome:** what the flow achieves, in two or three sentences.
3. **Flow diagram:** a Mermaid chart, including the failure paths.
4. **Worked example:** the flow told with real-looking names and numbers.
5. **Scope:** what is in, and what is out with the milestone it belongs to.
6. **Tasks:** which can run in parallel, then each task with subtasks, tests and acceptance.
7. **Data and API:** tables, migrations, routes, error codes and settings.
8. **Open questions:** each with a default and who decides.
9. **Demo (milestone acceptance):** the exact steps that prove the flow.

## Evidence pack

By the time a milestone is Done, its folder also holds `test-evidence.md` (setup, exact commands, SQL that checks the data, real output, date and commit), `frontend.md` (panel pages), `android.md` (app screens and the phone models and Android versions tested) and `e2e.md` (the demo run). Never paste secrets, real customer numbers or recordings into these files; use test numbers.
