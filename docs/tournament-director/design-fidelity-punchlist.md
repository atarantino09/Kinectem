# Tournament Director — Design-Fidelity Punch-List (for the Replit build)

**Purpose:** the written spec captures intent; the small design corrections we made live in the prototype. This list pulls those out as explicit, checkable requirements so the build matches the prototype instead of being re-interpreted from prose.

**How to use it:** the clickable prototype `prototype/tournament-director-app.html` is the **visual source of truth** — open it, go to the screen named, and match it. Build a screen, then check it against the prototype and tick each line here. A line that's wrong is a fix; a line not reached yet is fine — mark it pending, don't skip it.

Covers the areas built so far: **Event setup · Venues & fields (current) · Divisions & pools · Schedule · Coaches & conflicts.** Each item says what the prototype does; where it matters, the delta number in `tournament-director-status.md` is in parentheses.

---

## 1. Event setup

- [ ] **Tabbed layout**, in this order: **Basics · Branding & docs · Registration · Payments & promos · Communication · Scoring**. Not one long page.
- [ ] **Outdoor / Indoor style toggle** on Basics is **load-bearing** — it switches the recommended format AND the scheduler regime. Not cosmetic.
- [ ] **Friday-night checkbox** (enables an optional leading Friday day that starts empty).
- [ ] **Dates** drive the schedule days; **default field hours** set here; **registration-question toggles** here.
- [ ] **Per-tournament branding** = logo + primary/secondary colors applied as **CSS variables scoped to the event**, threading through the admin console AND the public site. Changing the logo/colors re-themes everything.
- [ ] **Rules & waiver uploads** on Branding & docs.
- [ ] **Payments & promos tab** carries the SAME controls as Payments & settlement → Payment method & promos: **pay-by-check toggle + editable PIN** and the **promo editor** (shared library). Payouts/Stripe, check tracking, and promo *usage* stay on Payments & settlement, not here. (delta 67)
- [ ] **Pay-by-check PIN** reads as **editable/regenerable any time**, is **brand-outlined**, and is **discoverable** (it was easy to miss before — the copy must make clear where it is and that it's editable). (delta 67, V161)
- [ ] **Scoring tab:** configurable points (default Win 3 / Draw 1 / Loss 0), ordered tiebreakers **including head-to-head**, and **max goal differential cap — default 6 per game** (not 3). Label with the example (10–1 credits +6). (V168)
- [ ] Company defaults (fee tiers / field hours / game formats) **pre-fill a newly created event** and never retro-edit existing ones.

## 2. Venues & fields (current)

- [ ] **Venues → fields**, each field with its **sizes** (7v7/9v9/11v11/5v5) as green chips; a field with no size shows an amber "No size" chip.
- [ ] **Per-field, per-day hours** with an Open checkbox + open/close selects, and **blocked windows** inside a day.
- [ ] **"Shares space with" control** in the field editor: lists the **other fields at this venue** as toggle chips; click the ones this field is **lined on top of**. Hint text: "other fields at this venue lined on top of this one — they can't run at the same time." (delta → handoff Venues & fields)
  - [ ] Selected chips turn **amber with a check**; a confirmation line appears: "The scheduler will never book this field and the selected one(s) at the same time."
  - [ ] It's **symmetric** (marking on either field counts) and **venue-scoped** (changing a field's venue clears overlaps that no longer apply).
  - [ ] A field with overlaps shows an amber **"⚠ shares"** tag in the venue list (tooltip lists which fields).
- [ ] **Overlap is a HARD scheduler rule:** two fields that share space can never both host a game at the same time. A collision shows a hard RED conflict: "Field A & Field B overlap (lined on the same space) — can't both run at 9:00 AM."
- [ ] **Design model to support:** list every playable configuration of a piece of ground as its own field; mark every pair that can't coexist as sharing space; true side-by-side halves do NOT share space with each other, only with the full-field version on top of both.
- [ ] **Venue library** (per director): save/add/reuse venues + their fields across events.
- [ ] **Field-space monitor** capacity table: per size, per day, slot supply vs games-needed with **short / tight / ✓** states (the binding signal before scheduling). Overlapping configs are the same ground — **not additive capacity**.

## 3. Divisions & pools

- [ ] **Structure reads tiers → divisions → groups.** Tier (Beginner/Travel/Premier) is **organizer-only, never public**; it feeds division placement.
- [ ] **Age → field-size default** (auto-set, editable): U8–U10 → 7v7, U11–U12 → 9v9, U13+ → 11v11.
- [ ] **Pricing: default by field-size group, per-division custom override**; track a `priceCustom` flag. "Add a division" callout explains a new division takes the field-size default unless a custom entry fee is typed.
- [ ] **Game formats card:** the **scheduling block** is the primary control; **play length + halftime** secondary. **Pool block vs bracket block are separate fields**, set per size. Turnover-buffer warning if a block < play + halftime.
- [ ] **Pools = click-to-place** (click a team, click a pool): **auto-split 1–4**, each team gets a **bracket letter**. **"Unassigned" strip full-width on top** as the un-assign target. **No native drag.** Locked (scheduled) teams can't move and show a **Swap** action. **Tier-colored headers.** (delta 53 area / handoff Pools & brackets)
- [ ] **Division reorder** sorts by **gender then age** and that order **carries to the schedule and public page**. Level shown **organizer-only**.
- [ ] **Impossible-matchup RED flag + soft time-notice AMBER** render **per division** here, **day-aware and live**. Soft lean test: early = must finish **≤ 2 PM**, late = can't start **before noon** — must NOT fire on mild limits that share a wide midday band (e.g. "no games before 10 AM" vs "done by 3 PM" is fine). (delta 53, fixed V162)
- [ ] **Match creator:** per-division **Recommended format in plain English** (from style + team count) with a single **"Create these games"** (group + suggested playoff in one click); GAMES/PLAYOFF/DAYS drill-downs; **"Create ALL matches"** capstone with an approval checkbox and a **pre-build banner surfacing impossible-matchup / soft-time flags** (blocks on a red flag). Fresh events start with **zero** matches.

## 4. Schedule

- [ ] **Horizontal timeline:** time → across the top, field → down the side. **Sticky field column + sticky time header.**
- [ ] **Click-to-carry placement** (NOT native drag): click a game to pick it up, click a slot to drop it, with a **live green/red landing preview** showing whether the move is legal. The **cursor chip must not drop clicks**.
- [ ] **15-minute snap** (5-min optional).
- [ ] **Unscheduled tray cards** read top-to-bottom: **group label → divider line → home team (bold) + crest → VS divider → away team (bold) + crest → divider → Planned day**. On a **slightly wider** card. (deltas 69–70, V162–V164)
  - [ ] **Placeholders ("Open Spot", "Winner of…", TBD) are de-emphasized** — muted italic, **no crest**.
  - [ ] Each real team shows a **small color-coded club crest** = monogram (club initials + deterministic color), standing in for a real `logoUrl` when there isn't one.
  - [ ] Card size/spacing is **scoped to the tray** — compact on-grid blocks are unaffected.
- [ ] **Live conflict flags identical everywhere** — hard **red**, soft **amber**, written in **plain language** (not codes).
- [ ] **Impact-preview toggle**; **two-step confirms** for unschedule and clear-all.
- [ ] **Views:** Chart · List · By team · By division + full-screen **Full breakdown** (Divisions / Teams / Coaches, **searchable**, day/site filters). By-team shows each team's status (All good / N to check).
- [ ] **By-division flag-and-re-run** (re-schedules only flagged divisions).
- [ ] **"Fix coach clashes"** same-venue swap tool.
- [ ] Reserves the **scheduling block** (pool or bracket per size), not play time; every unplaced game gets a **plain-language reason**.

## 5. Coaches & conflicts

- [ ] **Coaches worktable rows:** a **head-coach input** plus a **"Coaches (N) ›" button**; a **"+N co-coach" hint** when there are extras. (delta 71, V166)
- [ ] **Coach management modal:** add/remove any number of coaches (**name · email · phone each**); a **per-coach "head" radio** (exactly one head); **HEAD COACH chip** on the selected one.
  - [ ] Top note: everyone listed **gets the team's emails and can sign in to update scheduling requests** — add assistants/co-coaches too.
  - [ ] Prominent **"Why the head coach matters" callout**: the head is the **one identity checked for double-bookings across all their teams**; co-coaches never create conflicts. (V167)
- [ ] **Head coach is the single identity conflict-detection groups on.** A head coaching >1 team is the multi-team double-book the scheduler avoids. **Co-coaches never create conflicts.**
- [ ] **Assistant-coach flag** exempts a same-time coach overlap (makes it amber, not hard) — a coach with an assistant can have two teams at once.
- [ ] **Fuzzy coach de-dupe** with merge suggestions (coach accuracy is what makes conflict detection work).
- [ ] **Coach report** — one card per coach with **3-color status**: **red** = confirmed conflict needs a fix; **amber** = could get squeezed by a playoff slot; **green** = clear. Shows confirmed game times + fields plus playoff slots that *could* become theirs.
- [ ] **Full breakdown → Coaches lens** merges each multi-team coach's day into **one timeline**.
- [ ] **Messaging/Compose addresses ALL coaches of a team** — head registry email + co-coach emails + any registration-collected `coachEmails[]` — recipient summary reads **"all coaches of N teams."** (V166)
- [ ] **Coach-conflict self-service link** for clubs to submit final requests; a banner reminds the director to **confirm the finalized list before Auto-scheduling.**
- [ ] **Scheduling-request intake is interpret + confirm:** a coach types plain English, the system reads it (`parseRequest`), **shows the reading back to confirm**, and stores a structured rule — no manual director translation. Near-misses get a best-guess to confirm or a one-tap guided builder. Negation inverts part-of-day ("no morning games" = play afternoon on). (deltas 62, parser fix V157)

---

## The workflow that closes the gaps
1. Build (or fix) one screen.
2. Open the same screen in the prototype side-by-side.
3. Walk this list for that area; tick what matches, fix what doesn't.
4. Anything not reached yet → mark pending, don't drop it.

If the build is pulling from GitHub, make sure it's on the branch with the current docs (PR #1 / `add-tournament-director-spec`), not `main` — `main` has none of this yet.
