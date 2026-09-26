---
name: implement-slice
description: Implement one approved vertical slice (DB → domain → server → UI → tests → docs). Use only after /plan-feature has been approved.
---
1. Confirm the approved plan and acceptance criteria; restate scope in one paragraph.
2. Migration first (use /create-migration if schema changes).
3. Domain logic in `src/domain` with unit tests written alongside.
4. Server actions/routes: Zod validate → `authorize()` → domain → transaction where needed. Add authz tests (wrong role, wrong owner).
5. UI using design-system components; accessible states; UK English copy.
6. Integration + E2E tests for the journey.
7. Run `pnpm verify`. Fix failures; do not claim done while anything fails.
8. Update `docs/progress.md` and any ADR/decision affected. Report commands run, results, limitations.
