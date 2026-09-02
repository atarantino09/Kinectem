---
name: First-run onboarding persistence
description: How/why first-run onboarding "seen" state is persisted and gated in the kinectem web app.
---

# First-run onboarding "seen" state

First-run onboarding UI (e.g. the Team page & Organization page guided
walkthroughs / spotlight tours) persists its "already seen" flag in
**localStorage, per browser** — NOT server-side.

**Why:** `lib/api-spec/openapi.yaml` is locked, so there is no user-settings /
"seen onboarding" field on the API and none can be added. Per-browser localStorage
is the only place to remember it. This means the tour can re-show on a new
device/browser — accepted tradeoff, matches standard product-tour behavior.
Bump the key (e.g. `kinectem:team-tour-v1` → `-v2`) to re-show to everyone.

**Keying is per USER (not per-entity, not bare per-browser).** Product decision:
each tour shows at most once per account — the team tour the first time a manager
(coach or org admin) opens *any* team page, the org tour the first time an
owner/admin opens *any* org page. The team key is `kinectem:team-tour-v1:<userId>`
(no `<teamId>` suffix). A bare per-browser key was a bug: a new coach signing in
on a browser where another account had dismissed the tour never saw it.
**Why:** the user explicitly wanted it to pop up only once per user, not once per
team/org. This supersedes both the per-entity design and the bare-global key.
Triggers stay role-gated (org: `isManagerRole`; team: `canManage`) so non-managers
never see it. Gate reads/writes on `me?.id` being loaded.

**Freshness after invite accept:** `canManage` derives from the members-list query
(30s staleTime), so accepting a roster invite must invalidate cached queries for
that team (InviteAcceptPage does, via a team-id predicate) or the tour/manager UI
can lag on first landing.

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

# Partner-directory manager-tour handoff

Partner-directory club links can carry a one-shot `showAround=1` signal that
opens the normal team manager tour after a short delay, but the signal must
still obey the per-user first-run flag. It is an entry hint, not a bypass.

**Why:** The handoff helps a coach understand the management experience on their
first team visit, while repeated organization-to-team navigation must not reopen
the walkthrough.

**How to apply:** Keep the handoff role-gated, consume the URL signal, check the
same per-user storage key before scheduling it, and mark the tour seen when it
opens so leaving early does not cause repeats.
