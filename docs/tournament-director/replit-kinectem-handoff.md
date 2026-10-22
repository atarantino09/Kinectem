# Tournament Director — Replit / Kinectem Build Handoff

> **Companion doc — read first:** `tournament-director-status.md` is the living, authoritative record of what the clickable prototype actually does (now **Version 165**, same artifact URL). Where this spec and that status doc differ, **the status doc wins** — fold its "Spec deltas" (now **1–70**) into the sections below. **Read the "Additions since V128" section immediately below first** — it folds every feature added after this doc was first written (V129–V165) into the build, citing the delta numbers and the sections they touch.
>
> **Scheduler rules changed materially after this doc was first written — the status doc's deltas 42–46 and `scheduler-engine.md` are authoritative, and the "Scheduler engine" section below has been corrected to match. In short: (a) a team is never in two games at once (hard invariant); (b) the cross-venue travel buffer belongs to the TEAM (drive + warm-up), not the coach — a coach arrives at kickoff with no buffer; (c) for indoor/futsal a team plays its whole schedule at ONE site, which outranks a coach conflict; (d) a full-screen Divisions/Teams/Coaches breakdown and a By-division flag-and-re-run view exist.**
>
> **One global rule that supersedes any "drag" / "drag-and-drop" wording anywhere below:** every placement interaction in the app is **CLICK-TO-PLACE** — click to pick something up, click a destination to drop it, re-click / click empty space / Esc to cancel. This applies to the **schedule grid** (click-to-carry with a cursor-follow chip + live landing preview) and the **Pools board** (teams → divisions). (The scheduler priority ranking that previously used click-to-place is now **backend** — see "Optimization model" under Scheduler engine; it is no longer a director-facing interaction.) Native HTML5 drag is not used anywhere in the prototype — it caused text-selection and flaky clicks. Build click-to-place, not drag-and-drop.

## What this is

A build spec for turning the Tournament Director prototype into a real feature inside Kinectem. It is written for whoever builds it on Replit. The prototype (a single-file React app) is the clickable blueprint — this document says how to make it production, how it plugs into Kinectem, the exact data model, the scheduler rules, and the design system so the UI/UX is genuinely great and looks native to Kinectem.

**The one big idea:** this is not a new standalone app. The Tournament Director is the **director-facing half of the Competitions entity you already specced** (leagues + tournaments unified). It reuses Kinectem's existing Replit app, Postgres database, auth, SendGrid, Claude API, design system, and the temporary-team-page / free-to-paid conversion you already built for Full360 teams. Build it as a module in the existing app, not a fresh project.

---

## Additions since V128 — fold these in (V129–V165)

Everything here was added to the prototype after this handoff was first drafted. Each is a required part of the build; status-doc delta numbers and the sections they touch are cited. `kinectem-integration-contract.md` is the authoritative backend spec for the registration↔Kinectem events, provisional pages, email identity, partial registrations, and club logos. **None of the original detailed sections below are removed — these items refine and extend them.**

**Registration & onboarding** (extends *Registration*, *Teams & coaches*, *Payments & promos*):
- **Step-1 path split (delta 59):** a "Build your Kinectem club — 90 days free" card is the *only* bulk path; **guest is one team at a time** (no bulk/CSV on guest).
- **Guest one-team loop-back (delta 60):** register one team → info saved → "Register another team" (pre-filled) / "Done"; in-pass build-a-club upsell keeps carryover.
- **Guest enters the team once (delta 61):** the step-1 team auto-adds to the cart and its coach email pre-fills the Coaches step.
- **Guest checkout builds provisional Kinectem pages (delta 64; contract §1a):** emit `club.upsert`/`team.upsert` with `status:"provisional"`; live for the event (roster + recaps), storybook/full-admin withheld until claimed; no plan, doesn't consume the free trial.
- **Email is the identity (delta 65; contract §1b):** save enroller info; returning registrant adds teams to the existing club (no dup); first Kinectem sign-in with that email lands on the created pages = claim.
- **Accept-a-team confirmation (delta 58);** coach invites fire at payment, not trial end (delta 55); "processing fee," not "Kinectem fee."
- **Partial registrations (delta 68; contract §7):** a Partial registrations tab on Teams lists saved-but-unpaid sign-ups with Send reminder / Copy email / Dismiss; backend captures server-side and auto-clears on completion.

**Company & multi-event** (new Company settings surface above the per-event console; extends *Where it plugs in → Director console*):
- **Company admins with per-tournament access (delta 66):** add admins (name + email), scope each to All tournaments or Only selected (event list). `admins[] = {id,name,email,role: owner|admin, scope: all|some, eventIds[]}`; owner always full; **backend enforces at sign-in**; email invite on add. Confirm whether a view-only vs full level is also wanted.
- **Company settings** holds identity, director contact, communication defaults, default fee tiers / field hours / game formats, and the public-hub toggle; these pre-fill every NEW tournament and never retro-edit existing ones.
- **Payments & promos on Event setup too (delta 67):** the pay-by-check toggle + editable/regenerable PIN and the promo editor (event + shared library) live on an Event setup "Payments & promos" tab AND on Payments & settlement (same event-bound data). Payouts/Stripe, check tracking, and promo usage stay on Payments & settlement.

**Scheduling** (extends *Scheduler engine*, *Schedule management*):
- Suggested-formula default + clustering-on-open (delta 50); divisions clustered at one home venue = top priority (delta 48); Friday = capacity-driven overflow for opted-in pairs only (delta 49); venue fill order & finals (delta 47); place-everything + "Fix coach clashes" same-venue swaps (delta 51).
- **Impossible-matchup detection + soft time-notice (delta 53):** hard red when two teams in a division can never overlap; soft amber when they pull to different times of day. Day-aware, live, run as a **pre-solve feasibility guard** on the server. **Soft lean test: early = must finish ≤ 2 PM, late = can't start before noon** — don't fire on mild limits that share a wide midday band.
- **Part-of-day parsing must handle negation (delta 62):** "no games Sunday morning" → no games before noon, etc.
- **Unscheduled-card legibility + club crest (deltas 69–70):** tray cards read group → divider → home (bold) + crest → VS → away (bold) + crest → divider → planned day; placeholders de-emphasized. Show a club logo from `logoUrl` next to each team, monogram crest fallback; carry `logoUrl` everywhere a team is shown (cards, grid, public scoreboard, printed game cards).

**Results & in-app help:**
- **Post-tournament stats page (delta 63):** director view + gated public page (see the new "Tournament stats" screen section).
- **In-app AI assistant (delta 52):** context-aware, advise-first; its system prompt must map where *every* control lives, including payments/PIN, promos, company admins and event setup; reuse Kinectem's Claude/recap backend (the prototype uses the artifact `sample` capability as a stand-in).

---

## Where it plugs into the existing Kinectem UI (confirmed from the live app)

Don't build new shells — the surfaces already exist. Three placements:

1. **Director console → the Competition Command Center.** Today it shows the public/in-app link card and collapsible sections (How your competition works, Competition hub, Admins, Partnership pages), and says "Admins can manage this competition: schedule, branding, claims, recap curation." The Tournament Director is exactly that management console. Add a director workspace here with left-rail sections, mirroring the tool a director already knows (GotSport) but in Kinectem styling: **Setup · Divisions · Teams · Coaches · Pools · Venues & Fields · Payments & promos · Schedule · Scores · Standings · Playoffs · Check-in · Print cards · Messages · Sponsors · Publish.** The "Show me around" / "Open public view" buttons and the console-URL warning pattern stay. **Above the per-event console sits a Company surface — Company settings (identity, defaults, and Company admins & access, delta 66) and All tournaments (every event + create-new + per-event hub toggle).**

2. **Public tournament site → the existing public competition page.** The Columbus Day Cup page already has the tabs **Recaps · Photos · Teams · Schedule · Partners · Organizer guide**, a themed gradient hero, "Presented by" lockup, "X/Y teams telling their story," and "Copy public link." Make **Schedule** render the generated grid, add **Standings** and **Champions** (or fold Champions into Results), add the **Tournament stats** page (delta 63, gated until published), and keep Teams. Do **not** build a separate public site — the prototype's Profile/Teams/Schedule/Standings/Champions map onto these tabs. Sponsor = the existing "Presented by" treatment. Publish/unpublish = the public-view gating already in place.

3. **Platform admin → Admin → Tournaments / Schedule.** These sections already exist (alongside Promo codes, Competition links, Claims, AI Assist, Partner landing page). Wire director data and cross-event tournament management there; reuse the admin stat-tile + chart style for any tournament analytics.

Temp team pages, game recaps, and player auto-tag already run (the recap cards, "telling their story" counts, the GAME RECAP pill). Tournament games feed these directly.

---

## How it fits Kinectem

- **Competitions is the parent entity.** A tournament is a Competition of type `tournament`. The Tournament Director is the admin surface for it; the public site and team pages are the member-facing surface that already exists.
- **Every entered team gets a temporary team page** for that event (already how Full360 works today). Coaches can publish game recaps for tournament games, which auto-tag rostered players into their storybooks — the core Kinectem mechanic.
- **Free to register and play; subscribe to persist.** Any team registers and plays for free with no account. Afterward the temporary org/team/roster/recaps are offered as a one-click subscription conversion; if they don't convert, the temporary data isn't saved and they re-enter next time. The Tournament Director must create these temporary entities and mark them convertible. **Guest checkout still creates these as `status:"provisional"` (contract §1a), and the enroller email is the identity used to claim them later (contract §1b).**
- **Partner/promo codes already exist** (e.g. FULL36025 auto-applied: 90 days free, then 25% off). Registration must honor the same promo-code machinery.
- **Audiences and COPPA** are unchanged: Org Admins, Coaches, Athletes, Parents; COPPA-compliant by architecture. The director role is an Org Admin capability; **a company can have multiple admins scoped to specific tournaments (delta 66).**

---

## Tech stack (match the existing app — don't introduce new infra)

- **Runtime:** Replit Autoscale (current cap 5 instances). The scheduler is CPU-heavy in bursts — see "Scheduler" for where to run it so it doesn't block requests.
- **Database:** Neon / pooled Postgres (PG_POOL_MAX 10). Postgres-backed rate limiter already in place.
- **Email:** SendGrid (domain-authenticated) for registration confirmations, schedule-published notices, the "email coaches for scores" action, **coach invites (fired at payment), and partial-registration reminders (delta 68).**
- **AI:** existing Claude API key (separate from Max) — reuse for recap AI Assist on tournament games, the **in-app assistant (delta 52)**, and optionally a plain-language schedule/conflict summary (the prototype's Report view).
- **Auth & roles:** reuse Kinectem auth. New capability flag: `tournament_director` on an Org Admin, **scoped per competition for restricted admins (delta 66).** Public pages and the ref score page are unauthenticated by link.

---

## Data model

Add these tables/entities (names illustrative; fold into existing Competitions schema where it already covers them).

- **competition** (existing) — add `kind = 'tournament'`, `published boolean`, `style` ('outdoor'|'indoor' — drives suggested formats **and the indoor one-site-per-team scheduling lock**), `day_start int`, `day_end int` (minutes from midnight; event-wide default field hours), `friday_night boolean` (optional Friday-night session — extra drag-on grid space, NOT a scheduling day), `max_games_per_team_per_day int`, **branding** (`logo_url`, `brand_primary`, `brand_secondary`, optional `banner_url`), sponsor fields (`sponsor_name`, `sponsor_logo_url`, `sponsor_url`, `sponsor_tagline`), **`rules_file_url`** (uploaded doc — no plain-text rules), `size_prices jsonb` (default entry price per `game_size`: 7v7/9v9/11v11), `grid_step int` (15 default / 5), `scoring_config jsonb` (includes `gd_cap` — max goal differential per game), `tiebreakers jsonb`, `priority_order jsonb`, `back_to_back boolean`, `drive_minutes int` (drive time between sites; the team's cross-site gap = this + ~30 min warm-up). Payments: `processing_fee_per_team` (default 25; coach-facing name "processing fee"), `credit_window_days` (default 7), `allow_check boolean`, `check_pin` (**editable/regenerable any time — delta 67**; shown only on selecting check), `director_name`, `director_email`, `director_phone` (shown to teams without the PIN). **Stats (delta 63):** `stats_public jsonb` (per-block show-on-public selections), `stats_published boolean`.
- **company / org defaults** (new or existing org settings — delta 66) — company identity, director contact, communication defaults, `fee_tiers jsonb`, default field hours + `max_per_day`, default `game_formats jsonb`, `hub_published boolean`. **These pre-fill every new competition and never retro-edit existing ones.**
- **org_admin_access** (new — delta 66) — `org_id`, `admin_email`, `admin_name`, `role` ('owner'|'admin'), `scope` ('all'|'some'), `event_ids jsonb` (when scope='some'). Owner is always full-access and can't be removed. Backend enforces which competitions a restricted admin can see/manage at sign-in; adding a row sends an email invite. (Optional future: a `permission_level` — view-only vs full.)
- **promo_code** — `competition_id` (null = shared library code available to all events), `code`, `kind` ('pct'|'amt'), `value`, `label`, `active boolean`. A join (`competition_id` × `shared_code_id` → on/off) records which library codes a given event has enabled. **Editable from both Payments & settlement and Event setup → Payments & promos (delta 67).**
- **division** (age group) — `competition_id`, `name`, `entry_fee`, `price_custom boolean` (false = inherits `size_prices[game_size]`; true = fee set by hand), `max_teams`, `game_size` (7v7/9v9/11v11; defaulted from age — U8–U10 7v7, U11–U12 9v9, U13+ 11v11 — but editable), `round_robin_only boolean`, `playoff_format`, `round_days jsonb` (per-division override: which day each group round + playoffs play).
- **game_format** — per `game_size` within a competition: `play_minutes` (the real clock), `halftime_minutes`, `pool_slot_minutes`, `bracket_slot_minutes`. **Keep play time and scheduling block as separate fields, and pool block vs bracket block as separate fields** — both were deliberate requirements.
- **venue** — `competition_id`, `name`, `address`.
- **venue_library** — per director/org, reusable across every competition they run: `owner_id`, `name`, `address`, `fields jsonb` (name, sizes, overlaps). Adding a library venue to an event copies it into `venue`/`field`. Saving a venue writes it here.
- **field** — `venue_id`, `name`, `sizes[]`, `hours jsonb` (per-day open/close/closed), `blocks jsonb` (per-day blocked windows), `overlaps[]` (field IDs it physically shares space with — symmetric).
- **team** — `competition_id`, `division_id`, `name`, `club`, `level` ('beginner'|'travel'|'premier' — shown organizer-only), `coach_id`, `has_assistant boolean` (feeds scheduler), `paid`, `status` (accepted/waitlist/declined/withdrawn), `bracket` (pool letter), `checked_in`, `roster` (optional), `placeholder boolean` (TBD slots AND imported bracket-placeholder junk — never surfaced as a real team), `kinectem_team_id` (link to the persistent Kinectem team once converted), `pay_method` ('card'|'check'), `saved_card boolean` (save for future events), `promo_code`, **`logo_url`** (club crest from Kinectem; monogram fallback — deltas 69, contract §2/§5), **`kinectem_status`** ('active'|'provisional' — mirrors the club's claim state, contract §1a).
- **coach** — `competition_id`, `name`, `email`, `phone`. De-duped by fuzzy name match (see Coaches). Email is also the **authorization key** for coach self-service (see access model).
- **scheduling_request** — `team_id`, `note`, `before`, `after` (minutes), `via` ('registration'|'coach_signin'), `changed_at`, `acked boolean` (director acknowledged). **Natural-language parsing must handle negation (delta 62).**
- **match** — `competition_id`, `division_id`, `game_number`, `home_team_id`, `away_team_id`, `is_playoff`, `round`, `label`, `field_id`, `date`, `start` (minutes), `planned_day` (which event day the generator assigned it), `slot_minutes`, `status` (scheduled/final/ff_home/ff_away/canceled/postponed), `home_score`, `away_score`, `home_pk`, `away_pk`, `forfeit`, `note`, `feeds jsonb` (playoff advancement: which match's winner/loser feeds this slot).
- **partial_registration** (new — delta 68, contract §7) — `competition_id`, `enroller_name`, `enroller_email`, `enroller_phone`, `club`, `teams jsonb` (`[{name, group_suggestion}]`), `last_step`, `started_at`, `last_seen_at`, `nudged_at` (nullable), `resolved boolean`. Captured when contact + ≥1 team were entered but the Payment step wasn't completed; auto-cleared when they complete checkout or the director registers them.
- **recap** (existing Kinectem) — linked to `match`; publishing auto-tags rostered players.

Relationships: competition → divisions → teams; competition → venues → fields; division → matches; match ↔ teams; team ↔ coach; match → recap; org → org_admin_access; competition → partial_registration.

---

## Screen-by-screen build spec

Each maps to a prototype screen. Build them as Competitions admin tabs.

**Navigation / information architecture (refined with Andrew).** Director left-rail sections and items:
- **Company (above the per-event console):** **Company settings** (identity, director contact, communication defaults, default fee tiers / field hours / game formats, the public-hub toggle, and **Company admins & access** — delta 66) · **All tournaments** (every event, create-new, per-event hub toggle).
- **Setup:** Event setup · Age groups & pricing · **Divisions** (renamed from "Brackets" — organizes/orders the divisions) · Teams · Import (GotSport) · Bulk add teams · Payments & promos. **Scoring & standings rules live inside Event setup** (not a separate nav item), and the same rules render on the public standings page. There is **no standalone "Bulk register" director item** — bulk register is a self-service action on the registration/Teams flow for the people signing up, not a director destination.
- **Competition & matches:** **Pools** (moved here) · **Formats & matches** (tabs, in this order: **Formats & playoffs · Group play · All matches**). Formats & playoffs is the primary tab and the default. **Format and playoff are suggested per division and fully editable** — see "Match creator" below. **Add a TBD placeholder team** from the tab and from Teams.
- **Game day:** Coaches & conflicts · Check-in · Messages · Schedule · Scores · Game cards · Champions.
- **Share & follow:** **Public links** (see below) · **Tournament stats** (delta 63) · Public schedule · Report.
- **Pricing clarity:** on Age groups & pricing, a prominent "Add a division" callout sits near the top explaining that a new division takes the field-size default price unless you type a custom entry fee when adding it (or editing it later); the Add-division form has a "Custom entry fee — leave blank for the field-size default" field.
- The in-app **Assistant** (delta 52) floats bottom-right on every page.

### Public links (Share & follow)
A single page listing **every shareable public link**, each **off (private) by default**; the director flips one on to make it public and copies it. Links: the full tournament site, team registration, live schedule, standings & scores, the coach scheduling/conflicts sheet, **the Tournament stats page (gated until published, delta 63)** — plus **per-team follow links** (one per team, copy-to-clipboard). Toggling one off takes just that link down. The main "Tournament site" toggle maps to publish/unpublish; the rest are independent visibility flags.

### Event setup
One clean page, now **tabbed: Basics · Branding & docs · Registration · Payments & promos · Communication · Scoring** (delta 67). Basics: name, dates, location, divisions offered, registration questions (toggles for club / state / coach / scheduling requests), **event-wide default field hours** (easy seasonal adjust for no-lights fields), **tournament style (Outdoor/Indoor)**, Friday-night checkbox. Branding & docs: **branding** (logo + primary/secondary colors), rules/waiver uploads. **Payments & promos: the pay-by-check toggle + editable PIN and the promo editor (event codes + shared library) — same controls as Payments & settlement.** Communication: from-name, reply-to, notify emails, event alert banner. Scoring: points, ordered tiebreakers, `gd_cap`. Persist to `competition`.
- **Tournament style (Outdoor / Indoor) drives suggested formats AND the scheduler regime.** It is a starting suggestion for *formats* only — every division's format, playoffs, rounds and day splits stay fully editable in the Match creator. But for scheduling it is load-bearing: **Indoor turns on the one-site-per-team hard lock** (a team never crosses venues) and routes to the venue-anchored packer; Outdoor lets teams cross sites with a drive+warm-up gap. State the format part plainly in a callout ("These are only starting suggestions — you stay in full control"). New tournaments inherit the style from company defaults (default outdoor).
- **Event dates ARE the scheduling days.** Make this explicit and brief. **Friday is NOT a scheduling day unless it is a full day set as the start date.** A Friday-night-only session is an optional checkbox that adds extra drag-on space in the chart, not a scheduling day.
- **Tournament rules = the uploaded document only.** There is no plain-text rules field. The director uploads the rules/waiver PDF(s); families and coaches open and view the document. Store the file and surface an "Open rules" link everywhere rules are referenced.
- **Per-tournament branding (important to Andrew).** The director sets a **logo**, a **primary color**, and a **secondary color** at setup. **Every surface the director and the public see for that tournament is themed with them**: admin console accent, public site hero/accents, printed game cards (logo upper-left), registration, and the mobile follow-along view. Store `brandPrimary`, `brandSecondary`, `logo`, and an optional `banner` on `competition` and thread them through as CSS variables per tournament. Build this early — it's foundational.
- **Sponsor = the tournament's OWN revenue.** The sponsor block is a way for the *director* to make money (sell the banner/logo spot to a local business), **not** a Kinectem-run sponsorship. Label it that way ("Your sponsor — your revenue"). Logo upload + click-through link + tagline; renders nothing when unset.

### Registration (three paths)
- **Bulk register** — grid + paste, one row per team.
- **Import from GotSport** — paste a Select-All GotSport export; parse teams, divisions, coaches, emails. **Bracket-placeholder rows ("Bracket A #3" etc.) must be flagged as placeholders and never surfaced as real teams** anywhere.
- **Public registration link** — coach-facing form: club, division dropdown (Beginner/Travel/Premier), coach name/email/phone, scheduling request, promo code. Creates a temporary team + temporary Kinectem org/team page.
- Free/paid badges; flag Kinectem clubs; "select all → send message" and "edit registrations" bulk actions.
- **Payment at sign-up** (see "Payments, fees & promo codes"): credit card is the default; pay-by-check is unlocked by a PIN; a promo-code field discounts the entry fee live.
- **Value-at-sign-up:** the form shows a short "what your Kinectem subscription does — all season, not just this weekend" summary. Keep it on the form.
- **Additions since V128 (must build):** the **step-1 path split** (delta 59 — bulk = build a club; guest = one team at a time), the **guest one-team loop-back** (delta 60), **guest-enters-the-team-once** auto-carry to the coaches step (delta 61), the **accept-a-team confirmation** (delta 58), **guest checkout → provisional Kinectem pages** (delta 64, contract §1a), and **email-as-identity** returning/claim behavior (delta 65, contract §1b).

**Register-a-team UX — a clean stepped wizard (Andrew's chosen direction, modeled on Athletes2Events/Surf Cup):**
- Build registration as a **multi-step wizard with a branded step rail**, not one long form. A colored left rail (themed with the tournament's primary/secondary colors) shows the **event name and all the steps at once**, current step highlighted, completed steps check-marked; the right side shows **one focused step at a time** with a big **Continue →** button (and **Back**).
- Steps: **1) Your account** (coach name, email — with the "why your email matters" callout — and phone) → **2) Team details** (team name, club with Kinectem prefill, age group, level, assistant-coach checkbox) → **3) Rules & requests** (open rules + waiver, agree, add a scheduling request) → **4) Payment** (promo code, entry fee, card/check with PIN, save card, processing-fee explanation, subscription value). Gate each step's Continue on its required fields.

**Register-a-team page — specific requirements (Andrew called these out):**
- **Coach email is the hinge of the whole product — emphasize it.** Optional to submit but the form explains *why*: (1) that coach gets schedule updates and comms directly, and (2) it's how they sign back in later to **see their club's teams and add/update scheduling requests**. Show an importance callout, not just a field label.
- **Prefill for Kinectem clubs** — pull the coach name and email from the club/team page, **editable**.
- **Scheduling requests are collected here but updatable later** — tell the coach they can sign back in with their coach email and change the request any time before the schedule locks.
- **Save card for future events** — a "save this card for future Full360 events" checkbox.
- **Bulk register must be reachable from here** — a "registering a whole club? bulk register" entry (the build-a-club path; delta 59).
- **"Processing fee," not "Kinectem fee."** Everywhere coach-facing.
- **Pay-by-check PIN appears on selecting check.**
- **Assistant-coach checkbox** — feeds the scheduler (an assistant lets the head coach's two teams play at once, see Scheduler engine).

### Teams & coaches
- Registered-teams table with filters (club/division/status/payment), bulk select → message / edit. **Include a payment-type column** (Card / Check). **Tabs: Registered teams · Registration link · Partial registrations · Rosters & waivers.**
- **Per-team coach email** required.
- **Coach-conflict de-dupe:** fuzzy-match near-duplicate coach names, present merge suggestions, merge so one coach is counted once. This accuracy is what makes conflict detection work.
- **Assistant-coach flag per team** — tells the scheduler the head coach can run two games at once.
- **TBD placeholder teams** — add N to a division to start scheduling before late teams register; "Fill in" swaps in a registered team (repoint matches) or names the placeholder in place.
- **Partial registrations (new — delta 68, contract §7):** a tab listing saved-but-unpaid sign-ups — enroller name/email/phone/club, the team(s) + suggested group, how long ago they started, and the last step reached — oldest-first. Per row: **Send reminder** (SendGrid resume link; stamp `nudged_at`), **Copy email**, **Dismiss** (`resolved`). Auto-clears when they complete checkout or the director registers them.

**Coach / club-admin access model (Andrew's requirement — build this in the backend):**
- **Coaches & conflicts, and a club's own team records, are only accessible to the person who registered those teams and to the per-team coach emails on file.** Signed-in, they see **all their club's teams — only those** — and can update their own scheduling requests.
- Spec it as email-verified access (magic link or Kinectem login), scoped to the club/teams that email is attached to.
- **Coaches can return and update requests any time before the schedule locks.** A changed request lands in the director's **Coaches & conflicts → requests** list flagged *new / updated — needs your OK*; the director ticks a checkbox to acknowledge (with "Acknowledge all"). Store `via`, `changedAt`, `acked`.

### Payments & promos
- Payment method (card default) + the pay-by-check **PIN** (editable/regenerable any time) and **director contact**; the list of check teams with "mark received."
- Promo codes: this-event codes (add/edit/toggle) and the shared library with per-event on/off.
- **Reachable from both Payments & settlement and Event setup → Payments & promos (delta 67).** Payouts/Stripe and promo-usage analytics stay on Payments & settlement.
- Full behavior in "Payments, fees & promo codes" below.

### Divisions & game formats
- Per division: fee, cap, game size, playoff format.
- **Age → field size defaults (auto-set, adjustable).** U8–U10 → 7v7, U11–U12 → 9v9, U13–U19 (allow up to U23) → 11v11. Only a default — editable. (Field size also drives which fields a game is eligible for.)
- **Pricing: default by field-size group, override per age group.** Track a `priceCustom` flag per division.
- **Game formats / scheduling blocks** card: the **scheduling block** is the primary control; **game play length + halftime** is secondary reference. Turnover-buffer check warns if a block is shorter than play + halftime. See Pools & brackets for pool-block vs bracket-block.

### Match creator (the Formats & playoffs tab — suggestion-first)
- **Fresh events start with ZERO matches** — divisions list their teams only; the director creates games here.
- **Per division:** a **division bar** (◀ ▶ stepper + dropdown, built/not-built badge), then a **Recommended format** card in plain English from the Outdoor/Indoor style + team count, with a single **Create these games** button that builds group games **and** the suggested playoff in one click.
- **Drill-downs:** GAMES / PLAYOFF / DAYS lines expand to the real detail (matchups by round, the bracket, each day's games).
- **Suggested format rules (all editable):** Outdoor — 4 → RR + Final + Consolation (11v11 → Final only); 5 → RR, no playoff; 6+ → two groups of 3 → crossover semis + Final + 3rd. Indoor — 3-game round robin, no playoff (addable).
- **Customize** (behind a toggle): a clean form — a single **Format** dropdown, the chosen format's options, compact validation chips, and a live **Preview**.
- **Create ALL matches capstone:** an overview lists every division + format + built-status, a **confirmation checkbox**, and one big **Create ALL matches** button (disabled until approved) that builds group games + playoffs for all divisions in one pass. **A pre-build banner surfaces any impossible-matchup/soft-time flags first (delta 53).**

### Venues & fields
- Venues with multiple fields; per-field sizes.
- Per-field, per-day **availability** (default from the event-wide hours) and **blocked windows**.
- **"Shares space with"** — mark fields lined on top of each other; the scheduler treats overlapping fields as mutually exclusive in time.
- **Reusable venue library across ALL the director's tournaments.** Save created venues (with fields and sizes) to a per-director/org library; "your saved venues · tap to add."
- **Field-space monitor** — a per-size capacity table (Size · Fields · slots/day · Total · Games need, short/tight/✓) + per-field per-day slot counts, so the director spots a crunch before scheduling. Per-day columns are the binding signal.
- **Venue fill order & finals (delta 47)** — rank which venues/fields fill first (per-size), and mark a preferred finals field (soft, championship Final only, within the division's own venue).

### Pools & brackets
- **Assign teams to pools by CLICK-TO-PLACE** (click a team, then click a pool/division; auto-split 1–4), writing each team's bracket letter. Even auto-fill grid, tier-colored headers, full-width **"Unassigned" strip on top** as the un-assign target. Locked (scheduled) teams can't move and show a **Swap** action. No native drag.
- Reorder divisions (one-click sort by gender then age); order carries to schedule + public.
- **Show each team's level on the team line, organizer-only, small text** — not shown to the public.
- **Impossible-matchup red flag + soft time-notice amber (delta 53)** render here per division.

**Pool blocks vs bracket blocks — make it explicit:**
- Both are *scheduling blocks*; a **pool block** is the window for group/pool play, a **bracket block** for playoff/bracket games. Separated because playoffs often need a different length/buffer and must schedule after pool play finishes. Set each independently per game size; label them "Pool block" and "Bracket block."

### Auto-scheduler
Covered in its own section below.

### Schedule management
- **Views: Chart · List · By team · By division**, plus a full-screen **Full breakdown** (see below). A shared filter bar drives Chart and List: search by game # or team, plus division, team, field, status, and scored/unscored. In Chart, matches are highlighted and the rest dimmed; in List, rows filter and columns sort.
- **Chart is a HORIZONTAL timeline:** time runs left→right across the top, one row per field down the side. Game blocks sit in their field's row at their start time, width = the reserved block. **Placement is CLICK-TO-CARRY:** click a game (tray or placed) to lift it onto the cursor; hover the grid to preview the landing block live (green fits / red collides); click a cell to drop; click tray / outside / navigate / Esc to release. Field label column sticky left; time header sticky top; grid scrolls horizontally. The cursor-follow chip moves via a ref/overlay that does NOT trigger React re-renders, or single clicks get dropped.
- **Unscheduled-game tray cards (deltas 69–70):** each card reads **group → divider line → home team (bold) + club crest → VS divider → away team (bold) + club crest → divider → Planned day**; "Open Spot"/"Winner of…" placeholders de-emphasized (muted italic, no crest). The crest is the club logo from `logoUrl`, monogram fallback. Card size/spacing scoped to the tray so the compact on-grid blocks are unaffected.
- **The match chart uses the FULL screen width.** The Coach chart, Conflicts, and Coaches-on-the-move panels sit in a **full-width row BELOW the grid**.
- **Snap interval toggle: 15 minutes by default, 5 minutes optional.**
- Edit any game (reschedule, swap teams, status, note, delete, unschedule). **Unscheduling is a two-step confirm**; **Clearing the whole schedule is a two-step confirm** (Undo available).
- Forfeit auto-applies 3–0 and records which team forfeited.
- Live conflict flags in plain language (hard red / soft amber), shown identically on grid, list, and panels. Hard conflicts now include **team-in-two-games-at-once**, **team split across sites (indoor)**, and **team can't drive + warm up between sites in time**; the **assistant-covered coach overlap** is amber.
- **Impact preview.** A toggle in the toolbar. Off (default): a move/swap commits instantly. On: before committing, a right-side drawer previews the change against the WHOLE board — a verdict banner (Confirm disabled on a hard conflict), "the change," and every team/coach affected with conflicts before→after. **Instrument every confirmed manual move/swap as a training signal for the backend weights.**
- **"Fix coach clashes" tool (delta 51):** when a hard coach clash exists, offer per-clash same-venue swaps that clear it or move it to a coverable coach — never scattering a division or double-booking a team.

**By-division review + flag-and-re-run.** The **By division** view lists every division with each team's full schedule and a **Flag this division** button. Flagging raises a banner with **Clear flags** and **Re-schedule flagged** — re-runs only the flagged divisions (schedule-around keeps the rest untouched).

**Full breakdown (full-screen, searchable).** A **"Full breakdown"** button opens a full-screen view with three lenses — **Divisions · Teams · Coaches** — so a director can learn the whole event. Divisions/Teams show every game (day · time · field **(site)** · opponent) with status and issues. The **Coaches** lens merges each coach's teams into **one chronological timeline** (team, opponent, time, field+site, division), marks the **venue hops** as neutral ("coach can arrive at kickoff"), and flags any true **same-time overlap** in red. Top bar: search (team/coach/division/opponent/field), day + site filters, Only-issues toggle. Build this as the director's reference/learn surface.

**Per-team check ("By team" view).** Lists **every team** with its game times (day · time · field · opponent chips) and a single status — **All good** or **N to check** with the exact issues. Filterable by division, team, search.

### Check-in
- Optional roster (paste/attach/skip); the gate is an affirmation checkbox + typed signature. Progress bar.

### Game cards & ref scoring
- Printable cards, 25 roster rows, light header, score boxes, goal + misconduct logs, ref signatures.
- **Card layout:** tournament logo upper-left (color fine); **remove the halftime-length line** (game length / halves only); make the **field name + field number big and unmissable** (a bold field band — managers sort stacks by field). **Show each team's club logo/crest (`logo_url`, monogram fallback — delta 69).**
- Each card carries a **QR code** to an unauthenticated, phone-first score page where the **score is the dominant element**. No backup PIN.
- **Ref score entry: score sits in the MIDDLE of the two team names** — `Home (score) v (score) Away` — big +/- steppers. Cards (red/yellow) are a small secondary section.

### Scores, standings & champions
- Configurable points + ordered tiebreakers (incl. head-to-head among tied teams).
- **Max goal differential per game** — the director caps how many goals of differential one game contributes to GD (e.g. cap 6 → a 10–1 win credits +6, not +9). Clamp the margin when computing GF/GA/GD; label with the example.
- Champions stay "to be decided" until the deciding game is scored; one-click "email those coaches for scores."

### Tournament stats (new — delta 63)
A director stats view and a gated public version summarizing the finished event **overall and by group / division / club**: overview, **% of games decided by ≤1 goal (ties included)**, average score margin, ties, PK finishes, most-competitive divisions, champions per division, clubs by number of champions, and **upsets in playoffs + finals only** (lower seed beats higher seed). **Omit** biggest margin of victory, fair-play/cards, and comeback wins — the framing is "the games were competitive." Each stat block has a **"show on public page"** toggle (select-all / clear-all + a publish switch); the public page renders only the selected, published blocks. Data: `stats_public`, `stats_published` on `competition`.

### In-app assistant (new — delta 52)
A context-aware chat (bottom-right on every page) grounded in the live competition (divisions, fields, schedule status, settings). **Advise-first** — it names the exact control and page, it doesn't change anything itself (a confirm-gated "act" mode is a later v2). Its system prompt must map where **every** control lives, including payments/PIN, promo codes, company admins and event setup, and never reference a page that doesn't exist. Back it with Kinectem's existing Claude/recap integration (the prototype uses the artifact `sample` capability as a stand-in). A Help & guides explainer + FAQ describe it.

### Playoffs
- Per-division format with a smart default by size; round-robin-only option.
- **Manual seeding override**; later rounds come in as TBD slots that fill as results land (`feeds`).
- **Playoff formats offered (size-aware cards):** Round-robin-only; Final only (1v2); Final + Consolation (1v2 & 3v4); 4+ → Semis+Final+3rd, Semis+Final, **Double-chance / Page playoff**; 8+ → Quarters→Final+3rd, Quarters→Final; two-bracket → Crossover and Bracket-winners Final. Every format builds its full game list with winner/loser advancement. Easy future additions: full placement bracket, standalone 3rd-place toggle, top-2-of-two-groups crossover.
- **Note on prototype internals:** `generatePlayoff` and its match constructors are now defined pure functions; build them as plain tested functions, not implicit globals.
- **Bulk add teams** stays a director tool (separate from public self-service registration).
- **No standings table inside the bracket-templates / matches screen** — standings belong on Scores/Standings and the public site.

### Public site
- Tabs: Profile · Participating teams · Schedule · Standings · Champions · **Tournament stats (gated until published)**.
- "Find your team" + pin "My teams."
- **Publish / Unpublish** gates the public link; unpublished shows a clean "coming soon."
- **Every public surface is themed with the tournament's branding.**
- **Mobile schedule/standings must be clean like GotSport's mobile view:** each game row a scoreboard — each team's org/club logo ABOVE the name, both centered, **score in the MIDDLE**; winner emphasized, plus game #, field, day/kickoff; grouped by day. Standings a simple legible table.
- **Sponsor** (the director's own revenue) logo links out; renders nothing when unset.

### Company tournament hub (public)
A lean public page listing **all of the company's tournaments** a director chooses to show — logo, name, dates, location, price, Register link per event, each separated with a brand-color rail. Director toggles each event On/Off (`competition.hub`) and publishes the hub (`company.hubPublished`). A simple roll-up, not the fuller browse-all-Kinectem page.

### Messaging
- Email all / filtered teams; pulls coach emails; merge tags ({coach}/{team}/{club}/{division}/{age}); live preview; history. Send via SendGrid.

---

## Scheduler engine (the hard part — spec it exactly)

Port the prototype's greedy, priority-weighted scheduler. Run it as a server-side job (not in the request thread); return results to the grid when done. **Deepest reference: `scheduler-engine.md`.**

### Optimization model — BACKEND / proprietary (supersedes the "director ranks them" language below)

**Decision (Oct 2026, Andrew): the optimization ranking is Kinectem's secret sauce and comes OUT of the director UI.** The director sets the **Scheduling style** (Spread out / Pack together + cadence) and the **settable limits** (max games/team/day, min rest, max wait, per-division windows/notes). The ranked optimization order, its weights, and the per-event-type presets live in the backend and are never shown. The engine also learns from real director behavior (Learning loop).

**Two layers, different jobs.**
- **Hard rules are a GATE, not a score.** Any candidate placement that breaks one is discarded before scoring. (Full list below.)
- **Soft priorities are the SCORE** — they only choose among placements that are already legal.

**Weight-from-rank rule.** `weight(rank) = BASE × r^(rank−1)` with `r ≈ 0.45`, `BASE = 100`; steep decay ⇒ near-lexicographic. Each soft term is a normalized 0..1 penalty × its weight; candidate score = the sum. `r` is the single tuning dial, tuned per preset from real swap data.

**Locked default soft order — the active core (1–9), always on:**
1. `cluster` — a division on nearby fields, in one time block
2. `req` — honor team time requests
3. `fieldgap` — keep fields busy (fewest empty gaps between games on a field)
4. `coachTime` — a multi-team coach's games close together in time
5. `divtime` — a division's kickoffs at a similar time each day
6. `idle` — keep each team under the max-wait (3h default)
7. `compact` — finish the day as early as possible
8. `spread` — spread a team's games out for rest (auto-off while a packing style is on)
9. `oot` — out-of-town teams get later kickoffs

> **Travel is NOT a soft coach goal anymore (changed V127).** The old `venuetravel` soft buffer for coaches is removed. Travel is now a **hard** team rule (drive + warm-up across sites) and a **non-issue for coaches** (they arrive at kickoff). Keeping a multi-team coach's teams at one venue can remain a *weak* soft nicety for outdoor (`coachVenue`, situational), but it is never a hard rule and is expected-and-fine for indoor (where each division is pinned to a site). Do not reserve any coach travel buffer.

**Situational toggles — OFF by default, enabled per event/preset:**
- `coachVenue` — keep a multi-team coach's teams at one venue (weak; outdoor only; cosmetic since coaches travel free).
- `agewindow` — youngest earlier, oldest later. Auto-scoped: on only when a division's games all share one field size (indoor / same-size court); auto-disabled on mixed-size outdoor.
- `heat` · `restfair` · `slotfair` · `load` · `rematch` · `balance` — as previously specced.

`refcontinuity` is intentionally **not** included — ref assignment is outsourced.

**Placement algorithm (how one game lands):**
1. The match list is INPUT — the engine never invents or drops games.
2. Order placements **most-constrained-first** (narrow windows, multi-team coaches, teams with requests).
3. Division-level goals seed a field + time **block** first; the division's games are placed inside it. **For indoor, each division is anchored to a single site with enough court-time, and a team is locked to that one site.** **Divisions-clustered-at-one-home-venue is the top priority outdoor too (delta 48), with a per-day capacity check.**
4. For each game, build the candidate list = every field × day × start-slot that passes the hard gate (including field-size eligibility, the indoor one-site lock, and the outdoor team drive+warm-up gap). Score each, pick the lowest-penalty slot.
5. **Improvement passes:** local search (move/swap pairs, keep any change that lowers total weighted penalty). Same math as Impact preview. Then a **final invariant sweep** removes any same-team time overlap, and a **Rule #1 fill** seats anything still legal. **A place-everything finish will accept an amber coach double-book rather than leave a placeable game unplaced (delta 51).**

**Per-event-type presets.** The locked order, active toggles, and `r` are stored as presets (Outdoor 2-day vs Indoor 1-day) selected automatically from event style.

**Learning loop.** Every manual director swap (via Impact preview) is a labeled signal. Instrument confirmed moves/swaps.

**Hard rules (never broken) — CORRECTED to V128:**
- A field is never double-booked.
- **Overlapping fields** (lined on the same space) are never both in use at once.
- **A team is never in two games at once** — enforced per-placement AND by a final invariant sweep that pulls any residual same-team overlap off the grid (to the tray, with a reason) and re-fills. Never ship a team double-booked.
- **Indoor / futsal: a team plays its WHOLE schedule at ONE site.** A team never crosses venues on an indoor event; this **outranks avoiding a coach double-book** (prefer an assistant-covered coach clash over splitting a team across buildings). Lock each team to a single venue in every placement path; assign each division a site with capacity up front; route indoor to the venue-anchored packer. Leave a game in the tray rather than split a team. A split team is a hard red conflict.
- **Outdoor: a team crossing to a different site needs drive + warm-up time between its games** (`drive_minutes + ~30` warm-up). Never book a team back-to-back across two buildings without that gap; a violation is a hard red conflict.
- **A coach is never in two games at the same clock time, UNLESS one of that coach's clashing teams has an assistant** (then the head coach covers one, the assistant the other — downgraded to an amber "assistant can cover one" advisory). **A coach needs NO travel buffer between venues** — an assistant can start and the coach arrives at kickoff. (This replaces the old "coach needs 10 min between venues" rule.)
- Games stay inside each field's hours and never land in a blocked window.
- Group play for a division finishes before that division's playoffs (`bracket-seq`). (Strict round *order* within group play is NOT a hard rule.)
- **Max games per team per day** is a hard rule (default 2; indoor one-day 3–4) — never forced over (or under). Overflow spills to another day. Only leave a game unplaced when no day/field/hour (and, indoor, no slot at the team's site) fits; say why.
- **Impossible-matchup pre-solve guard (delta 53):** before solving, detect division pairs whose time requests can never overlap and surface the red flag — don't let the solver silently drop that pair's game.

**Soft preferences (now a BACKEND-locked ranked order; no longer director-ranked):** keep a division on nearby fields in one block, honor requests, keep fields busy, compact the day, keep a multi-team coach's games close in time, keep a division's kickoffs similar across days, team rest under max-wait, spread a team's games (unless packing), out-of-town later. **No conflicts always wins** — no soft goal ever creates a hard conflict. Fewest-gaps: reward a start that butts against an existing game on that field.

**Group-game day distribution (default + per-division override).** Earlier rounds fill day 1 (up to the cap), the LAST round + playoffs go to the last day; 6-team two-group divisions put group games day 1, playoffs day 2 when the cap allows. The director can override per division. **Friday is capacity-driven overflow for opted-in pairs only (delta 49):** only a round-1 game between two Friday-opted-in teams moves to Friday, and only when Saturday's size-capacity is exceeded.

**Scheduling style (director-facing):**
- **Spread out** — rest between a team's games; best for 2-day outdoor.
- **Styles can be mixed per tournament (per-division override)** on the Age groups & pricing page; each division can also carry its own time constraint + free-text note.
- **Pack together (pods)** — run a division's games as one tight block; parallel on adjacent same-size fields when a venue has them, else a pod on one field. A **cadence** sub-choice (Back-to-back / Game on·off·on) controls a team's own rest.
- **Suggested formula is the default (delta 50):** In & out · One site per division · Line-up-each-coach · protect = Teams in & out, each marked "Suggested"; the wizard engages the clustering base on open (outdoor → division packer, indoor → coach).

**No-playoff / round-robin-only** states plainly the champion is the points leader after all group games.

**Reserves the scheduling block** (pool or bracket per size), not the play time. Flags every unplaced game with a plain-language reason.

**Per-tournament scheduling brief.** The director's one **"Scheduling preferences"** wizard holds the **scheduling style** and the **settable limits** (max games/team/day, min rest, max wait, per-division rules) plus the **drive-time** dial (which sets the team's cross-site drive leg; +30 warm-up is added; coaches get no buffer; indoor teams don't cross). The ranked optimization goals are backend. Everything is bounded by the hard rules. **Auto-schedule opens the wizard FIRST**; the run shows a reliable, cancellable **"building…"** state and reports errors explicitly.

**Attempt, then explain (required behavior).** Auto-schedule makes its best attempt and shows a plain-language **result card**: how many of N placed; if everything fit, say so; else list, grouped and counted, what it couldn't fully do and **why** — unplaceable games (blocking reason + concrete fixes), plus each soft shortfall. The director adjusts and re-runs, or re-places by hand.

**Per-team check & full breakdown (schedule views: Chart · List · By team · By division + full-screen Full breakdown).** "By team" lists every team with times + a single status (All good / N to check). "By division" adds flag-and-re-run. The full-screen **Full breakdown** (Divisions / Teams / Coaches, searchable + day/site filters) is the director's learn-the-whole-event surface; its **Coaches** lens merges each multi-team coach's day into one timeline.

**Per-division scheduling rules (Andrew's SAT-morning case).** Each division carries, besides its style override: an optional **time constraint** (no-before / no-after, optionally scoped to one day) and a **free-text note**. Soft preference (penalize out-of-window starts on the matching day); the conflict panel flags violations with the note appended. Data: `styleOverride`, `constraintDay`, `noBefore`/`noAfter`, `schedNote`, `roundDays` per division.

### Coach report (per-coach game sheet with conflict color-coding)
A tab under **Coaches & conflicts** (and now mirrored by the **Coaches** lens of the full-screen Full breakdown). For **each coach who has teams**, one card:
- **Confirmed** — every scheduled group game for each team: day · time · field (venue) · opponent.
- **Possible playoff · if you advance** — every playoff game slated for that team's division (placed or planned); show the time if placed, else "<day> · time TBD," with "Who plays — and exact times — is set once group play finishes."
- A **status badge** (three-color): **Green "All clear"**; **Red "Conflict"** (two of the coach's teams overlap at a confirmed time); **Yellow "Watch"** (a possible clash pending a playoff result). Each reason spelled out. Note: a coach being at different **venues** is NOT a conflict (they arrive at kickoff) — only same-time overlaps are.

Severity ranking: red (confirmed overlap) > yellow (potential) > green.

---

## Payments, fees & promo codes

**Entry-fee payment**
- **Credit card is the default** (Stripe Checkout at registration).
- **Pay-by-check is PIN-gated self-serve.** The event has a **check-access PIN** (set at creation, **editable/regenerable any time — delta 67**). Correct PIN → check selected → confirmed immediately. **The PIN field surfaces only after the coach selects pay-by-check.** Without the PIN, the coach sees the **director's contact info** to request access. Master toggle to disable check per event. Payments view lists check teams and marks each "received." **The same controls are reachable from Event setup → Payments & promos.**

**Kinectem per-team fee — the "processing fee" ($25 default)**
- **Coach-facing name is "processing fee."**
- Clubs **with** a Kinectem subscription: fee **waived** ("processing fee waived because [club] has a subscription").
- Clubs **without**: $25/team, with **subscribe now** (waive it) or **pay it** and have it **credited to their first-year subscription** if they subscribe within the credit window (default 7 days).
- **Auto-queued post-tournament email** showing held credit (= $25 × teams) and the deadline. Merge `{credit}`/`{deadline}`.
- **Framing:** free to register and play; the processing fee (or subscription) saves their season; the **sponsor spot is how the director makes money.**
- **Guest checkout** pays the processing fee in lieu of a subscription, still creates provisional pages, and still fires coach invites at payment (contract §1a); a provisional guest club does **not** consume the free trial (contract §4).

**Promo codes**
- **Per-event codes** + a **shared library** with per-event on/off. At registration the coach enters a code; it validates and updates the fee live. **Editable from Payments & settlement and Event setup → Payments & promos (delta 67).**

**Free-to-register / subscribe-to-save conversion**
- Registration always creates temporary entities, free to play. After the event, the existing Kinectem conversion invites them to subscribe to keep org/teams/rosters/recaps. **First Kinectem sign-in with the registration email claims provisional pages in place (contract §1b).**

---

## Design system — match the live Kinectem app

**Mandate:** the Tournament Director must look like it was always part of Kinectem. Reuse the live app's component system — **not** the social-media post system. Tokens below are sampled from the current app; confirm exact values against the app's CSS variables.

**Per-tournament branding sits ON TOP of the Kinectem chrome.** The Kinectem component system is the fixed shell; the tournament's logo + primary/secondary colors theme the *accents* within it for that event. Implement the tournament brand as CSS variables scoped to the event.

**Foundations (sampled from the live app)**
- **Type:** **Inter** throughout — and actually *load* it as a webfont. Headings Inter Black (900), frequently UPPERCASE; section labels small uppercase letter-spaced; body/labels 600–700. `-webkit-font-smoothing:antialiased` + `text-rendering:optimizeLegibility`. **Tabular numerals** for scores/times/standings. Keep muted text ≥ ~4.5:1 on white.
- **Canvas:** very light lavender-white, approx `#F5F4FC`.
- **Cards:** white, radius ~**16px**, hairline border approx `#ECEAF4`, soft shadow, generous padding.
- **Ink:** near-black navy, approx `#0E1020` / `#141235`.
- **Brand purple:** gradient approx `#7C3AED → #A855F7`; magenta accent `#DB2777`.
- **Explanation callouts:** a reusable **lavender callout** separates on-page instructions from controls.
- **Buttons:** primary = purple→violet gradient, white, **pill** (radius 999), leading icon; secondary = white, 1px border `#E3E0EF`, ink, pill.
- **Eyebrow labels:** ~11px uppercase, letter-spaced, brand purple, optional thin left-accent bar.
- **Hero cards:** dark gradient banners with explicit high-contrast light text.
- **Accent pills (reuse existing meanings):** ORGANIZATION orange `#F97316`; TOURNAMENT light outline; GAME RECAP lavender-pink; Following pink outline; Communication blue `#2563EB`.
- **Semantic (scheduling):** green = good/final/published; **amber = soft conflict / draft / TBD / assistant-covered coach overlap / soft time-notice**; **red = hard conflict** (field/team double-book, team split across sites, team can't travel+warm-up in time, impossible matchup).
- **Admin analytics:** reuse the stat-tile pattern + periwinkle bars `~#8B9DF7`.
- **Club crest/logo chip (new — deltas 69–70):** a small round chip showing the club logo from `logo_url`, falling back to a monogram (club initials + deterministic HSL color). Used next to a team on the unscheduled-game cards, the grid, the public scoreboard and printed game cards.

**Layout patterns to reuse**
- **Three-column app shell;** left-rail console nav; tabbed content pages.

**Components to standardize**
- Buttons, pills/chips, rounded white cards, sticky-header tables, filter bars, modals, toasts, steppers, empty states, progress bars, tab rows. **Modals keep a stable identity** (don't re-mount). **Scrims close on `onMouseDown` with `e.target === e.currentTarget`, not `onClick`.**
- One **conflict chip** language (hard red / soft amber, icon + label — never color alone) used identically on grid, cards, reports, and the full-screen breakdown.
- **Stepped-wizard pattern** — a reusable wizard (branded step rail + one step at a time + Back/Continue + per-step validation). Registration is the first use; apply to event setup, check-in, the playoff builder, and the scheduler's own chooser.
- **Per-stat public-toggle** pattern (from the Tournament stats page) and the **divider-structured compact card** (from the unscheduled-game tray).

**Interaction & motion**
- **Click-to-place schedule grid** with live snapping + immediate conflict recheck; 120–160ms ease; never a full reload.
- Optimistic score entry; huge +/- controls; the number is the hero.
- Skeleton loaders during the scheduler run; a clear, cancellable "building your schedule…" state.

**Mobile & accessibility**
- Phone-first ref score page and public page; 44px touch targets; works at 360px with no horizontal scroll. WCAG AA; full keyboard nav (click-to-place keyboard-operable). **Full-screen breakdown must be phone-width safe (no horizontal page scroll) and fully opaque.**

**Light, easy-to-read across the board.** Lavender-white canvas, white cards, dark ink, purple accents — admin, public site, and ref score page all light. Only the left-rail console nav is dark (bright text `~#EEEBF9`). Any dark band sets explicit high-contrast light text. The public page must be full-width (`flex:1 1 auto; width:100%`).

---

## Integration points with Kinectem

- Tournament lives under **Competitions**; the director UI is the console behind the **Competition Command Center**.
- The public tournament surface **is the existing public competition page** — add real Schedule/Standings/Champions/**Stats** to its tabs; reuse its hero, "Presented by" lockup, "Copy public link," and publish/unpublish gating.
- **Registration emits the `club.upsert` / `team.upsert` / `coach.invite` events with `status` and `logoUrl` (contract §1a, §2); the enroller email is the reconciliation key for returning registrants and claim-by-email sign-in (contract §1b); partial registrations are captured and fed to the director (contract §7).**
- **Game recaps: remove them from the Kinectem tournament HUB page; keep them on each individual tournament page.**
- **Make the Kinectem events/tournaments list cleaner and easier than GotSport and TeamSnap** — fewer columns, clearer hierarchy, obvious status, strong per-event branding. An explicit deliverable.
- Temporary team pages + recap publishing + player auto-tag reuse existing flows.
- Registration reuses the existing promo-code + payment machinery; claims reuse Admin → Claims.
- Messaging via SendGrid with the event's from-name/reply-to.
- Conversion to a persistent subscription reuses the existing invite flow.
- Cross-event management uses Admin → Tournaments and Admin → Schedule. **Company admins & access (delta 66) governs which events a restricted admin sees.**

---

## Build phases (tie to the real calendar)

- **Phase 1 — Import & run (for Fall Finale, Nov 14–15):** GotSport import, divisions, venues/fields with hours + blocks + overlaps, pools/brackets, auto-scheduler (corrected hard rules + clustering + Friday overflow + impossible-matchup guard), click-to-place grid (with the legible crest cards), By-division + Full breakdown views, game cards + QR ref scoring, standings, champions, **Tournament stats**, public site with publish/unpublish. **Company settings + admins-with-access (delta 66) and the Event setup tab layout (delta 67) are foundational — build early.**
- **Phase 2 — Full registration (for January indoor):** public registration link with the step-1 path split + guest one-team loop-back + guest-enters-once, **provisional pages + email identity (contract §1a/§1b)**, card-default payment + pay-by-check PIN flow, the $25 processing fee (waiver / credit / post-tournament email), promo codes, value-at-sign-up, free-to-paid conversion, **partial registrations (delta 68)**, messaging, coach-conflict de-dupe at scale, TBD placeholders, manual playoff seeding. **The indoor one-site-per-team lock is load-bearing here (futsal).**
- **Phase 3 — Deepen Kinectem tie-in:** live public coach-conflict page, recap prompts per game, sponsor/partner surfacing, the in-app assistant on the real Claude/recap backend, assistant "act" mode (v2).

---

## Replit kickoff — first steps

A practical order to get moving in the existing Kinectem Replit app:

1. **Confirm the Competitions schema reuse.** Map the prototype entities onto existing Competitions tables vs new ones. New ones to add: `org_admin_access`, `partial_registration`, and the `competition`/`team`/`company-defaults` column additions above (incl. `logo_url`, `kinectem_status`, `stats_public`/`stats_published`).
2. **Stand up the director console shell** behind the Competition Command Center (three-column, dark left rail), plus the **Company settings** surface with **admins & access** — the scoped-sign-in enforcement is the first real backend behavior to get right.
3. **Event setup with the tabbed layout** (incl. Payments & promos) + per-tournament branding as scoped CSS variables. Branding threads everywhere, so do it before the public surfaces.
4. **Port the scheduler as a server-side job** using `scheduler-engine.md` (hard rules first, then the backend-locked soft order + presets; wire the impossible-matchup pre-solve guard). Return results to the click-to-place grid.
5. **Registration + the Kinectem event contract** (`kinectem-integration-contract.md`): `club.upsert` / `team.upsert` / `coach.invite` with `status`/`logoUrl`, invites-at-payment, email identity, provisional pages, partial-registration capture.
6. **Confirm the open backend items** below before they block: scheduler job placement under Autoscale; admin permission levels; the partial-reg resume link; club `logoUrl` plumbing; the priority presets/`r`.

The single-file prototype (`tournament-director-app.html`) is the clickable reference for every screen and interaction; `tournament-director-status.md` is the up-to-date behavior checklist to build and QA against.

---

## Open items for Replit / to confirm

- Where the scheduler job runs under the Autoscale cap (background worker vs. queued task).
- Exact Competitions schema reuse vs. new tables (incl. `org_admin_access`, `partial_registration`).
- **Company-admin permission levels** — is which-tournaments enough, or also view-only vs full (delta 66)?
- **Partial-registration feed** — confirm server-side capture + resume link + auto-clear (contract §7).
- **Club `logoUrl`** — confirm Kinectem returns a per-team/club logo so the crest slot shows the real logo (delta 69, contract §2/§5).
- Payment provider reuse for entry fees or keep external?
- Confirm the sampled design tokens against the app's actual CSS variables.
- How the director sections attach to the Command Center, and how public Schedule/Standings/Champions/**Stats** slot into the competition page's tab bar.
- **The 5-team reduced round-robin format** is still unbuilt — confirm the matchup-selection rule.
- **Warm-up constant:** teams get drive + **30 min** warm-up across sites (outdoor). Confirm 30, or make it an event setting.
- **Backend priority presets:** confirm the starting `r` (~0.45) and the per-preset order + active toggles once there's real swap data.
- **Soft time-notice sensitivity:** confirm the lean thresholds (early = finish ≤ 2 PM, late = start ≥ noon).
