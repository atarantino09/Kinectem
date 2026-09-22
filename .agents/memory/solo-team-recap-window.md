---
name: Solo-team free recap window
description: When a solo (org-less) team may author game recaps for free, and how the gate + client countdown stay consistent.
---

# Solo-team free recap window

A "solo team" (no parent org, created via the tournament signup funnel) may
author game recaps **only while at least one participating competition is
active, from its START date through its END date, inclusive**
(`start <= today <= end`).
Outside that window the coach must create / be adopted by a real org to keep
posting.

**Why:** Leagues and tournaments can be longer or shorter than a fixed window.
The competition's configured dates are authoritative, and overlapping
competitions should keep access open while any one of them is active.

**How to apply:**
- The gate and any UI countdown must agree on the boundary. The gate compares
  **UTC calendar date strings**. The team-page countdown
  therefore computes window bounds as exact **UTC instants**
  `[startDate T00:00Z, (recapFreeUntil + 1 day) T00:00Z)` — NOT local-midnight —
  so it never shows time remaining after the server has already locked (or vice
  versa) for viewers in other timezones.
- A future competition does not open recaps early, and access remains available
  through the end of the configured end-date calendar day.
- A team can be in several competitions; "free" if ANY window is currently open.
  The UI countdown targets the latest currently-active window's end.
