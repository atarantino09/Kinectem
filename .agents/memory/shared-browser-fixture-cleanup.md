---
name: Shared browser fixture cleanup
description: Removing browser-test fixtures does not automatically restore shared aggregate counters.
---

Browser tests against the running development app share its real development
data, unlike isolated API tests. Track and remove the test's own increments to
shared promo redemption counters as well as its fixture organizations and usage.
Never reset an aggregate counter to zero or restore an old total.

**Why:** A successful temporary FREE2027 application incremented its shared
counter; deleting the fixture org and usage did not reverse that increment.

**How to apply:** Record each successful test-only redemption, then subtract
only that delta during cleanup so concurrent legitimate redemptions remain.
