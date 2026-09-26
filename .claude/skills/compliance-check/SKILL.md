---
name: compliance-check
description: Review onboarding eligibility, expiring/expired vaccinations, booking blocks, overrides, privacy/access issues and incident follow-ups; produce an actionable summary with minimal sensitive data.
---
1. Query (local/test data unless the Owner authorises otherwise): dogs pending approval and what is missing; documents expiring in 30/14/7 days; expired documents with future bookings; active overrides and their reasons; incidents open or awaiting follow-up.
2. Check access rules: sample authz tests for documents, health/behaviour profiles and incidents pass.
3. Summarise by action required (who, what, by when). Refer to dogs by name + customer surname only; never include medical/behaviour detail in the summary.
4. Note any legal-review flags without drawing legal conclusions.
