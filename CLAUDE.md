# CLAUDE.md

Guidance for Claude Code working in this repository.

## What this is

ReapLift's own call tracking product for its employees, similar to Callyzer: an Android app syncs each employee's calls on their company SIM (and, later, the phone's call recordings) to our server, and managers see detailed call history and call reports. ReapLift's CRM (PHP and MySQL, on Hostinger shared hosting) will show these reports through our API. Read these before starting any task:

- `docs/project-tracker.md`: overall status, the roadmap, the dependency rule, owner decisions, and the rules every milestone follows. Source of truth for what is active.
- `docs/requirements-and-hld.md`: requirements and high-level design, including the Android app design and the report definitions.
- `docs/data-model-and-api.md`: every table and route, existing and planned, and the conventions they follow.
- `docs/milestones/<milestone>/spec.md`: the spec for the milestone you are working on.
- `docs/open-questions.md`: questions waiting on ReapLift. Add new ones there.

## Where things stand

- Design written on 7 November 2026. M0 (foundation) and M1 (install the app and see call history) built by 8 November and run on an Android 15 emulator; both wait on real test phones (E1). M2 (call reports) is next.
- Everything runs locally until M7 (deploy to a Hostinger VPS).

## Stack

- Server and panel: pnpm workspaces, TypeScript, Node 22. `apps/server`: Fastify, Zod, Kysely, pg, pino, Vitest. `apps/web`: React + Vite (the admin panel). `packages/shared`: types and Zod schemas shared by both. PostgreSQL 16 via Docker Compose (`infra/compose.dev.yml`, port 5433; server 3100, panel 5174, so `reaplift-bsp` can run alongside). The same stack as `reaplift-bsp`.
- Phone app: `apps/android`, Kotlin, Jetpack Compose, WorkManager, SQLite; Gradle 8.14.3 wrapper, AGP 8.13.2, Kotlin 2.2.21, run on JDK 21 (see README). Not part of the pnpm workspace.
- Recordings (M6): S3-compatible object storage (MinIO locally; Cloudflare R2 or AWS S3 in production).

## Commands (repo root)

- `pnpm install` / `pnpm dev` / `pnpm build`
- `pnpm db:up` / `pnpm db:down`: local PostgreSQL in Docker
- `pnpm migrate`: apply `db/migrations/*.sql`
- `pnpm lint`, `pnpm typecheck`, `pnpm test` (unit), `pnpm test:int` (needs `pnpm db:up`)
- Android: `cd apps/android && ./gradlew assembleDebug test lint`
- Build `packages/shared` first (`pnpm --filter @reaplift/calls-shared build`) after changing it.

## Rules

- **Privacy rule, never broken: only calls on the employee's company SIM leave the phone.** The app filters on the phone, before anything is stored for upload. Calls on a personal SIM, and recordings that do not match a company-SIM call, are never read beyond what matching needs and never uploaded. A test proves it.
- One server program; `MODE` (`api | worker | scheduler | migrate`) picks what runs. Add new behaviour as a mode or a module under `apps/server/src/modules/`, not as a separate app.
- Migrations: new numbered file only, never edit a merged one; only add things (tables, nullable columns, indexes).
- Phone numbers are digits with country code, no plus (`9198xxxxxxxx`). Times are `timestamptz` in UTC, shown and grouped by day in India time.
- One company only (ReapLift's own employees), so tables have no `client_id`. Every employee-data query is still limited by the caller's role (admin sees all, a manager sees their teams).
- Every task ships with its tests. Run lint, typecheck and tests before committing. `pnpm test:int` drops the schema of its database, so locally give it a separate `DATABASE_URL`.
- A milestone's `test-evidence.md` holds the exact commands, SQL queries and real output that prove its flow. Phone flows are proven on a real phone, not only an emulator.
- Never commit secrets. Settings go in `.env` (ignored); add every new setting name to `.env.example` with a blank value. The APK signing key is never committed.
- Android behaviour (permissions, call log fields, dialer recording folders, background limits) differs by brand and version: check on a real phone and record the model and Android version before relying on it.
- Do not mark a task complete from a mock UI, an emulator alone, or an in-memory route; the full flow must be validated end to end.
- Do not mix future milestones into the active task. Keep scope narrow and current.
