---
name: Shared browser fixture cleanup
description: Safely create and remove browser-test fixtures in the shared development database.
---

Browser tests against the running development app share its real development
data, unlike isolated API tests. Track and remove the test's own increments to
shared promo redemption counters as well as its fixture organizations and usage.
Never reset an aggregate counter to zero or restore an old total.

**Why:** A successful temporary FREE2027 application incremented its shared
counter; deleting the fixture org and usage did not reverse that increment.

**How to apply:** Record each successful test-only redemption, then subtract
only that delta during cleanup so concurrent legitimate redemptions remain.

Ad-hoc `tsx` fixture scripts do not type-check Drizzle inputs. Unknown insert
properties are silently ignored; API response field names are not necessarily
database schema field names. Inspect the schema before inserting, and create
multi-record fixtures in a transaction.

**Why:** A later fixture insert can fail after its organization, team, or
competition has already been committed, leaving partial records in the user's
shared development database.

**How to apply:** Use verified schema fields rather than copying API DTOs.
Commit the fixture atomically and record its cleanup IDs before browser work.
