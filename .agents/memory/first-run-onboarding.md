---
name: First-run onboarding persistence
description: How/why first-run onboarding "seen" state is persisted and gated in the kinectem web app.
---

# First-run onboarding "seen" state

First-run onboarding UI (e.g. the Team page guided walkthrough / spotlight tour)
persists its "already seen" flag in **localStorage, per browser** — NOT server-side.

**Why:** `lib/api-spec/openapi.yaml` is locked, so there is no user-settings /
"seen onboarding" field on the API and none can be added. Per-browser localStorage
is the only place to remember it. This means the tour can re-show on a new
device/browser — accepted tradeoff, matches standard product-tour behavior.
Bump the key suffix (e.g. `kinectem:team-tour-v1` → `-v2`) to re-show to everyone.

**How to apply:**
- Read the flag inside a try/catch and default to "not seen" when storage throws
  (private/incognito modes throw on access).
- Gate manager-only onboarding on `canManage` (org owner/admin OR coach-level
  roster member), the same gate used for the existing `?welcome=1` TeamWelcomeDialog.
- Don't stack tours: suppress the auto-tour when `?welcome=1` is present.

# Spotlight tour mechanics

`components/team-page/SpotlightTour.tsx` is a reusable forced walkthrough: portal
overlay + transparent full-screen click-blocker (so only Back/Next work) + a ring
around the target found by `data-testid` (box-shadow dimmer) + numbered card.
Each step's `onEnter` switches the active tab; the target is located with a short
retry loop after the tab renders, and a missing target falls back to a centered
card so the tour never gets stuck. Build the step list from capability flags so a
coach isn't pointed at an admin-only control (e.g. `btn-edit-team` is `isAdmin`-only).

**Why not open dialogs/composers mid-tour:** the "in place / explain" approach was
chosen over the "open each window" approach. Note the recap composer is a separate
route (`/posts/new?...`, the button is a `<Link>`), so spotlighting AI Assist there
would navigate away and break the tour — the tour explains AI Assist in the tooltip
instead.
