---
name: Shared team join-link security
description: Security rule for reusable email-less team roster join links.
---

Email-less team roster join links are bearer capabilities, not ordinary display
identifiers. Generate them with cryptographic randomness and enforce one pending
player link per team while serializing concurrent creation.

**Why:** Anyone holding the link can join a roster. Predictable tokens or several
simultaneously created stable links broaden unauthorized access risk and make a
link impossible to manage safely.

**How to apply:** Reuse the shared secure link flow for every team-wide
email-less roster link. Keep database-level uniqueness and transaction-level
coordination together; do not reintroduce timestamp or `Math.random()` tokens
for capability URLs.