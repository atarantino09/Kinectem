---
name: Capturing real Kinectem screenshots for video artifacts
description: How to drive the live Kinectem app with Playwright to capture real app screenshots, and the data/auth gotchas that block pages from loading.
---

# Capturing real Kinectem app screenshots (for video/demo artifacts)

When a video/demo artifact needs ACTUAL app screenshots (not mockups), drive the
running kinectem app with a Playwright spec under `artifacts/kinectem/e2e/` and
write PNGs into the video artifact's `public/shots/`. Scenes then display them via
`object-cover object-top` inside the browser-chrome frame with a Ken-Burns + crossfade.

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
