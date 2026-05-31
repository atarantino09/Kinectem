---
name: Capturing real Kinectem screenshots for video artifacts
description: How to drive the live Kinectem app with Playwright to capture real app screenshots, and the data/auth gotchas that block pages from loading.
---

# Capturing real Kinectem app screenshots (for video/demo artifacts)

When a video/demo artifact needs ACTUAL app screenshots (not mockups), drive the
running kinectem app with a Playwright spec under `artifacts/kinectem/e2e/` and
write PNGs into the video artifact's `public/shots/`.

## Displaying shots: full-page auto-scroll, not crop
`ScreenshotPan` (UIHelpers.tsx) renders the shot at full width (`w-full h-auto`),
measures overflow (image clientHeight − container clientHeight) on load, then
animates `y` from 0 to `-overflow` so the WHOLE page scrolls past in the browser
frame. Capture with `fullPage: true` so the tall PNG contains the entire page.
The old `object-cover object-top` + Ken-Burns approach only showed the top crop —
do NOT reintroduce it. `scroll={false}` keeps a short beat (e.g. the filter
dropdown) pinned to the top with a gentle zoom; those shots use `fullPage:false`.
Reset `maxScroll` to 0 on `src` change so a cached image swap can't carry stale
overflow into the next beat.

## Capture mechanics that bite
- kinectem is served at base path `/app/`. Playwright `baseURL` is the shared proxy
  `http://localhost:80`; prefix every path with `/app` (e.g. `/app/login`, `/app/teams/:id`).
- Do NOT use `waitUntil: "networkidle"` — the app polls (notifications/unread counts)
  so networkidle never fires and the call hangs. Use `domcontentloaded` + explicit waits.
- Wait for skeletons to clear: poll until zero `.animate-pulse` elements, then screenshot
  with `animations: "disabled"`. Wrap each shot in try/catch so one failure doesn't abort the run.
- The kinectem web SOURCE is minified (identifiers collapse to single letters like `n`),
  so `rg` for logic is useless. data-testid strings and string literals ARE preserved —
  rely on testids (`input-signin-email`, `input-signin-password`, `btn-signin`, `select-team-filter`)
  and visible text, not on reading component logic.
- Run in the FOREGROUND (`--reporter=line`); backgrounded `nohup` runs lost their output
  and looked hung. A full ~7-shot run is ~55s.

## Why a profile/recap page renders blank or 404s
- **Minor private profiles return HTTP 404 (not 403) to non-approved viewers.** A minor with
  `profile_visibility='followers'` 404s `GET /users/:id` and `/users/:id/posts` for anyone who
  isn't self / linked guardian / platform admin / approved follower. The profile page then sits
  in a permanent skeleton. Fix for capture: insert an `approved` row in `user_followers`
  (`follower_user_id` follows `following_user_id`, `moderation_status='approved'`) so the viewer
  can load it — do NOT flip the minor to public.
- **Recap/article detail lives at `/posts/:postId`, where `postId` is a derived POST id, NOT the
  raw `articles.id`.** Linking with the raw article uuid 404s ("Post not available"). Robust
  approach: navigate by CLICKING the recap on the team page so the app uses its own correct link.

## Seeding believable demo data (so captured pages look filled out)
The shared demo DB is full of throwaway rows (titles with "test"/"edit", plus
odd ones with no shared pattern) and highlights with dead media that render as
black boxes. Make demo pages presentable with an idempotent seed script
(`scripts/src/seed-game-recap-demo.ts`): hide junk articles by `ilike '%test%'`/
`'%edit%'` AND an explicit `JUNK_TITLES` list across the demo team IDs, hide all
demo highlights (broken media), insert curated realistic recaps (delete-by-
team+title then insert), and set the demo player's profile public for capture.
**Roster gotcha:** the profile sport-filter is driven by accepted `roster_entries`
via `GET /users/:id/teams`. To guarantee a team appears, DELETE+INSERT the roster
row (status `accepted`) — a bare UPDATE silently no-ops when the row doesn't exist.
