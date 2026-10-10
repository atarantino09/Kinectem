---
name: Solo-team free recap window
description: When a solo (org-less) team may author game recaps for free, and how the gate + client countdown stay consistent.
---

# Solo-team free recap window

A "solo team" (no parent org, created via the tournament signup funnel) may
author game recaps **from ONE DAY BEFORE the START date through the END date,
inclusive, of at least one participating competition**
(`start - 1 calendar day <= today <= end`).
Outside that window the coach must create / be adopted by a real org to keep
posting.

**Why:** Leagues and tournaments can be longer or shorter than a fixed window.
The user explicitly extended availability to one day before competition start
on 2026-10-09. The competition's configured dates are authoritative, and overlapping
competitions should keep access open while any one of them is active.

**How to apply:**
- The gate and any UI countdown must agree on the boundary. The gate compares
  **UTC calendar date strings**. The team-page countdown
  therefore computes window bounds as exact **UTC instants**
  `[(startDate - 1 day) T00:00Z, (recapFreeUntil + 1 day) T00:00Z)` — NOT local-midnight —
  so it never shows time remaining after the server has already locked (or vice
  versa) for viewers in other timezones.
- A future competition opens access only from its preceding day, and access remains available
  through the end of the configured end-date calendar day.
- A team can be in several competitions; "free" if ANY window is currently open.
  The UI countdown targets the latest currently-active window's end.

Team-page competition recap actions unlock together at viewer-local 12:01 AM
one calendar day before the competition starts; they do not wait for each
game's date or imported kickoff time. Per-game links still require a date and
known opponent, and existing published recaps replace authoring links.

**Why:** The user requested all competition recaps be available starting one day
prior to competition start, then explicitly clarified that competition buttons
and the regular recap prompt must agree at 12:01 AM on that prior day.
The task's viewer-local UI convention and the existing UTC permission convention
remain distinct; neither should silently change the other's timezone.

**How to apply:** Use competition start dates for team-page link availability,
retain authoring permissions, and refresh both local availability and
server-derived standalone-team permissions when open pages cross daily boundaries.
