---
name: Branded email boundary
description: Durable ownership rules for Kinectem email presentation, plaintext, and compliance copy.
---

Enforce the shared Kinectem HTML presentation at the final API delivery boundary so text-only and newly added API call sites cannot bypass branding. Scheduled scripts must use the same shared renderer because they cannot import the API server.

**Why:** Email wording, recipient routing, SendGrid metadata, and plaintext alternatives are existing behavioral contracts. Centralizing presentation adds consistent branding without forcing every body builder to duplicate a shell or rewrite approved copy.

**How to apply:** Keep plaintext MIME content caller-owned and human-readable. Escape dynamic values in HTML body fragments before they reach the trusted shell. Keep unsubscribe and operator-compliance content in the builders that already own those policies; the generic shell must not invent it.