---
name: plan-feature
description: Plan a feature for LunaK9 Club before any material change — affected rules, data, security, UI, tests, acceptance criteria. Use when a new feature or change is requested.
---
1. Read `docs/decisions.md`, relevant ADRs and `docs/progress.md`; inspect the affected code.
2. List affected: domain rules, tables/migrations, permissions (`authorize` actions), UI screens, notifications, jobs, tests.
3. Write acceptance criteria (Given/When/Then) including edge cases and failure paths.
4. Flag any rule touching money, legal compliance, privacy, security or customer experience that is not already in `docs/decisions.md` — propose a default and ask.
5. Propose a step plan sized as one reviewable vertical slice, with the test list.
6. **Stop and wait for Owner approval** before changing code. Record approved decisions in `docs/decisions.md`.
