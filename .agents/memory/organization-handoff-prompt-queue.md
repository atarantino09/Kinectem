---
name: Organization handoff prompt queue
description: Ordering rule for one-shot organization create and claim onboarding prompts.
---

Treat organization create/claim handoff prompts as a queue: after an ownership grant, show owner/member management first with explicit initial-owner guidance. For pre-built organization claims, show the post-claim setup guide next; it replaces the separate automatic pre-invite and coach prompts while keeping both tools available as direct guide actions. Other creation, bulk-team, welcome, and guided-tour prompts continue afterward.

**Why:** Multiple one-shot signals can exist at the same time. Consuming or clearing all signals when the first dialog opens silently drops required onboarding steps, while opening them together stacks dialogs.

**How to apply:** Consume only the highest-priority signal, keep later signals intact, and explicitly advance the queue when the current automatic dialog closes. Approved-request links and secure-link claims must enter the same ownership-first sequence. When the post-claim guide is consumed, remove its superseded pre-invite/coach auto-signals so dialogs do not repeat. Manual dialog re-entry must not restart the automatic queue.