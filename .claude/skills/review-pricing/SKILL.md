---
name: review-pricing
description: Run and explain the pricing test matrix — membership bands, ad hoc, half day, taxi, adjustments, effective dates and snapshots. Use after any pricing change or before month-end.
---
1. Run `pnpm test -- pricing` and `pnpm test:int -- pricing`.
2. Print a worked table: scenario, inputs, rule version, unit price, qty, discount/adjustment, total (pence and £), explanation.
   Cover: ad hoc 1 day; member 1/3/4/5 days a week; member extra day; bank-holiday week; month with 4 vs 5 weeks of plan days; mid-month join; cancellation ≥48 h and <48 h; no-show; price-book change effective mid-month; customer-specific rate.
3. Verify existing quotes/invoice lines keep their snapshot after a future price edit.
4. Flag any difference between expected (from `docs/decisions.md`) and actual; do not "fix" by changing expectations without Owner approval.
