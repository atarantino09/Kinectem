# Tournament Director — Fall Finale Release Plan

**Target event: Fall Finale, Sat–Sun Nov 14–15 (Basking Ridge, NJ).** This plan works backward from Andrew's real operational deadlines and maps each to the exact Phase-1 features (TD-xx tickets in `phase-1-build-checklist.md`) that must be live, with a build/test window and a go/no-go check for each. Today is **Wed Oct 28**.

## Timeline at a glance

| Release | Live by | What Andrew does that day | Must be working |
|---|---|---|---|
| **R1 — Data & intake** | **Mon Nov 2** | Import Fall Finale teams, organize into divisions/pools; send the public coach-conflict & request sheet | TD-01, TD-02, TD-04 (basics), TD-05, TD-07, TD-08, TD-09, request-collection link |
| **R2 — Schedule & publish** | **Thu Nov 5** | Auto-schedule; post live public schedule + public coach schedule; export full match list for the ref assignor | TD-06, TD-10, TD-11, TD-12, TD-13, TD-14, TD-18 (schedule), TD-19, match-list export |
| **R3 — Game-day prep** | **Tue Nov 10** | Print game cards with QR codes for the referees | TD-15 (cards + QR score page) |
| **R4 — Event day** | **Sat–Sun Nov 14–15** | Live scoring, standings, champions, public scoreboard | TD-16, TD-18 (scoreboard), TD-17 (stats, can trail) |

The hard rule of this plan: **ship functional first, polish against the design-fidelity punch-list in parallel.** A milestone is "done" when Andrew can do that day's job on real data — not when it's pixel-perfect.

## R1 — Data & intake · live by Mon Nov 2 (5 days out)

**Goal:** the real Fall Finale field of teams is in, organized into divisions and pools, and clubs can start submitting their coach conflicts and scheduling requests.

**Must be working:**
- **TD-01 schema + TD-02 console shell + TD-04 Event setup (Basics)** — the event exists; Outdoor style set (it's load-bearing for the scheduler), dates, default field hours.
- **TD-07 GotSport import** — paste the Select-All export; teams, divisions, coaches, emails parse; bracket-placeholder rows flagged, never surfaced as real teams.
- **TD-08 Teams & coaches** — registered-teams table; fuzzy coach de-dupe/merge; multi-coach + head-coach selector; assistant flag.
- **TD-05 Divisions & game formats** — divisions with correct sizes/fees; split by tier where needed.
- **TD-09 Pools & brackets** — click-to-place teams into divisions/pools.
- **Request-collection link** — the public coach-conflict & request sheet clubs fill in, landing as structured requests via `parseRequest` (interpret + confirm). **Scope note:** the MVP for Nov 2 is a *shareable submission form/link* (TD-19 "coach conflicts sheet" link + the request intake). The full *live* conflict-flagging public page is Phase 3 — **not required** for this date.

**Build/test window:** now → Sun Nov 1 (buffer Sun for a dry run).

**Go/no-go check (Andrew):** paste the real GotSport export → teams/divisions/coaches appear with placeholders flagged → organize into pools → generate and send the request link → a test submission lands as a structured request on the right team.

**Risk & fallback:** the request-collection page is the least-built piece. If it slips, collect requests by email/the existing mailto flow and enter them on the director worktable — scheduling (R2) only needs the requests *in the system*, not the fancy page. **Send the link the moment it works** — clubs only have Nov 2→5 to respond.

## R2 — Schedule & publish · live by Thu Nov 5 (8 days out)

**Goal:** a hand-quality schedule is built, posted publicly for everyone, the public coach schedule is up, and the full match list is exported for the ref assignor.

**Must be working:**
- **TD-06 Venues & fields** — venues/fields with sizes, per-day hours + blocked windows, **shared-space overlaps**, and the field-space monitor. *(Hard dependency for the scheduler — this is where the design work is now; it must land first.)*
- **TD-10 Match creator** — build each division's group games + playoff; Create ALL with the pre-build flag banner.
- **TD-11 Scheduler engine** — places all fittable games, **zero hard conflicts**, explains what it couldn't.
- **TD-12 Auto-schedule wizard** + **TD-13 Schedule grid** — run it, review, hand-adjust with the live legality preview.
- **TD-14 Schedule views + Fix coach clashes + coach report** — the public coach schedule comes from here.
- **TD-18 Public site (Schedule tab) + TD-19 Public links** — publish the live schedule and the public coach schedule; links toggle on.
- **Full match-list export (CSV)** for the ref assignor.

**Build/test window:** Nov 3–4; go-live Nov 5.

**Dependency:** needs R1's collected coach requests — **confirm the finalized list before Auto-scheduling** (the scheduler builds around them). That's the whole reason the request link goes out Nov 2.

**Go/no-go check:** run auto-schedule on real data → 0 hard conflicts, unplaced games explained → spot-fix on the grid → publish the schedule + public coach schedule → export the match CSV and send it to the ref assignor.

**Risk & fallback:** TD-11 is the hardest feature. If the auto-schedule isn't perfect, the grid's manual click-to-place + conflict flags let Andrew finish it by hand — so the public post can still happen Nov 5.

## R3 — Game-day prep · live by Tue Nov 10 (12 days out)

**Goal:** printed game cards with QR codes, ready to hand to referees for scoring.

**Must be working:**
- **TD-15 Game cards + QR ref scoring** — printable cards (roster rows, tournament logo, big field band, club crest per team); each card's QR opens an unauthenticated phone score page that **writes the score back to the match**; forfeits auto-apply 3–0.

**Build/test window:** Nov 6–9; go-live Nov 10.

**Dependency:** the schedule must be **locked** (R2) so cards carry the right matchups, fields, and times.

**Go/no-go check:** print the real cards → scan a QR on a phone → enter a score → it lands on the match in the console.

**Risk & fallback:** if the QR write-back isn't solid, print the cards anyway and have the director enter scores from the cards after each game — the cards themselves (the thing you hand refs) just need to print correctly by Nov 10.

## R4 — Event day · Sat–Sun Nov 14–15

**Goal:** scores flow in, standings and champions compute correctly, the public scoreboard updates, stats follow.

**Must be working:**
- **TD-16 Scores, standings & champions** — configurable points + ordered tiebreakers (incl. head-to-head), **GD cap 6/game**; champions gated until the deciding game is scored.
- **TD-18 Public scoreboard** — live mobile scoreboard, branded.
- **TD-17 Tournament stats** — can trail into the days after; not required for Saturday kickoff.

**Build/test window:** Nov 11–13; live Nov 14–15.

## Critical path & what to cut if behind

**Critical path:** TD-01 → TD-02 → TD-04 → (TD-07 + TD-05 + TD-08 + TD-09 = R1) → **TD-06** → TD-10 → TD-11 → TD-13 (= R2) → TD-15 (= R3) → TD-16 (= R4). TD-06 (venues & fields) is the current bottleneck because R2 can't schedule without it — finish it before chasing polish elsewhere.

**Non-negotiables (the event can't run without these):** import, divisions/pools, a working schedule (auto or hand-finished on the grid), the public schedule, game cards, and game-day scoring/standings.

**Safe to defer if time is tight:**
- Tournament stats (TD-17) — post-event.
- Public-links granularity (TD-19) — a single published schedule link is enough to start.
- Impact-preview toggle, some tray-card/polish items, assistant setup help — these improve the console but don't block the event.
- The *live* public coach-conflict page (Phase 3) — the submission link/sheet is all R1 needs.

**Design polish runs in parallel, not on the critical path.** Use the design-fidelity punch-list to clean each screen up against the prototype *after* its function is proven for that milestone — don't let pixel work delay a go-live.

## How to drive it in Replit
Give Replit this plan plus the per-area punch-list. For each release: build the tickets listed → Andrew runs the go/no-go check on real data → fix what fails → polish against the punch-list in parallel. The dates are the forcing function; the cut list is the pressure valve.
