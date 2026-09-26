---
name: Promo usage accounting
description: Reporting historical promo applications and verified paid discounts
---

Pre-tracking promo applications have no exact application timestamp. A subscription's **creation** time is a useful approximate date only while that promo is still attached and the code already existed at subscription creation. Show those applications in the corresponding quarter explicitly marked **estimated from subscription creation**; leave the others in a separate undated bucket. Never use subscription **updated** time as an application date.

**Why:** Existing production applications were backfilled without dates, but all seven current subscriptions were created in Q3 2026 after their promo codes existed; they are relevant to Q3. An estimate is useful to operators as long as it is never presented as an exact application timestamp.

**How to apply:** Quarter filters include exact dates and qualified, labelled estimates. Do not assign an estimate to replaced promos or deleted subscriptions without equivalent reliable evidence; show them undated. An applied code or incremented redemption count does not prove a charge: only mark a promo as discounted and paid when a paid Stripe invoice confirms that specific coupon and a positive discount. If invoice verification is unavailable, say so rather than reporting a false "no."