# Team workflow and Git policy

The same two-branch model as `reaplift-bsp`:

- The work branch (name to agree; `reaplift-bsp` uses `anirudh-e2e-setup`). Everyone commits here.
- `main` is production. It changes only through a release pull request from the work branch, merged with a merge commit, and M7 deploys from it.

No per-task branches, no stacked branches, no pull request per task. Never force-push the work branch and never push to `main` directly. CI must be green.

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
- the privacy test still passes
- any design change is reflected in the docs
