---
name: Promo usage accounting
description: Reporting historical promo applications and verified paid discounts
---

Pre-tracking promo applications have no reliable application timestamp. Show them visibly but separately whenever a quarter is selected; never assign them to that quarter or infer a date from mutable subscription timestamps.

**Why:** Existing production applications were all backfilled without dates. A quarter filter otherwise showed zero rows, and guessing a date would give operators incorrect accounting.

**How to apply:** Keep date-range totals restricted to applications with exact recorded dates. Label legacy rows as undated in both the report and export. An applied code or incremented redemption count does not prove a charge: only mark a promo as discounted and paid when a paid Stripe invoice confirms that specific coupon and a positive discount. If invoice verification is unavailable, say so rather than reporting a false "no."