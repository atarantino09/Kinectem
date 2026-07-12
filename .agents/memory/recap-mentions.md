---
name: Recap @-mentions
description: Inline @[Name](user:uuid) mention tokens in recap bodies — server tag upsert + client rendering; publish-time notify pitfall.
---

# Recap @-mentions (inline tokens)

The OpenAPI spec is locked, so recap mentions live INSIDE the existing `body` string as `@[Display Name](user:<uuid>)` tokens. Server (`article-tagging.ts` → `applyMentionTags`) parses them and upserts `article_tags` rows (`source: "manual"`, consent-aware approved/pending, roster-validated: accepted players on the recap's team only — forged tokens are ignored). Client (`lib/mentions.tsx`) renders tokens as wouter profile links and truncates feed excerpts mention-safe.

**Rules to keep:**
- Mentions must run BEFORE the auto-tag fan-out so their rows land `source: "manual"` — the "tagging off" cleanup deletes only `source: "auto"` rows.
- **Publish-time notify must use the full `mentioned` set, not `inserted`.** Tag rows inserted silently while the post was a draft make `inserted` empty at publish → player never notified. The 10-min per-user/per-link throttle in `notifyNewlyTaggedInRecap` dedupes create-then-quick-publish. (The roster fan-out still has this gap for drafts-with-gameDate — known, follow-up filed.)
- Guardian pending-tag bells gate on `users.is_minor && parent_id` — a consent-pending tag on a non-minor linked account fires no guardian bell by design.
- Any new body-preview surface must use `truncateMentionSafe` or raw half-tokens leak into the UI.
- The composer picker needs a team selected (`composerTeamId`) — no team, no roster, no dropdown.

**Why:** spec locked (no schema field for mentions); notify bug found live in e2e when draft→publish produced zero notifications.
