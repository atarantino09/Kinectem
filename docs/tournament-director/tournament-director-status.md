# Tournament Director — Prototype Status & Spec Deltas

**As of Oct 25, 2026. Version 167.** This is the authoritative snapshot of what the clickable prototype (`tournament-director-app.html`, single-file React) actually does right now. It supplements — and where it conflicts, supersedes — the build spec in `replit-kinectem-handoff.md` (now updated to reference this version). For scheduler behavior specifically, `scheduler-engine.md` is the deepest reference; for the registration→Kinectem backend contract, `kinectem-integration-contract.md`. The builder should fold the "Spec deltas" items into the relevant handoff sections. **Andrew's call (Oct 22): the prototype is feature-ready to start building in Replit — these three docs plus `scheduler-engine.md` are the spec.**

Current published prototype: **Version 167** at `https://claude.ai/artifact/FBwtiXVkh2RETJ1BHjSpKr`.

---

## Session Oct 25 — multiple coaches per team + head-coach selector (V166)
- **Multiple coaches per team (V166).** On the **Coaches** worktable, each team row now has a head-coach input plus a **"Coaches (N) ›"** button that opens a management modal: add/remove any number of coaches (name · email · phone each), and mark exactly one **head coach** with a radio. A **"+N co-coach"** hint shows on the row when extras exist. The head coach is the single identity the scheduler groups on (a head coaching >1 team is the multi-team double-book the engine avoids); co-coaches never create conflicts. **Messaging/Compose now emails every coach on a team** — head + co-coaches + any registration-collected emails — with the recipient summary reading "all coaches of N teams". Delta 71; see below.

## Session Oct 22 — guest flow, provisional pages, stats, company admins, payments-in-setup, partial regs, schedule-card polish (V156–V165)

### Partial registrations + schedule-card readability + soft-notice fix (V162–V165)
- **Partial registrations tab (V165).** New tab in the **Teams** section (with a count badge) listing people who **entered contact info + at least one team but never finished checking out** — not registered yet, so the director can follow up. Each card: enroller name · club, email · phone, the team(s) they started + a group chip, and an amber "Started Nd ago · <last step>", oldest-first. Actions: **Send reminder** (flips to "Nudge again" + "Reminder sent" note), **Copy email**, **Dismiss**. Seeded demo data; in production this is a backend feed — see `kinectem-integration-contract.md` §7.
- **Unscheduled-game cards redesigned for readability (V162–V164).** Each tray card now reads top-to-bottom: **group label → divider line → home team (bold) → VS divider → away team (bold) → divider → Planned day**, on a slightly wider card, with **"Open Spot" placeholders de-emphasized**. Each team shows a **small color-coded club crest** (monogram = club initials + deterministic color; stands in for a real `logoUrl`). Scoped to the tray; compact on-grid blocks unchanged.
- **Soft time-notice false-positive fixed (V162).** Lean tests are now threshold-based: early-leaning only if a team must finish by ≤ 2 PM, late-leaning only if it can't start before noon. Genuine morning-vs-afternoon splits still flag; mild limits that share a wide midday band don't.

### Company admins & access + payments on Event setup + assistant knows setup (V161)
- **Company admins & access.** COMPANY SETTINGS has a "Company admins & access" card: add admins (name + email), scope each to All tournaments or Only selected (per-event checkboxes). Owner locked to full access; amber guard when none checked. `company.admins`; enforcement backend-owned.
- **Payments & promos now also on the Event setup page.** EVENT SETUP has a "Payments & promos" tab with the same controls as Payments & settlement → Payment method & promos (pay-by-check toggle + editable PIN, promo editor, shared library). Payouts/Stripe, check tracking and promo usage stay on Payments & settlement.
- **Pay-by-check PIN discoverability fixed.** Reworded to make clear it's editable any time, brand-outlined, and surfaced on Event setup.
- **The assistant can now help with setup.** Its system prompt covers setup, payments/PIN, promos and company admins; it always names the page. Starter suggestions include the PIN, admins, and promo codes.

### Guest provisional Kinectem pages + email as the identity key (V159–V160)
- **Guest checkout still builds the real Kinectem club + team pages — with a temporary status.** Recaps live for the event; persistent storybook/full admin withheld until claimed. Coach still gets the invite.
- **The email is the identity across sessions and into live Kinectem.** Info saved under the email; returning adds to the existing club (no dup); first Kinectem sign-in lands on the created pages = claim. (`kinectem-integration-contract.md` §1a–§1b.)
- A provisional guest club does not consume the once-per-email 90-day free trial.

### Guest coach-email carryover — enter the team once (V158)
- The step-1 team (name + coach email) auto-registers into the cart on the Add-teams step and the coach email carries into the Coaches step pre-filled. Verified end-to-end.

### Registration step-1 clarity (V156)
- Step 1 makes the two paths explicit: "Build your Kinectem club — 90 days free" is the only bulk path; guest is one team at a time with saved info and a loop-back ("Register another team" / "Done").

### Parser fix (V157)
- "No games Sunday morning" was being read as the opposite; `parseRequest` now detects a negation before a part-of-day word and inverts correctly. Unit-tested 10/10.

### Post-tournament stats page (V157)
- Director "Tournament stats" page (overall + by group/division/club): % of ≤1-goal games (ties incl.), average margin, ties, PK finishes, most-competitive divisions, champions per division, clubs by champions, upsets (playoffs + finals only). Per-stat public toggle + gated public page. Omit biggest margin, cards, comebacks.

---

## Earlier sessions (summary)

**Oct 21 (V145–V155):** impossible-matchup red flag + soft time-notice amber in Pools/Divisions/Dashboard + pre-schedule banner (day-aware, live); fast team-entry grid; coach invites at payment; new-club login handoff; guest-to-club carryover; accept-a-team confirmation; the Kinectem integration contract doc.

**Oct 21 (V129–V144):** venue fill order & finals; divisions clustered at one home venue (top priority); Friday = capacity-driven overflow for opted-in pairs; suggested formula default + clustering-on-open; place-everything + "Fix coach clashes" swaps; in-app AI assistant; Summer Blast Off event seeded.

**Oct 20 cont. (V124–V128):** team-never-in-two-games invariant; By-division flag-and-re-run; travel asymmetry (team drives + warms up, coach arrives at kickoff); indoor one-site-per-team hard lock; full-screen Full breakdown.

**Oct 20 (V96–V123):** 6-step auto-schedule wizard; Rule #1 (every placeable game on the board); no idle gaps on fields; Teams-in-and-out; Fit everything; field-space monitor; validation matrix (indoor 204/204 0 splits, outdoor 614–617/618, 0 hard conflicts).

**Oct 18–19:** "Running behind?" day-adjust; `parseRequest` day-aware rules + ReqAssist + director ack; schedule chart polish, field seed, Dashboard, Kinectem branding.

(Full detail for all of the above is in `scheduler-engine.md` for the engine and in the git history of this doc; the Spec deltas list below is the reconciliation set the builder works from.)

---

## Running checklist — build + QA against this

### Scheduler
- RULE #1: every placeable game gets on the board; indoor one-site integrity outranks it.
- Place-everything finish with amber coach double-book when needed; no idle gaps on fields.
- 6-step wizard; suggested formula default; engages clustering base on open.
- Divisions clustered at one home venue (per-day capacity-aware); venue fill order & finals.
- Friday = capacity-driven overflow for opted-in pairs only.
- "Fix coach clashes" same-venue swap tool.
- Impossible-matchup flag (red) + soft time-notice (amber); day-aware, live; lean test = finish ≤ 2 PM / start ≥ noon.
- Team never in two games at once (per-placement + invariant sweep).
- Team travel = drive + warm-up (hard); coach needs no buffer. Indoor: team's whole schedule at one site (hard, outranks coach conflict).
- Full `hardFit` gate; Scenario compare; Full-screen breakdown; By-division flag-and-re-run.

### Company settings & admins
- Company admins & access (All vs Only-selected tournaments; owner full; amber guard). Enforcement backend-owned.
- Company identity, director contact, communication defaults, default fee tiers/field hours/game formats, public-hub toggle — pre-fill every NEW tournament.

### Registration & Kinectem onboarding
- Step-1 path split; guest enters the team once; guest checkout builds provisional pages; email is the identity key; partial registrations tab; fast team-entry grid; accept-a-team confirmation; coach invites at payment; new-club login handoff (Build-my-club only); guest-to-club carryover; pay-by-check PIN editable any time in two places; promo codes in two places.

### Post-tournament stats
- Tournament stats page + per-stat public toggles + gated public page.

### AI assistant
- Context-aware chat via `sample`; advise-first; system prompt covers setup/payments/PIN/promos/admins; Help explainer + FAQ; ports to Replit.

### Schedule views & cards
- Chart · List · By team · By division + full-screen Full breakdown. Unscheduled-tray cards redesigned (group → divider → home / VS / away → divider → planned day), de-emphasized placeholders, small color-coded club crest per team (ready for real `logoUrl`).

---

## Replit readiness (Oct 22)
Feature-complete enough to start building in Replit. Build spec = `replit-kinectem-handoff.md` (pointed at V165), `scheduler-engine.md` for the engine, `kinectem-integration-contract.md` for the registration↔Kinectem events. First steps are in the handoff doc's "Replit kickoff" section. Open backend-owned items: company-admin enforcement & permission levels; partial-registration feed (§7); club `logoUrl`; scheduler job placement under Autoscale; Competitions schema reuse; backend priority presets/`r`.

---

## Spec deltas for the builder (fold into `replit-kinectem-handoff.md`)

(1–46 as previously recorded — scheduler correctness, Rule #1, travel asymmetry, indoor one-site lock, full-screen breakdown, by-division flag-and-re-run, etc.)

47. **Venue fill order & finals** (rank venues/fields per-size; preferred finals field soft/Final-only/own-venue).
48. **Divisions clustered at ONE home venue — top priority** (per-day capacity check; home-venue-aware passes).
49. **Friday night = capacity-driven overflow for opted-in pairs only** (round-1 of a willing pair, only when Saturday is full; per-team opt-in).
50. **Ship the suggested formula as the default** and engage the clustering base on wizard open.
51. **Place every game, flag the rare coach clash + offer same-venue swaps** (never scatter/double-book).
52. **In-app AI assistant** — context-aware, advise-first; system prompt maps where EVERY control lives (scheduling, registration, payments/PIN, promos, company admins, event setup) and always names the page; reuse Kinectem's Claude/recap backend.
53. **Impossible-matchup detection (hard) + soft time-notice (amber)**; day-aware; live; pre-solve feasibility guard on the server. Soft lean test: early = finish ≤ 2 PM, late = start ≥ noon.
54. **Fast team entry at registration** (team name + coach email only; group/level later; coach email triggers the invite).
55. **Coach invites fire when the payment method is committed** (not trial end).
56. **New-club login handoff** (Build-my-club only; pages must exist on arrival).
57. **Guest-to-club carryover** (carry entered teams into the create-club roster; clear the guest cart).
58. **Accept-a-team confirmation** ("Are you sure?" with exact card charges).
59. **Step-1 registration path split** (bulk = build a club; guest = one team at a time; no bulk/CSV on guest).
60. **Guest one-team loop-back** ("Register another team" pre-filled / "Done"; in-pass build-a-club upsell with carryover).
61. **Guest enters the team once** — auto-add to cart; coach email pre-fills the Coaches step; backfill blank email without clobbering edits.
62. **Part-of-day request parsing must handle negation** (no mornings → before noon; no afternoons → done by noon; no evenings → done by ~5pm; guard false positives).
63. **Post-tournament stats page** (overall + by group/division/club; % ≤1-goal incl. ties, avg margin, ties, PK, most-competitive, champions per division, clubs by champions, upsets in playoffs+finals only; omit biggest margin/cards/comebacks; per-stat public toggle + gated public page).
64. **Guest checkout builds provisional Kinectem pages** (`status: "provisional"`; live for the event, storybook/full-admin withheld until claimed; no plan, doesn't consume the free trial; synthesize a club name if none given). Contract §1a.
65. **Email is the identity — returning registrant & claim-by-email sign-in** (save enroller info; new teams attach to the same clubId — no dup; first Kinectem sign-in resolves to the created pages = claim). Contract §1b.
66. **Company admins with per-tournament access** (`admins[] = {id,name,email,role: owner|admin, scope: all|some, eventIds[]}`; owner always full; backend enforces at sign-in; email invite on add; consider a later view-only vs full permission level).
67. **Payment method, PIN & promo codes reachable from Event setup too** (same event-bound controls on an Event setup "Payments & promos" tab AND on Payments & settlement; PIN editable/regenerable any time; payouts/tracking/usage stay on Payments & settlement).
68. **Partial (saved-but-unpaid) registrations → director follow-up.** Capture a registration where contact + ≥1 team were entered but Payment wasn't completed; persist server-side keyed by enroller email + event; record last step + timestamps. Feed the director a per-event list (a Partial registrations tab on Teams) with Send reminder (SendGrid resume link), Copy email, Dismiss. Auto-clear on completion or manual registration. Shape in `kinectem-integration-contract.md` §7.
69. **Club/team logo everywhere a team is shown.** Carry a club `logoUrl` on the team (from Kinectem). Render it next to the team on the unscheduled-game cards (and the grid, public scoreboard, printed game cards); fall back to a monogram crest when there's no logo. Contract §2/§5.
70. **Unscheduled-game card legibility.** Each tray card reads group → divider → home (bold) + crest → VS divider → away (bold) + crest → divider → planned day; placeholders de-emphasized (muted italic, no crest). Scope card-size/spacing to the tray so compact on-grid blocks are unaffected.
71. **Multiple coaches per team + a designated HEAD coach.** A team can list several coaches (common when a club is already on Kinectem with its staff on file). **Every listed coach gets the team's email comms and email-scoped self-service** (view the team, update its scheduling requests). Exactly one is marked the **head coach** (per-coach radio/checkbox); the **head is the single coach identity conflict-detection groups on** — a head coach on >1 team is the multi-team case the scheduler avoids double-booking. Co-coaches never create scheduling conflicts. Data: a `team_coach` join (`team_id`, `coach_id`, `head`); keep `team.coach_id` as the denormalized head pointer the engine reads. When a Kinectem club registers, pull its coaches onto each team and let the director confirm the head (default first/primary). `coach.invite` fires for every coach email. See `kinectem-integration-contract.md` team.upsert `coaches[]` and scheduler-engine "carry over" #12. (Spec-captured Oct 25; **wired into the prototype V166**: Coaches worktable rows show a head-coach field plus a "Coaches (N) ›" button opening a management modal — add/remove coaches, each with name/email/phone, pick the one head coach via radio; co-coaches render a "+N co-coach" hint. Messaging/Compose now addresses **all** of a team's coaches — head registry email, co-coach emails, and any registration-collected `coachEmails[]` — labeled "all coaches of N teams". The engine still keys conflict detection on the single `coachId` = head, so co-coaches never create conflicts, exactly as specced. V167 adds a prominent "Why the head coach matters" callout in the modal explaining that the head is the one identity checked for double-bookings across all their teams.)
