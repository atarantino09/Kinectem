---
name: In the News (team news links)
description: Newspaper-article links on team pages serialized as read-only feed posts.
---

- Rows in `team_news_links` are fetched ONCE at add time (OG metadata stored); serialized via `newsLinkToPost` with synthetic id `news-<uuid>` and extra-spec `newsLink { url, sourceName }` block. No detail page, reactions, comments, or shares — the card links OUT to the paper.
- **Why read-only:** avoids re-fetching third-party pages and keeps the locked openapi contract (extra-spec field pattern, recapKind precedent).
- Server-side URL fetch (`lib/news-metadata.ts`) is SSRF-hardened: manual redirect following with per-hop hostname/DNS validation against private/loopback/link-local ranges. Any new server-side "fetch a user-supplied URL" feature must reuse this helper or match its per-hop validation — `redirect: "follow"` alone is a bypass.
- Duplicate guard is the DB unique index `(team_id, url)`; the pre-insert check is best-effort only, the 23505 catch maps to 409.
- Client gate for adding news is `canManage` (mirrors server `canManageTeam`, includes coaches), NOT `isAdmin` — the TeamPage props differ and using `isAdmin` locked coaches out.
- `parseSyntheticPostId` falls back to "article" for `news-` ids; PostCard news branches must be gated on `isNews` before any reportTarget-based logic.
