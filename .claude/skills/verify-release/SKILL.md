---
name: verify-release
description: Full verification — format, lint, typecheck, unit/integration/authz/E2E/a11y tests, build, migrations from zero, seed/smoke — with an honest pass/fail report.
---
Run in order, continuing after failures so the report is complete:
1. `pnpm format:check` 2. `pnpm lint` 3. `pnpm typecheck` 4. `pnpm test` 5. `pnpm test:int` 6. `pnpm test:authz`
7. Fresh DB: `pnpm db:reset && pnpm db:migrate && pnpm db:seed` 8. `pnpm build` 9. `pnpm test:e2e` 10. `pnpm test:a11y`
11. `gitleaks detect` / `pnpm audit --prod` where available.
Report a table: step, command, result (pass/fail/skipped + why), duration. Overall PASS only if every step passed. Never hide or soften failures.
