# Tournament Director — Phase 1 Build Checklist (Replit)

**Goal of Phase 1:** run a real event end-to-end — import teams, build divisions/pools, auto-schedule, print game cards, score via QR, show standings/champions/stats, and publish a public site. Target: **Fall Finale (Nov 14–15).** Registration + payments are **Phase 2** (not in this list).

**How to use this:** work top to bottom — tickets are ordered so each builds on the last. Each ticket has a **Goal**, **Build**, **Done when**, and the **Ref** (doc section that backs it; all docs are in this folder). Build it as a module inside the existing Kinectem app (Competitions entity), not a new project. The prototype `prototype/tournament-director-app.html` is the clickable reference for every screen.

**Critical path:** TD-01 → TD-02 → TD-04 → TD-06 → TD-10 → TD-11 → TD-13. The rest can slot in around those or be done in parallel once the schema (TD-01) and shell (TD-02) exist.

**Legend:** 🟥 critical path · 🟦 can parallelize once its inputs exist.

---

## Foundations (do first)

### 🟥 TD-01 — Database schema & migrations
- **Goal:** the data model exists before any UI.
- **Build:** migrations for the new tables/columns in the handoff Data model — `competition` additions (style, hours, branding, pricing, scoring_config/gd_cap, drive_minutes, check_pin, stats_public/stats_published), `division`, `game_format`, `venue`/`venue_library`/`field`, `team` (+ `logo_url`, `kinectem_status`), `coach`, `scheduling_request`, `match`, `org_admin_access`, `partial_registration`, company/org defaults.
- **Done when:** migrations run clean on a Neon branch; a seed script can create one competition with divisions, venues/fields, teams, and matches.
- **Ref:** handoff → *Data model*.

### 🟥 TD-02 — Director console shell
- **Goal:** the workspace the director lives in.
- **Build:** three-column app shell behind the Competition Command Center — dark left-rail nav with the section groups (Company · Setup · Competition & matches · Game day · Results & share), tabbed content pages, routing. Reuse the Kinectem component system (not the social-post system).
- **Done when:** you can navigate every section (empty pages are fine); it reads as native Kinectem.
- **Ref:** handoff → *Where it plugs in (1)*, *Navigation / IA*, *Design system*.

### 🟥 TD-03 — Company settings + admins & access
- **Goal:** company-level defaults and multi-admin access control.
- **Build:** Company settings (identity, director contact, communication defaults, default fee tiers / field hours / game formats, public-hub toggle). **Company admins & access** — add admins (name+email), scope each to All or Only-selected tournaments; owner is always full-access. **Backend enforces scope at sign-in** (a restricted admin only sees/manages their events). Email invite on add.
- **Done when:** a second admin scoped to one event can sign in and see only that event; the owner sees all. Company defaults pre-fill a newly created competition.
- **Ref:** handoff → *Additions since V128 → Company & multi-event*, deltas 66; *org_admin_access* in Data model.

### 🟥 TD-04 — Event setup (tabbed) + per-tournament branding
- **Goal:** one place to configure an event; branding threads everywhere.
- **Build:** tabs **Basics · Branding & docs · Registration · Payments & promos · Communication · Scoring**. Style (Outdoor/Indoor — load-bearing for the scheduler), dates, Friday-night checkbox, default field hours, registration-question toggles. Branding = logo + primary/secondary colors applied as **CSS variables scoped to the event** across admin + public. Rules/waiver uploads. (Payments & promos tab can ship as the PIN + promo editor now; payment *processing* is Phase 2.)
- **Done when:** changing the logo/colors re-themes the console and (later) the public site; style switches the scheduler regime; dates drive the schedule days.
- **Ref:** handoff → *Event setup*, deltas 67; *Design system → per-tournament branding*.

---

## Setup & data-in

### 🟦 TD-05 — Divisions, game formats & pricing
- **Goal:** divisions with the right sizes, blocks, and fees.
- **Build:** add/order divisions; age→field-size defaults (editable); pricing by field-size group with per-division custom override (`price_custom`); game formats with **separate** play length / halftime and **pool block vs bracket block** per size; turnover-buffer warning.
- **Done when:** a division inherits the default price unless a custom fee is set; pool/bracket blocks are set per size.
- **Ref:** handoff → *Divisions & game formats*, *Pools & brackets (pool vs bracket blocks)*.

### 🟥 TD-06 — Venues & fields + reusable library + field-space monitor
- **Goal:** the physical capacity the scheduler packs into.
- **Build:** venues → fields with sizes; per-field per-day hours + blocked windows; **"shares space with" overlaps** (symmetric, mutually exclusive in time); a per-director **venue library** (save/add); the **field-space monitor** capacity table (per size, per day — the binding signal).
- **Done when:** a field's hours/blocks/overlaps persist; the monitor shows per-day slot supply vs games-need with short/tight/✓.
- **Ref:** handoff → *Venues & fields*; scheduler-engine → *Field-space monitor*, *Capacity analysis*.

### 🟦 TD-07 — GotSport import
- **Goal:** get a real event's teams in fast.
- **Build:** paste a Select-All GotSport export; parse teams, divisions, coaches, emails; **flag bracket-placeholder rows** (never surface as real teams); feed coach de-dupe (TD-08).
- **Done when:** importing the Fall Finale export creates teams/divisions/coaches with placeholders flagged.
- **Ref:** handoff → *Registration → Import from GotSport*.

### 🟦 TD-08 — Teams & coaches
- **Goal:** clean team + coach data (coach accuracy is what makes conflict detection work).
- **Build:** registered-teams table with filters (club/division/status/payment) + bulk select → message/edit + payment-type column; per-team coach email; **fuzzy coach de-dupe** with merge suggestions; **assistant-coach flag** per team; **TBD placeholder** teams (add N; fill-in swaps a real team or names in place). **Multiple coaches per team with a HEAD-coach selector (delta 71):** list all of a team's coaches (pulled from Kinectem for existing clubs), a per-coach "head" radio; all coaches get comms + email-scoped self-service; the head is the identity conflict-detection groups on; store via a `team_coach` join with `head`. *(Partial registrations tab is Phase 2.)*
- **Done when:** near-duplicate coaches merge to one; a team can carry several coaches with exactly one head; changing the head changes who the conflict detector treats as the multi-team coach; all listed coach emails receive comms and can update the team's requests; assistant flags and placeholders exist and feed the scheduler.
- **Ref:** handoff → *Teams & coaches* (delta 71), *Coach/club-admin access model*; scheduler-engine "carry over" #12.

### 🟦 TD-09 — Pools & brackets (click-to-place)
- **Goal:** assign teams to pools and order divisions.
- **Build:** **click-to-place** assignment (click a team, click a pool; auto-split 1–4), "Unassigned" strip as the un-assign target, locked (scheduled) teams show **Swap**; reorder divisions (sort by gender then age → carries to schedule + public); level shown organizer-only. Render the **impossible-matchup red flag + soft time-notice amber** per division here (day-aware; soft lean = finish ≤ 2 PM / start ≥ noon).
- **Done when:** teams land in pools via click-to-place (no native drag); a mornings-only vs evenings-only pair shows red, a Sat-AM vs Sun-PM pair shows amber.
- **Ref:** handoff → *Pools & brackets*, delta 53; scheduler-engine → *Impossible-matchup detection*.

### 🟥 TD-10 — Match creator (Formats & playoffs)
- **Goal:** turn divisions into games (fresh events start with **zero** matches).
- **Build:** per-division suggested format in plain English (from style + team count), **Create these games** (group + suggested playoff in one click), GAMES/PLAYOFF/DAYS drill-downs, Customize form; **Create ALL matches** capstone (approval checkbox) with a **pre-build banner surfacing impossible-matchup/soft-time flags**. Build `generatePlayoff` + match constructors as pure, tested functions.
- **Done when:** one click builds a division's group games + playoff with correct `feeds` advancement; Create ALL builds every division; the pre-build banner blocks on a red flag.
- **Ref:** handoff → *Match creator*, *Playoffs*.

---

## Scheduling (the hard part)

### 🟥 TD-11 — Scheduler engine (server-side job)
- **Goal:** produce a hand-quality schedule without blocking requests.
- **Build:** port the engine as a **background job** (Autoscale-safe) → returns `{results, unplaced, stats}`. **Hard rules first** (field/overlap, team-never-double-booked + invariant sweep, indoor one-site lock, outdoor team drive+warm-up, coach same-time assistant-exempt / no travel buffer, hours/blocks, group-before-playoff, max/day). Then the **backend-locked soft order + presets** (`r≈0.45`), divisions-clustered-at-one-home-venue, **Friday overflow for opted-in pairs only**, place-everything finish, **impossible-matchup pre-solve guard**. **Attempt-then-explain** result card. *(A direct port of the prototype's packer is fine for Phase 1; a CP-SAT/ILP solver can replace it later.)*
- **Done when:** on the Fall Finale data it places all physically-fittable games with **zero hard conflicts**, reports what it couldn't and why, and never ships a team double-booked or (indoor) split across sites.
- **Ref:** handoff → *Scheduler engine*; **scheduler-engine.md** (the deep reference) end-to-end.

### 🟦 TD-12 — Auto-schedule wizard (scheduling preferences)
- **Goal:** the director steers style + limits; the ranked optimization stays backend.
- **Build:** the "Scheduling preferences" wizard (opens **first**), suggested formula pre-selected (★ Suggested), style (spread/pack + cadence), settable limits (max/day, min rest, max wait, per-division rules), drive-time dial (explains team drive+warm-up vs coach-no-buffer). Cancellable **"building…"** state.
- **Done when:** running with defaults clusters correctly; the run shows a reliable progress + result state.
- **Ref:** handoff → *Scheduler → per-tournament scheduling brief*; scheduler-engine → *The custom autoscheduler*.

### 🟥 TD-13 — Schedule grid (click-to-place) + crest cards
- **Goal:** the director reviews and hand-adjusts the schedule.
- **Build:** horizontal timeline (time → across, field → down), **click-to-carry** placement with live green/red landing preview, sticky field column + time header, 15-min snap (5-min optional). **Unscheduled tray cards** read group → divider → home(bold)+crest → VS → away(bold)+crest → divider → planned day; placeholders de-emphasized; crest = `logo_url` with monogram fallback. Live conflict flags (hard red / soft amber) identical everywhere. Impact-preview toggle. Two-step confirms for unschedule / clear-all.
- **Done when:** a game can be lifted and dropped with a live legality preview; the cursor chip doesn't drop clicks; conflicts render in plain language.
- **Ref:** handoff → *Schedule management*, deltas 69–70; *Design system → interaction*.

### 🟦 TD-14 — Schedule views + fix-coach-clashes
- **Goal:** read and repair the whole event.
- **Build:** Chart · List · By team · By division + full-screen **Full breakdown** (Divisions/Teams/Coaches, searchable, day/site filters); **By-division flag-and-re-run** (re-schedules only flagged divisions); **"Fix coach clashes"** same-venue swap tool; per-coach report (3-color status).
- **Done when:** By-team shows every team's status; Full breakdown's Coaches lens merges a multi-team coach's day into one timeline; a coach clash offers same-venue swaps that resolve it.
- **Ref:** handoff → *Schedule management (breakdown, by-division)*, *Coach report*; scheduler-engine → *Full schedule breakdown*.

---

## Game day & results

### 🟦 TD-15 — Game cards + QR ref scoring
- **Goal:** printable cards and dead-simple on-field scoring.
- **Build:** printable cards (25 roster rows, tournament logo upper-left, **big bold field band**, no halftime-length line, **club crest per team**); each card a **QR** to an unauthenticated phone-first score page where **score is the hero** (`Home (score) v (score) Away`, big +/- steppers; cards a small secondary section). No backup PIN.
- **Done when:** a printed card scans to a phone page that writes the score back to the match; forfeits auto-apply 3–0.
- **Ref:** handoff → *Game cards & ref scoring*.

### 🟦 TD-16 — Scores, standings & champions
- **Goal:** correct standings and gated champions.
- **Build:** configurable points + ordered tiebreakers (incl. head-to-head); **max goal differential cap** (`gd_cap`) clamped into GF/GA/GD; champions stay "to be decided" until the deciding game is scored; one-click "email those coaches for scores."
- **Done when:** standings respect the tiebreakers and the GD cap; a champion appears only after its final is scored.
- **Ref:** handoff → *Scores, standings & champions*, *Playoffs*.

### 🟦 TD-17 — Tournament stats
- **Goal:** the "the games were competitive" recap.
- **Build:** director stats view overall + by group/division/club (% of ≤1-goal games incl. ties, avg margin, ties, PK finishes, most-competitive divisions, champions per division, clubs by champions, upsets in **playoffs + finals only**). **Per-stat "show on public page" toggle** + publish switch (`stats_public`/`stats_published`). Omit biggest margin / cards / comebacks.
- **Done when:** the director can toggle which stats are public and publish them; the public view (TD-18) shows only the selected, published blocks.
- **Ref:** handoff → *Tournament stats*, delta 63.

---

## Public

### 🟥 TD-18 — Public tournament site (on the existing competition page)
- **Goal:** families follow along; the event looks branded and native.
- **Build:** add **Schedule · Standings · Champions · Tournament stats (gated)** to the existing public competition page tabs; publish/unpublish gating (unpublished → clean "coming soon"); **every surface themed with the tournament's branding**; mobile scoreboard rows (club logo above name, **score in the middle**, winner emphasized, grouped by day); sponsor block (director's revenue) renders only when set.
- **Done when:** publishing makes the schedule/standings/champions/stats public and on-brand; it's clean at 360px with no horizontal scroll.
- **Ref:** handoff → *Public site*, *Where it plugs in (2)*.

### 🟦 TD-19 — Public links page
- **Goal:** one place to control every shareable link.
- **Build:** a Public links page listing every link (tournament site, live schedule, standings & scores, coach conflicts sheet, Tournament stats) each **off by default** with a visibility toggle + copy; **per-team follow links**. Main "Tournament site" toggle = publish/unpublish.
- **Done when:** each link can be toggled public/private independently and copied; per-team links work.
- **Ref:** handoff → *Public links*.

---

## Not in Phase 1 (don't scope-creep)
These are **Phase 2** — public registration link, the step-1 path split + guest one-team loop-back + guest-enters-once, provisional Kinectem pages + email identity (contract §1a/§1b), card/check payment + the $25 processing fee machinery, promo-code *redemption*, partial registrations (delta 68), messaging at scale, free-to-paid conversion. Build them after Phase 1 runs a real event. **Phase 3:** live public coach-conflict page, recap prompts per game, the in-app assistant on the real Claude/recap backend, assistant "act" mode.

## Confirm before these block you (from the handoff "Open items")
- Scheduler job placement under Autoscale (background worker vs queued task) — affects TD-11.
- Competitions schema reuse vs new tables — affects TD-01.
- Company-admin permission levels (which-tournaments vs also view-only/full) — affects TD-03.
- Club `logoUrl` plumbing from Kinectem — affects TD-13/TD-15/TD-18 (monogram fallback works until then).
- Design tokens vs the app's real CSS variables — affects TD-02/TD-04.
