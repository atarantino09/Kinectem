---
name: Claimed partner club access
description: Product and privacy rules for recovering administrator access from a claimed club listed on a partner page.
---

An already-claimed club opened from a partnership directory gets a public-safe ownership explanation before navigation. Show only an adult owner's public profile identity; mask a minor owner. The automatic explanation is once per organization/browser, but an explicit signup return must reopen it so the visitor can finish.

Access requests from this surface always request the administrator role. The current owner approves or declines through the existing organization queue, and approval grants administrator access; ownership transfer remains a separate owner-only action.

**Why:** A real club owner may discover that somebody else claimed the organization. They need to identify the current claimant and recover management access without exposing the private member-management surface or private contact data.

**How to apply:** Keep this behavior scoped to published partner pages and visible partner memberships. Do not alter ownerless claim requests or direct organization-page visits. Preserve request intent through authenticated internal return paths, notify the owner, and notify the requester of the outcome.