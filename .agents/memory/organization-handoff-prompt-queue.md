---
name: Organization handoff prompt queue
description: Ordering rule for one-shot organization create and claim onboarding prompts.
---

Treat organization create/claim handoff prompts as a queue: after an ownership grant, show owner/member management first with explicit initial-owner guidance; then preserve and continue the organization-wide pre-invite communication, coach setup, bulk-team setup, welcome, and guided-tour steps.

**Why:** Multiple one-shot signals can exist at the same time. Consuming or clearing all signals when the first dialog opens silently drops required onboarding steps, while opening them together stacks dialogs.

**How to apply:** Consume only the highest-priority signal, keep later signals intact, and explicitly advance the queue when the current automatic dialog closes. Approved-request links and secure-link claims must enter the same ownership-first sequence. Manual dialog re-entry must not restart the automatic queue.