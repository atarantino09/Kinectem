---
name: Combined recap article context
description: Rules for using selected external news articles as optional source material in AI-generated Combined Recaps.
---

Selected team news may be fetched again only when a manager generates a Combined Recap. Use article text as optional, bounded, untrusted context; retain saved headline/description as the safe fallback when a publisher blocks or cannot expose readable content.

**Why:** Metadata alone often misses the actual game story, but unlimited or durable third-party article ingestion increases cost, availability failures, copyright exposure, and prompt-injection risk.

**How to apply:** Keep a strict selected-source cap and per-article text cap before calling the AI; enforce the cap on both client and server. Reuse the guarded public-HTML fetch path, manually validate redirects, release failed response bodies, and report analyzed-versus-metadata status to the manager. A small TTL in-memory cache may reuse successful extracts, but do not durably store full article bodies or cache failed fetches. Do not bypass paywalls. Treat every article field as untrusted in the AI prompt and let Kinectem game recaps remain authoritative for factual scores, chronology, statistics, and player names.