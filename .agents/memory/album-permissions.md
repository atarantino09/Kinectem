---
name: Photo album permissions
description: Who can upload/view/delete in the post photo album
---
Album on posts is view-for-anyone-who-can-see-the-post, upload-for-team-community only.

**Rule:** uploads allowed for accepted roster members, parents of active members, org owners/admins, solo-team creator, post author, platform admin — NOT followers. Org posts: any organizationAdmins row. Profile-only highlights (no team/org): author only. Deletes: uploader (own), post author, team/org managers, platform admin.

**Why:** user requested tightening the originally open "fan album" so strangers/followers can't add photos to game recaps (COPPA-adjacent safety), while keeping the album visible to followers.

**How to apply:** server is the control point (`canContributeToAlbum` / `canModerateAlbum` in the album routes, built on canViewTeamSchedule/canManageTeam). GET response carries extra `canUpload` + per-photo `canDelete` flags beyond the locked openapi spec (accepted precedent); client only gates UI on them.
