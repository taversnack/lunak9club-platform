# ADR 0003 — Authentication and access control

- Status: Accepted
- Date: 2026-09-26

## Decision
- **Better Auth** (email + password) with sessions, verification tokens and rate-limit counters stored in our Postgres (UK/EU residency, no per-user fees). Behind `src/infra/auth`.
- Email confirmation required before any session is created; links last 1 hour. Password minimum 10 characters; reset revokes all sessions.
- Self-registration always grants the **customer** role. The **owner** role is granted only by `pnpm owner:create` (local/approved database) and every grant/revoke is audited.
- Roles are rows (`roles`, `user_roles`); permissions are a code map (`src/server/policy/permissions.ts`). Code checks permissions, never role names.
- `authorize(actor, permission, resource?)` is the single decision point. Self-scoped permissions require an ownership match. Unknown roles grant nothing. Page guards redirect anonymous → sign-in, unverified → verify-email, forbidden → access-denied (audited).
- Session cookie cache disabled so revoked sessions end immediately; secure cookies whenever `APP_URL` is https.

## Alternatives
Clerk (managed, less ops, but identity data held by a third party and per-user pricing); Auth.js (weaker email/password story).

## Consequences
We own auth security updates: keep `better-auth` patched (Dependabot/`pnpm audit` in CI).
