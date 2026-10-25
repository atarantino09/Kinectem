# Scheduler Engine — capacity math, the custom autoscheduler, Rule #1, strategies, travel, breakdowns & compare

**As of Oct 21, 2026 (evening). Prototype Version 155** (`tournament-director-app.html`, `https://claude.ai/artifact/FBwtiXVkh2RETJ1BHjSpKr`). Documents how the auto-scheduler fits the games, the step-by-step custom autoscheduler the director runs, the always-on "get every game on the board" rule, the gap-free packing, the team-first / coach / fit-everything options, the **team-vs-coach travel asymmetry**, the **indoor one-site-per-team hard lock**, the **team-never-overlap invariant**, the **venue-first division clustering**, the **capacity-driven Friday-night overflow**, the **suggested formula defaults**, the **place-everything coach-clash handling + swap tool**, the field-space monitor, the run-breakdown/scenario-compare flow, the full-screen schedule breakdown, and the **impossible-matchup / soft time-notice detection** in Pools & Divisions. Supplements the Scheduler section of `tournament-director-status.md` — where they differ, this doc wins for scheduler behavior.

> **Note (V162):** the soft time-notice lean test was tightened — a team is "early-leaning" only if it must finish by ≤ 2:00 PM and "late-leaning" only if it can't start before noon, so mild limits that still share a wide midday band no longer trigger the amber notice. See `tournament-director-status.md` delta 53.

---

## 🆕 Session Oct 21 engine additions (V129–V155) — functions & mechanics

The Oct-20 engine below is unchanged; these sit on top. Function names are the ones in `TournamentDirector.jsx` so the Replit build can map them.

### Impossible-matchup detection + soft time-notice (V154–V155)

The flag the director sees **before creating matches / scheduling** when two teams share a division but their time-of-day requests can't be reconciled. Two tiers: a hard **red** "impossible matchup" and a soft **amber** "scheduling notice." All top-level pure functions (near `parseRequest`/`reqDayOK`), so Pools, Divisions and the App all call them.

- **`teamWindowOn(reqs, date)`** → `{before, after}` — a team's hard play window on a day: `before` = earliest start it allows (max of its `before` rules → "no games before X"), `after` = latest finish it allows (min of its `after` rules → "done by X"). Day-scoped requests (`r.day` set) are skipped on days they don't apply (via `reqDayOK`); `date = null` combines all rules ignoring day (used for labels).
- **`windowsDisjoint(a, b)`** — strictly disjoint on a day: one team must finish before the other can even start (`b.before >= a.after` or `a.before >= b.after`).
- **`pairNeverMeets(aReqs, bReqs, days)`** — true only when the pair is disjoint on **every** tournament day AND **both** sides have a hard window. This is the **hard (red)** condition: they can literally never play each other (e.g. one "done by noon" / mornings, one "no games before 5pm" / evenings, both unscoped). **Day-aware, so no false positives:** "Saturday mornings" vs "Sunday afternoons" is NOT hard — each constraint only binds its own day, leaving the other day open, so they can meet.
- **`divisionTimeConflicts(teamIds, requests, days)`** → `[{a, b, aWin, bWin}]` — all hard pairs in a division.
- **`teamLeansEarly(reqs)`** / **`teamLeansLate(reqs)`** — **(V162) thresholded:** early = has an `after` cap at or under 2:00 PM (must finish by early afternoon); late = has a `before` floor at or over noon (can't start until midday). A mild cap like "no games after 3 PM" or a mild floor like "no games before 10 AM" is NOT a lean. **`teamReqSummary(reqs)`** (full text incl. the day, e.g. "Saturday: no games after 12:00 PM"), **`windowLabel(win)`** (short literal, e.g. "no games before 5:00 PM").
- **`divisionTimeNotices(teamIds, requests, days)`** → `[{a, b, aText, bText}]` — the **soft (amber)** tier: pairs that are NOT hard but **pull toward different times of day** (one early-leaning, one late-leaning per the thresholds above), so the division's games may land at different times on different days (Andrew's "Saturday mornings vs Sunday afternoons" — technically fine, just varies day-to-day). Just a heads-up, nothing to fix.
- **App memos:** `timeConflicts` (red) and `timeNotices` (amber) over all divisions. A reusable **`TimeConflictBanner`** renders a red block for conflicts + an amber block for notices, dropped into the **Schedule builder** (top) and the **Create ALL matches** screen (right above the review checkbox) — the two "before you schedule" moments — and surfaced in the **Dashboard → Needs attention** card (red + amber entries that deep-link to Pools).
- **Pools (`PoolsBoard`):** group-level red + amber banners naming the division, both teams and their windows; each division **column** gets a red `⚠` or amber `⏱` count chip + colored border; each **team card** shows its time window (`teamReqSummary`, day included) and is tinted red (conflict) or amber (notice).
- **Divisions (`BracketsPage`):** same red + amber page banners, plus a per-division-row red "N time conflicts" / amber "N notices" chip.
- **Timing of the check:** it's a live `useMemo` over `requests` + `ageGroups` + `teams`, so it fires whether the conflicting requests were already in when divisions were made, or arrive later after divisions were sent out — the flag appears the moment both teams are in one division with the opposing windows.
- **Validated:** 6-case unit test on the hard logic (incl. the day-scoped no-false-positive cases) and 6-case unit test on the soft logic, plus visual confirmation — an injected mornings-vs-evenings pair renders red across all four surfaces; an injected Saturday-mornings/Sunday-afternoons pair renders amber (not red). (V162: a done-by-3PM vs no-games-before-10AM pair correctly no longer fires.)

### Venue-first division clustering (V136–V137)
- **`divHome`** — computed in `autoSchedule` scope when **`useVenuePacker || divMode`** (`useVenuePacker = anyVenuePriority || anyFinalsField`). Assigns each division **one home venue for the whole event**, scarcest-size-first, with a **per-day capacity check** (`capVD`/`remVD`: the venue must hold the division's games on *each* day, not just the weekend total) so a popular venue isn't oversubscribed on one day. Honors `venueFillKey` (fill order) and `venue.sizes`.
- **`divisionPack`** packs each division at its `divHome` in **column-major parallel pods** (in-and-out). Per day it picks a single venue that can hold that day's games (avoids within-day venue splits), home first.
- **Home-awareness in repair/fill:** `homeFirst(m)` comparator sorts a division's home-venue fields first in `bestSlot`, `fillAnyOpen`, `forceSeat`. **`legalMove`** has a guard — `if ((useVenuePacker || divMode) && divHome[g.ageGroupId])` — that refuses to move a game off its home venue during repair/tighten passes. The `divisionPack` spill loop prefers a leftover whose `divHome` is that field's venue.
- Result: ~80% of games at the division's home venue, median division ~90% (Summer, 282 games). Remaining spread is real field geography (single multi-field venue per size; single-day venues).

### Capacity-driven Friday-night overflow (V140)
- **`planDays(games, ageGroups, days, cap, opts)`** — `opts = { friTeams:Set, satCap:{size:slots}, friCap:{size:slots} }`. It identifies the Friday (`isFri` → `getUTCDay()===5`), keeps Sat/Sun as the real days, and tags a group game **`friCand`** when both teams are in `friTeams` (opted in). friCand games are forced into the **Saturday pool** (never Sunday). Then a **Saturday→Friday pull**: for each size where Saturday demand `>` `satCap[size]`, it moves friCand games (earliest round first) onto Friday, one per overflow game, capped by `friCap[size]`. So Friday is used **only** to relieve a maxed-out Saturday, and **only** a willing pair's round-1 game. The call site computes `satCap`/`friCap` from field hours per size.
- **Friday lockdown in the packer:** `autoSchedule` has `isFriDay`/`friDaySet` and **`orderDays(m, rescue)`** — for a game not planned for Friday it **drops Friday entirely** on normal passes (`bestSlot`, the repair pass) and **appends Friday last** only on the rescue passes (`fillAnyOpen`, `forceSeat`). A friCand game planned for Friday keeps Friday first. Net: nothing lands on Friday except opted-in pulls, plus a true last-ditch rescue after Sat/Sun are exhausted.
- **Per-team opt-in:** `team.fridayOK` (checkbox column + bulk toggle on the Teams page). Unit-tested: roomy Saturday keeps the pair on Saturday; tight Saturday moves exactly the pair's R1 to Friday (cadence Fri vs each other → Sat → Sun); no opt-in or no Friday capacity moves nothing. With no teams flagged, Friday holds only genuine last-resort overflow (Summer: 1 game).

### Suggested formula defaults + base routing (V142)
- The wizard (`PrioritiesModal`, run mode) **pre-selects Andrew's formula** and marks each ★ Suggested, top-of-page: `pacing="inout"`, `divLoc="onesite"`, `coachRule="forward"` (reframed in the UI as **"Line up each coach's games"**, the conflict-minimizing choice), `protect="timing"` (now the first/default protect card).
- **Base engaged on open:** a `useEffect` sets `onPackMode(baseMode)` where **`baseMode = eventStyle === "indoor" ? "coach" : "division"`** — so even if the director clicks straight through, outdoor runs use the **division packer** (clustered, in-and-out, full placement) and indoor uses the **coach base** (its one-site-per-team lock). Every option `onClick` also sets `onPackMode(baseMode)` (not hard-coded "coach") so selecting an option preserves the base. Dispatch order matters: `coachMode` is checked before `divMode` before `lockOneVenue`, so **only outdoor** is routed to `division` (indoor still hits the one-site coach path).

### Place-everything finish + coach-clash swaps (V143)
- **`forceSeat` now runs always** (was `if (ctx.fitAll)`), as the Rule #1 finish: any game the hard passes left unplaced is seated on the **least-bad physical slot** — field clash, team-overlap and hours stay hard, but a coach double-book is allowed. It **prefers a clash-free slot** (`coachClash` check against `byDate[d]`) and only falls back to a coach-clashing slot (`fallback`) when none exists. Genuinely field-full games (no physical slot) still stay in the tray. `computeConflicts` then flags the coach clash amber.
- **`coachClashFixes(mId)`** — for a game with a hard coach clash, finds alternate **swaps** via the existing **`computeImpact(spec)`** (which simulates a move/swap and reports before/after per team & coach). Candidates are **same-venue only** (`venOfField(B.fieldId) === aVen` — never scatter a division), same size, at a slot where the clashing coach is free (`coachBusyAt` pre-filter). It rejects any swap that would add a **team** hard conflict, keeps swaps that resolve the coach clash, and labels each: **clean** (no new clash), **moves the clash to Coach X (club)**, and whether it `touchesTeams` (nudges a team's timing). Ranked clean-first. Applied with **`applyMove`/`commitSwap`** (history-tracked, undoable). Surfaced by a **"Fix coach clashes (N)"** toolbar button (`coachClashGames` memo) → modal. Verified: a 2-entry clash offered 5 same-venue options, clean first, Apply took clashes 2→0.

### Venue fill order & finals (V133–V139)
- `venue.fillOrder` / `field.fillOrder` (rank; 0 = Auto) drive `venueFillKey`/`fillKey`/`fieldRank`, so a priority venue's fields sort before the next venue's, field order breaking ties. `field.finalsField` marks a **preferred finals field**. The **finals post-pass** (soft) nudges each **championship Final** (`isFinalGame`: label `/final/i` and not semi/consol/prelim/cross/3rd/quarter) onto a preferred field **at the division's own venue** if one is free in its window — never forced, never a venue jump. UI: the `FieldFillOrder` component (Venues page + collapsible in the wizard) is **drag-and-drop** (HTML5 `draggable` grip; ↑↓ kept).

---

## The problem we were chasing

On the real March seed (618 games) the old greedy/weighted engine plateaued at **~585 placed with 8–12h team waits**, even though the director had fit **all 618 by hand**. The two questions — was 618 even feasible in the browser, and could a director steer the trade-offs — are now both answered: **the dense packers reach 617/618** (the 1 is a true capacity wall), the director drives the whole thing through a clean step-by-step chooser, and **Fit everything** is the one-tap path to the physical max from any starting style.

## Indoor vs outdoor — the headline result

Measured on both seeded events across strategies, **zero hard conflicts everywhere**:

- **Indoor (Winter Futsal, 204 games, 5v5):** every strategy fits **204/204**, **every team's whole schedule at one site (0 teams split across venues)**, worst team wait 2.5h (Teams-in-and-out). The coach-hybrid base is exactly right for a futsal day.
- **Outdoor (Spring Classic, 618 games, mixed sizes):** the **dense packers (Pack, Fit everything) reach 617/618** (614–617 depending on run); the **coach-hybrid default fits fewer (~597/618)** because **84 of 87 coaches run teams across *different* divisions**. On a big outdoor event the director uses **Pack** or **Fit everything** (or the division base, which clusters at a few games' cost on the knife-edge). Teams **do** cross venues on outdoor events (measured: 136 cross-venue team transitions on a Spring run), each honoring the drive + warm-up gap below.

This is the core product insight, confirmed: **coach-clustering is right for indoor, dense/division packing is right for outdoor,** and Fit-everything is the universal escape. The Replit solver should pick the regime from event shape.

## Travel: a team drives + warms up; a coach just shows up at kickoff (V127)

The old model put a flat cross-venue buffer on **coaches**. That was backwards. The real rule, now enforced:

- **A TEAM crossing to a different venue is the whole roster** — it must physically drive there AND warm up before kickoff. **Hard minimum gap between a team's games at different sites = drive + warm-up** (`teamTravel = coachTravel + 30`, i.e. the event's drive-time setting plus ~30 min warm-up). The scheduler never books a team back-to-back across two buildings without that gap; if one ever appears (e.g. from a hand-placement) it's a **hard red "travel" conflict**.
- **A COACH crossing to a different venue can arrive right at kickoff** — an assistant can start the game. **No drive buffer is reserved for a coach.** The only coach limit is the same-clock-time one: a coach can't be whistling two games at once **unless** one of the clashing teams has an assistant (then it's an amber "assistant covers" advisory, see below). This is strictly looser than before and only helps placement.

Enforced in **every** placement path (the scored greedy, `hardFit`, the ejection/left-shift `legalMove`, and the unplaced-reason explainer) and mirrored in the live conflict scanner (`computeConflicts`). The wizard's drive-time step now explains both halves. Measured: on Spring, 0 tight cross-venue team gaps out of 136 crossings; on Futsal, coaches hop sites with 0-minute gaps and it's fine.

**Builder note:** replace any "coach needs N min between venues" rule with this asymmetry — the drive+warm-up buffer belongs to the **team**, not the coach; the coach only can't be in two places at the same clock time (assistant-exempt).

## Indoor / futsal: a team plays its WHOLE schedule at ONE site — hard (V128)

For **indoor events (`tourney.style === "indoor"`)** a team never crosses venues, period — all of its games are at a single site. This is a **hard rule that outranks avoiding a coach double-book** (Andrew: *"absolutely no teams in futsal should go to different venues… all games for a team should be at the same venue — that's more important than a singular coach conflict"*). We'd rather a multi-team coach cover a clash (assistant starts one, coach arrives at the other by kickoff) than split a team across two buildings.

- **Mechanism:** a per-team venue tally in the live index (`teamVen`) locks each team to the first venue it's placed at; `venueLockOK(m, venue)` rejects any placement that would put one of a game's teams at a second site. Wired into `hardFit`, the scored greedy, `legalMove`, and the ejection pass — so it holds under **every** strategy, not just the default.
- **Routing:** indoor runs always use the **venue-anchored coach packer** (it assigns each division a single site with enough court-time up front), never the max-fit packer. (Before this fix, Pack mode on futsal split teams like HTA across BHS + Peak.)
- **Trade it honors:** one-site integrity above cramming in the last game. On the futsal seed, 5 straight runs placed **202–204/204 with ZERO teams split** every time; the occasional 1–2 in the tray are coach-overlap games the engine won't force. A split team (if hand-created) shows a **hard red "split" conflict**.
- **Outdoor is untouched:** `lockOneVenue` is false for outdoor, so outdoor teams still cross venues freely with the drive + warm-up gap.
- **Coach-across-venues is now neutral info, not a warning** for indoor multi-team coaches (they necessarily span sites).

## Team-never-in-two-games-at-once — a final invariant (V126)

Beyond the per-placement team check, a **final hard-invariant sweep** runs after all passes: if any pass left a same-team time overlap on the same day, the later game is pulled off the grid into the tray and Rule #1 re-fills. So a team is **never** double-booked in the applied schedule, regardless of strategy or forcing. (A coach same-time overlap remains allowed only when an assistant covers — amber, not hard.)

## Capacity analysis (the real seed) — still the feasibility oracle

Hard numbers from the Spring seed (40 fields across 21 venues; games pinned to **Saturday** and **Sunday**). Fields are **single-size**, so the three sizes pack independently.

Games: **7v7** 166 (60-min block), **9v9** 186 (60-min block), **11v11** 266 (**75-min block**, 60-min play + changeover).

| Day | Size | Games | Fields | Max blocks (perfect pack) | Verdict |
|-----|------|-------|--------|---------------------------|---------|
| Sat | 11v11 | 145 | 18 | 154 | **FITS, slack 9** |
| Sat | 7v7 | 85 | 9 | 97 | FITS, slack 12 |
| Sat | 9v9 | 103 | 13 | 148 | FITS, slack 45 |
| Sun | 11v11 | 121 | 18 | 135 | FITS, slack 14 |
| Sun | 7v7 | 81 | 9 | 91 | FITS, slack 10 |
| Sun | 9v9 | 83 | 13 | 140 | FITS, slack 57 |

**618 is feasible but on a knife-edge. Binding constraint: Saturday 11v11 — only 9 spare blocks across 18 fields.** This is why the **Field-space monitor** surfaces per-size, per-day slot supply *before* the director runs — and it's exactly the Saturday pressure the Friday-night overflow is designed to relieve for opted-in pairs.

## RULE #1 — every game that can physically fit gets on the board

After the chosen strategy arranges and the repair passes run, a **universal final placement pass** (`fillAnyOpen`) seats any still-unplaced game on any open slot that keeps every hard rule — regardless of strategy. The **`forceSeat` finish now runs always** (see the Oct-21 section): it then places anything still unplaced on the least-bad physical slot, preferring a coach-clash-free slot and flagging a coach clash amber only when unavoidable. A game is left in the tray only when there's **physically no slot** of its size (or, indoor, none at the team's locked site). **Indoor one-site integrity still outranks Rule #1.**

## NO IDLE GAPS ON COURTS — `tightenCourts`

A final `tightenCourts` pass left-shifts each field/court's games toward the open so every court runs back-to-back with no empty interior holes, keeping all hard rules (including the indoor one-site lock, the venue-clustering home guard, and the team/coach travel rules via `legalMove`). "Rest between games" preserves each team's min-rest.

## The custom autoscheduler — a step-by-step wizard

Auto-schedule opens a **6-step wizard** (wide modal, progress bar, Back/Next — selecting an option never auto-advances).

1. **What to build** — schedule-around toggle; divisions checklist; venue pins.
2. **How teams play** — **In & out** (★ Suggested) vs **Rest between games**.
3. **Where a division plays** — **One site per division** (★ Suggested) vs **Spread if needed**.
4. **Multi-team coaches** — **Line up each coach's games** (★ Suggested; the conflict-minimizing `forward`) vs **Pack tightest, coaches sort it out** (`fitfirst`).
5. **Drive time & limits** — drive-time dial (10/20/30), explained as the team's drive + ~30 warm-up; a coach needs neither. Max games/team/day; min rest / max wait. A collapsible **"Review venue fill order & finals"** row lives here.
6. **Priorities & review** — Rule #1 banner; the **"what to protect"** cards with **Teams in & out — shortest wait** first and ★ Suggested; settings summary; submit.

**Base routing (V142):** opening the wizard sets `packMode = eventStyle === "indoor" ? "coach" : "division"`, and option clicks preserve it — so the suggested formula clusters without the director needing to touch anything. The engine `ctx` carries: `packMode`, `pacing`, `divLocation`, `coachRule`, `protect`, `coachTravel`, `tourneyStyle`, `maxPerDay`, `minRest`, `maxGap`, `venueAssign`, `venues` (fill order), plus `schedAround`, `schedDivs`, `fitAll`.

### "What to protect" (the `protect` priority)
- **Teams in & out — shortest wait** (`timing`, ★ default) · **Balanced** · **Fewest coach conflicts** (`coaches`) · **Team time requests** (`requests`) · **Pack the board tightest** (`fit`).

### Teams in & out — the team-first engine
- **`teamTighten`** — pull each team's later game to the earliest legal slot after its prior game. Futsal worst wait 5h → 2.5h.
- **`teamTightenNuanced` + `physicalFit`** — for a team *still* over the max wait, a second pass may trade a coach's assistant-covered overlap to erase a BIG gap; the physical limits (team not in two places, one-site indoor lock, windows, hours, cap, uncovered coach double-book) never bend. Each trade shows **amber**.

## Strategy base modes (the packers under the hood)

All obey the same `hardFit` gate: field clash / shared-space; team never in two games at once; team drive + warm-up across sites; indoor one-site lock; coach not in two games at once (assistant-exempt, no travel buffer); per-day cap; hours; blocks; division windows; venue pins; planned day.

1. **Pack together (`maxFitPack`)** — field-major, fill block-by-block, zero interior holes. Densest raw fill.
2. **Hybrid "By coach" (`coachPack`)** — each division a coach-aware home venue, one tight block. **Always used for indoor.**
3. **By division (`divisionPack`)** — each division clustered at its `divHome` venue, parallel in-and-out pods. **The outdoor default** (engaged by the wizard); honors venue fill order and the per-day home guard.
4. **Spread out** — original weighted greedy; LNS ruin-recreate runs only here.

Dispatch order: `coachMode` → `coachPack`; else `divMode` → `divisionPack`; else `lockOneVenue` (indoor) → `coachPack`; else `useVenuePacker` → `divisionPack`; else `packOn` → `maxFitPack`; else greedy.

### Measured — 618-game outdoor seed
| Run | Placed | Hard conflicts |
|-----|--------|----------------|
| Pack (back-to-back) | 614–617/618 | 0 |
| Division base (clustered default) | ~591/618 single run | 0 |
| Fit everything | 617/618 | 0 |

The division base trades a few single-run placements for clustering on the knife-edge; Fit-everything recovers them.

### Measured — 204-game indoor futsal seed (one-site lock on)
| Run | Placed | Teams split | Team overlaps |
|-----|--------|-------------|---------------|
| Default (coach packer) | 202–204/204 | **0** | **0** |
| Teams in & out | 204/204 | **0** | 0 |

### Measured — 282-game Summer seed (division base, venue clustering)
279–282/282 placed, ~80% of games at the division's home venue (median ~90%), 0 team/field clashes. Leftovers are genuine Saturday field-capacity.

## Fit everything

When a run leaves games in the tray, the breakdown and Compare screen offer **Fit everything** — it sweeps candidate arrangements (each inheriting `tourneyStyle`) + a physical-only force pass and keeps the best. Reaches 617/618 outdoor; never worse than a normal run.

## Field-space monitor — capacity before you schedule

On **Venues & fields**, a per-size table (Size · Fields · slots/day · Total · Games need, short/tight/✓). Per-day column is the binding signal, and the trigger for Friday-night overflow.

## Run breakdown & scenario compare

- **`autoSchedule` returns `{ results, unplaced, stats }`.**
- Every run is a **Scenario** (last 8, `fitAll` flag); a breakdown modal opens with a "how close to perfect" headline.
- **`ScenarioCompare`** lines up to 3 runs; "Keep this one" switches the live schedule; Fit everything offered when a run left games.

## Full schedule breakdown — the "learn the whole event" view (V127)

A **full-screen, searchable breakdown** from the **"Full breakdown"** button. Three lenses — **Divisions · Teams · Coaches**. Divisions/Teams show every game (day · time · field (site) · opponent) with status and issues; the **Coaches** lens merges each coach's teams into **one chronological timeline** with venue hops marked neutral and same-time overlaps red. Top bar: search, day + site filters, Only-issues toggle. An inline **By division** tab shares a **Flag this division** control with **Re-schedule flagged**.

## In-app AI assistant (V143–V144)

Not a scheduler component, but it reads scheduler state: a context-aware chat (`AssistantPanel`) that answers coordination questions grounded in the live tournament (divisions, fields, placed/total, hard conflicts, current settings — built by `getContext`). Advise-first. Calls Claude via the artifact `sample` capability in the prototype; swaps to Kinectem's recap-AI backend in production. (V161: its system prompt also covers setup, payments/PIN, promos and company admins.)

## Terminology & legend

- "**game slot**," not "court," in generic copy.
- Grid **card-colour legend**: green (no conflicts), amber (soft — a preference it couldn't fully meet, incl. an unavoidable flagged coach clash), red (hard — field/team double-booked, team split across sites (indoor), team can't drive+warm-up in time). Conflict LABELs include `split` and `travel`.

## The real production answer

For hand-quality fit *and* tight clustering reliably, the Replit backend should run a true optimization solver (CP-SAT / ILP): bin-packing with side constraints solved to/near optimality server-side — pack-then-fill as one objective, choosing the regime from event shape, with these hard constraints baked in: team-never-overlap, team single-site for indoor, team drive+warm-up across sites for outdoor, coach same-time (assistant-exempt, no travel buffer), windows, venue pins, per-day cap. Model **division-at-one-venue** and **Friday-night-for-opted-in-pairs-only-when-Saturday-is-full** as soft/goal constraints, and expose team-wait minimization as the top soft objective. **Pre-solve guard:** run the impossible-matchup check (`divisionTimeConflicts`) and block/flag a division before the solver runs — a pair with disjoint all-day windows is infeasible by construction, so the UI must catch it up front rather than letting the solver silently drop their game.

## For the builder — carry over

1. **75-min 11v11 block**; 7v7/9v9 60-min; futsal 5v5 30-min. Single-size fields.
2. **Rule #1: place every game that physically fits** — given a good packing; pack-then-fill. The place-everything finish also seats a game that only fits with a coach double-book (flagged), preferring clash-free. Indoor one-site integrity outranks it.
3. **Pick the base by event shape — coach for indoor, division (clustered) for outdoor;** engage it by default. Fit-everything is the universal escape.
4. **Divisions at one home venue** (per-day capacity-aware), repair/fill home-guarded. **Venue fill order & finals** (rank venues/fields; preferred Final field = soft, championship only, within the division's venue).
5. **Friday night = capacity-driven overflow for opted-in pairs only** — pull a willing pair's round-1 game to Friday only when Saturday's size-capacity is exceeded; keep it in the Saturday pool at generation; Friday last-resort everywhere else.
6. **Gap-free courts/fields;** honor chosen min-rest.
7. **Hard-rule gate (`hardFit`), never traded against soft goals;** `physicalFit` is the amber relaxation (team-wait nuance + Fit-everything). Final team-overlap invariant sweep.
8. **Stepped chooser** with the suggested formula as default and ★ Suggested marks; three-lens trade-offs; drive-time explains the team-vs-coach asymmetry.
9. **"Fix coach clashes" swap tool** — same-venue, impact-checked swaps that clear a clash or move it to a coverable coach; never scatter a division or double-book a team.
10. **Field-space monitor** before scheduling; per-day column is binding. **Every run → stats/breakdown object + comparable scenario.** **Full-screen breakdown** (Divisions / Teams / Coaches). **In-app AI assistant** grounded in scheduler state.
11. **Impossible-matchup / soft time-notice detection** — before match creation and before scheduling, check each division for pairs whose time requests can't overlap. **Hard red** = disjoint on every day (both sides have a window) → block, they can never play. **Soft amber** = can meet but opposing/day-scoped time prefs (e.g. Sat-mornings vs Sun-afternoons) → heads-up only; lean test = early finish ≤ 2 PM, late start ≥ noon. Day-aware so a Saturday-only vs Sunday-only pair isn't a false hard flag. Surface in Pools, Divisions, the Dashboard, and the pre-schedule banner.
12. **Coach-conflict detection keys on the HEAD coach only (delta 71).** A team may list several coaches, but exactly one is the **head** — that is the single coach identity the engine groups teams by to find a multi-team coach and to flag/avoid same-time double-books (assistant-exempt, no travel buffer, all unchanged). Co-coaches on a team are for comms + self-service only and never create a scheduling conflict. So the engine still reads one coach per team — define it as the head.
