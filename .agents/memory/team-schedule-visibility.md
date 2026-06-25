---
name: Team Schedule visibility parity
description: The Team Schedule add-on is members-only where "members" includes parents of active athletes; client gates must mirror the server or parents get locked out.
---

# Team Schedule visibility (client/server parity)

The Team Schedule feature (`/api/v1/teams/:teamId/schedule`) is **members-only and never public**. "Members" for *viewing* is broader than direct roster membership: it includes **org admins/owners, coaches, accepted (status `active`) athletes, AND the parent of an accepted athlete** (via `users.parentId`). Writes stay gated on `canManageTeam`.

**Rule:** any client gate that shows/hides the Schedule tab, the "Up Next" card, or the schedule panel must mirror the server's `canViewTeamSchedule`, not just `isTeamMember || canManage`.

**Why:** `isTeamMember` is derived from a direct roster row (`m.userId === me.id`). Parents are linked through `users.parentId`, not a roster row, so a pure roster check locks read-only parents out of the UI even though the server would serve them — a silent objective miss (parents are supposed to see the schedule read-only).

**How to apply (client):** detect a parent-viewer from the roster members response — each minor's row carries `parents[]` with the parent's **user id**, so the viewer qualifies when some `status === "active"` member lists `me.id` in `parents`. Combine: `canViewSchedule = isTeamMember || canManage || isParentOfActiveMember`.

**Related server invariant:** the `PATCH .../:eventId` series-edit path (`scope: "series"`) must mirror the single-occurrence validation — require `tzOffsetMinutes` when `startTime` changes (dates resolve per-row) and reject `endTime <= startTime`. The single-occurrence branch already enforces `endAt > startAt`; the series branch must not be laxer.
