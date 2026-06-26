---
name: Solo-team free recap window
description: When a solo (org-less) team may author game recaps for free, and how the gate + client countdown stay consistent.
---

# Solo-team free recap window

A "solo team" (no parent org, created via the tournament signup funnel) may
author game recaps **only while it is inside a free window: from a tournament's
START date through START + 7 days, inclusive** (`start <= today <= start+7`).
Outside that window the coach must create / be adopted by a real org to keep
posting. The gate is `soloTeamRecapWindowOpen` in
`artifacts/api-server/src/lib/permissions.ts` (called by `canCreateRecap`).

**Why:** product rule — free recaps are tied to the tournament a solo team came
in through, and run for one week from kickoff. The earlier rule keyed the window
off the tournament END date; it was changed to START + 7 days. The window length
lives in one place: `RECAP_FREE_DAYS` + the `recapFreeUntil(startDate)` helper.

**How to apply:**
- The gate and any UI countdown must agree on the boundary. The gate compares
  **UTC calendar date strings** (`today`, `today - 7`). The team-page countdown
  therefore computes window bounds as exact **UTC instants**
  `[startDate T00:00Z, (recapFreeUntil + 1 day) T00:00Z)` — NOT local-midnight —
  so it never shows time remaining after the server has already locked (or vice
  versa) for viewers in other timezones.
- The window is gated on `startDate`, so a tournament whose start is in the
  future does NOT open recaps early (both bounds are enforced: `lte` start<=today
  AND `gte` start>=today-7).
- A team can be in several tournaments; "free" if ANY window is currently open.
  The UI countdown targets the latest currently-active window's end.
