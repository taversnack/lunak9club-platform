---
name: security-review
description: Run the security checklist — threat review, authorisation tests, secret/dependency scans, upload and webhook checks — and report findings by severity. Use before each milestone.
---
1. Run: `pnpm test:authz`, `gitleaks detect --no-banner` (if installed), `pnpm audit --prod`.
2. Checklist: authorize() on every action/route/job; object-level scoping; session/cookie flags; CSRF on mutations; rate limits on auth and booking; input validation; output encoding; upload validation and private storage; signed URL expiry; webhook signature + replay; secrets in env only; PII-free logs; Owner-only actions audited.
3. Grep for risky patterns: `dangerouslySetInnerHTML`, raw SQL string concatenation, `console.log(` in `src/`, `sk_live_`, public bucket ACLs.
4. Report table: severity, evidence (file:line / command output), affected area, remediation. State which checks could not run.
