# Team workflow and Git policy

The same two-branch model as `reaplift-bsp`, but tuned to this call-tracker project:

- The work branch (name to agree; for example `anirudh-m2-reports` or `anirudh-m5-crm`). Everyone commits here.
- `main` is production. It changes only through a release pull request from the work branch, merged with a merge commit, and M7 deploys from it.

No per-task branches, no stacked branches, no pull request per task. Never force-push the work branch and never push to `main` directly. CI must be green, and call-tracker privacy rules still apply.

## Daily work

```bash
git checkout <work branch>
git pull --rebase origin <work branch>

# work and commit locally

pnpm lint
pnpm typecheck
pnpm test
(cd apps/android && ./gradlew test lint)

git pull --rebase origin <work branch>
git push origin <work branch>
```

If CI goes red, fixing it comes before any new work.

## Local Git hooks

Run the setup once for a fresh clone:

```bash
./scripts/setup-git-hooks.sh
```

This repo uses the local hook directory `.githooks` with rules tuned to the call-tracker product, not a generic BSP workflow:

- `pre-commit`: rejects merge markers and whitespace errors, blocks staged secret files like `.env`, and runs `pnpm lint`
- `pre-push`: runs `pnpm lint`, `pnpm typecheck` and `pnpm test` before any remote push
- `commit-msg`: enforces tracker-friendly commit messages like `feat(server): add pairing validation` or `m1: update privacy rule and setup flow`

The hook path is set in git with `core.hooksPath .githooks`, so the checks are applied automatically on every developer machine.

## Releasing

1. CI is green on the work branch, and the tracker matches the code.
2. One pull request from the work branch into `main`; the other developer reviews it.
3. Merge with a merge commit, then merge `origin/main` back into the work branch and push.

## APK releases

- Release APKs are signed with ReapLift's key, which lives outside git (in the password manager and as a CI secret). Losing it means every phone has to uninstall and reinstall, so it is backed up in two places.
- Every release raises `versionCode`. M4 publishes it to `app_releases` so phones update themselves.

## Review checklist before pushing

- the work matches the active tracker task and stays inside its milestone
- tests are present and relevant; lint, typecheck and tests pass
- nothing sends real email or uploads real recordings from automated tests
- the privacy test still passes, especially for company-SIM filtering and no personal-SIM calls
- no call data leaves the phone unless it is on the chosen company SIM and valid for the tracker workflow
- any design change is reflected in the docs
- the PR contains a clear summary and a checklist from the template in `.github/pull_request_template.md`
- at least one reviewer signs off before merge to `main`
- the work branch is not force-pushed and is rebased before pushing when needed
- for Android changes, the reviewer checks the battery, SIM-selection and background-sync impact on real-device brands
