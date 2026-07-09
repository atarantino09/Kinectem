---
name: Independent teams and organization joins
description: Independent/tournament temp teams have organizationId=null — inner-joining organizations silently drops all their rows.
---

**Rule:** Teams can exist without a parent org (independent / tournament temp teams, `teams.organizationId = null`). Any query that joins `teams` → `organizations` must use `leftJoin`, never `innerJoin`, or every row for those teams silently disappears (no error, just an empty feed).

**Why:** A user's recaps posted fine (201, rows in DB) but never appeared on their team page — the team-posts feed inner-joined organizations, dropping all posts for org-less teams. Hard to spot because the write path succeeds and the read path returns a valid empty list.

**How to apply:** When adding/editing queries over team-scoped content (posts, highlights, schedules), leftJoin organizations and treat `org` as nullable downstream (`PostExtras.org` is nullable; `computeArticleCanEditMap`/`computeArticleAuthorRoleMap` accept `orgId: string | null`). Also: imported schedule times may be 12-hour strings ("5:30 PM") — client time formatters must handle both 12h and 24h or they render "Invalid Date".
