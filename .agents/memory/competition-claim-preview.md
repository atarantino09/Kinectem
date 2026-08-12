---
name: Competition console claim preview
description: How claim-link visitors get a read-only, fully-expanded competition console before claiming.
---

Claim-link visitors (valid, unclaimed `?claimToken=`) see the FULL operator console at `/competitions/:id?claimToken=` in preview mode.

**Rule:** preview is purely presentational — a synthetic `CompetitionRow` is built from the public `/competitions/:slug` detail (which also carries counts + matches); server-side ownership checks remain the only authorization boundary.

**How to apply:**
- `ConsoleWithTour` takes `preview`; panels take `preview` to initialize their chevron `open` state true (chevrons closed again after claiming — the claim flow does a full `window.location.assign` remount as owner).
- All panels sit inside `<fieldset disabled={preview}>` — one place disables every native control incl. Radix switches and chevron buttons. Anchors are NOT disabled by fieldset.
- Owner-only queries must be gated `enabled: !preview` (pending claims, recaps) or skipped entirely (HubPanel, AdminsPanel); `/my/competitions` is held while a claim token is resolving so anonymous visitors don't trigger a 401-retry loop.
- SchedulePanel already has a local `preview` state (CSV dry-run) — the claim prop is renamed `claimPreviewMode` there.
- The walkthrough (`CompetitionHowItWorks`) reacts to `defaultOpen` flipping true via effect (resolve can finish after mount, e.g. platform admins who always have `canManage`).
