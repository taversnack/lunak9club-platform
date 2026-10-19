# PR screenshots (Dev4 UI refresh stack)

Before/after screenshots for the stacked UI PRs, kept on this orphan branch so they never reach `main`.

- `pr-57/` 0a tokens: home, account, admin
- `pr-55/` 0b components and restyle: before = dev4/ui-tokens (a7a08c4), after = dev4/ui-components (ccc7c08), same build type and database; includes `sign-in-pending` (button caught mid-submit)
- `pr-59/` 0c account: before = dev4/ui-components (ccc7c08), after = dev4/ui-account (a25d9a9 code; 7cacac5 only changes a test); overview, requests, bookings, membership with focus near the tab bar, drawer open
- `pr-60/` 0d admin: Today dashboard, approvals
- `pr-61/` 0e public: home, 404, access denied
- `pr-62/` 0f booking: calendar, sticky submit, review

Files are `<page>-<width>-<before|after>.png` at 390px (mobile) and 1280px (desktop). "Before" is clean main when captured; "after" is the PR branch.
