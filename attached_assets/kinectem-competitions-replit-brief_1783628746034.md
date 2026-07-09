Build the Competitions feature described in the spec below. Use our existing Kinectem UI components, navigation, and design system so it stays consistent with the current app — but make the public competition page a clear visual standout versus org and team pages: theme its hero with the operator's brand color and add the featured game recaps rail, neither of which our org/team pages have.

Extend our existing tournament tables and import logic rather than duplicating them — the tournament match, participant slot, and claim tables already exist, so rename/generalize into `competition` and adapt the field names in the spec to match our current schema. Confirm the exact table and column names you'll touch before running the step-1 migration.

Build in the order given in section 12: ship steps 1–4 first (rename, self-serve ownership, branding, public page) so I get branded competition pages with claiming quickly, then do steps 5–6 (recap curation and the score ladder), which are the only genuinely new logic.

---

# Kinectem — Competitions (Leagues & Tournaments) Build Spec

*Use Kinectem's existing UI components, nav, and design system so everything stays consistent — but the public competition page should be a clear visual standout versus org and team pages (see §10). Adapt any field names below to match the conventions already in the codebase.*

---

## 0. What we're building

A `competition` is a league or tournament that owns a schedule of games. Teams claim their games, play them, and write game recaps. Those recaps flow back to the competition, which curates and features the best ones on its own branded public page. The public page is a growth funnel: an operator uploads one schedule and instantly gets a branded directory of every team, and every unclaimed team is an invitation to join Kinectem.

The tournament flow already built (admin creates a tournament → uploads a match CSV → each team name becomes an unclaimed slot → a coach claims their slot and inherits all their matches) is the foundation. This spec generalizes it into competitions, adds branding, adds self-serve ownership, and adds the recap-curation loop.

---

## 1. Generalize `tournament` → `competition`

Rename the existing `tournament` entity to `competition` and add a type tag.

- Add `type` enum: `'tournament' | 'league'` (operator picks this at creation; default `'tournament'`).
- Migration: existing tournaments become competitions with `type = 'tournament'`. Preserve all existing matches, slots, and claims.
- The two types are mechanically identical. The tag only changes:

| Behavior | Tournament | League |
|---|---|---|
| Typical duration | One weekend | Multiple weekends / a season |
| Schedule import | Usually one upload | Repeated uploads over the season (see §4) |
| Public page framing | Event (dates, "Ended" when over) | Season (ongoing, standings-capable later) |

Everything else — data model, claiming, branding, curation, scoring — is shared.

---

## 2. Data model

Mark of `[NEW]` = new field/table. Everything else already exists in some form.

### `competition`
- `id`
- `name`
- `type` `[NEW]` — `'tournament' | 'league'`
- `slug` — public URL, e.g. `/c/columbus-cup-2026`
- `start_date`, `end_date`
- `location` (optional)
- `description` (optional)
- `owner_user_id` `[NEW]` — the operator who created it (see §3)
- `status` — `scheduled | live | ended` (derive from dates, or explicit)
- `auto_approve_claims` `[NEW]` — boolean, default `true` (see §5)
- **Branding `[NEW]`:**
  - `logo_url`
  - `brand_color` — hex; drives the public page theme
  - `banner_url` (optional)
  - `website_url` (optional)

### `competition_game` (the existing tournament match)
- `id`, `competition_id`
- `match_number`, `date`, `start_time`
- `age`, `gender`, `division`, `bracket`
- `venue`, `venue_state`, `field`
- `home_slot_id`, `away_slot_id` — the two participant slots (team-name strings from import)
- `home_team_id`, `away_team_id` — nullable FKs, set when a slot is claimed
- `home_score_official`, `away_score_official` `[NEW]` — nullable; set by import or operator (see §6)
- `status` — `scheduled | canceled | postponed | completed`

### `participant_slot` (existing)
- `id`, `competition_id`
- `team_name` (raw string from the import)
- `division`, `bracket`, `age`, `gender`
- `claimed_by_team_id` — nullable

### `team_claim` (existing)
- Links a claiming team to a `participant_slot`; claiming a slot links the team to all games where that slot is home or away. One claim per slot (lock it).

### `game_recap` (existing — extend)
- `competition_id` `[NEW]` — nullable; set when the recap's game belongs to a competition (derivable via game → slot → competition)
- `competition_game_id` `[NEW]` — nullable link to the specific game
- `author_team_id` — which team wrote it (both teams in a game may each write one; see §7)
- `featured` `[NEW]` — boolean, default `false`; operator toggles this (see §7)

### `game_score_report` `[NEW]`
One row per team that self-reports a score for a game.
- `id`, `competition_game_id`, `team_id`
- `home_score`, `away_score`
- `created_at`

---

## 3. Ownership & permissions (self-serve — v1)

This is the main backend change. Today, competition creation and import are platform-admin-only. In v1, **any signed-in user can create a competition and becomes its operator/owner.**

- `competition.owner_user_id` = the creator.
- Add a per-competition **operator** scope: the owner can manage only their own competitions (branding, schedule uploads, claim settings, recap curation). They do **not** get platform-wide admin powers.
- Move the "Create a competition" form and the operator console **out of the Admin-only area** into a user-accessible space (e.g. a top-level "Competitions" section, or a "Create → Competition" entry). The existing create/import logic is reused as-is; only who can reach it changes.
- Platform admins retain global oversight via the existing Moderation tools (see §11).

---

## 4. Schedule & results import

Reuse the existing importer and CSV format (`match #, date, start time, age, gender, division, bracket, venue, venue state, field, home team, home score, away team, away score`; 1,000-row limit).

- **Tournaments:** typically one upload. "Replace schedule" already exists.
- **Leagues `[NEW behavior]`:** schedules arrive incrementally across the season. Imports must **append to existing slots**: if a slot with the same team name already exists and is claimed, attach the new games to that claimed team automatically (no re-claiming). The existing dedup already keys on team name — extend it to "match existing slot → append games, preserve claim."
- **Results:** because operators can re-upload the finished schedule (e.g. a GotSport export with scores already in the `home score`/`away score` columns), populating official scores is nearly zero-effort. When a row has scores, write them to `home_score_official` / `away_score_official`. This is the authoritative (Official) tier in §6.

---

## 5. Claiming

The existing slot-claim flow is unchanged, just surfaced on a branded page and (in v1) governed by the operator's claim setting.

- `auto_approve_claims` (default `true`): a coach claiming a slot links immediately.
- If an operator turns it off, claims enter a **pending** state and the operator approves/rejects each one in the console before the team links to its games.
- On claim, the competition's branding cascades onto the claimed games (see §8).

---

## 6. Scores — resolution ladder

A game's score is a single fact with multiple possible sources. Resolve to the **highest available tier** and use that to decide where the score appears.

**Fields involved:** `home_score_official` / `away_score_official` on the game (set by import or operator), and `game_score_report` rows (one per claiming team that self-reports).

**Resolution (pseudocode):**

```
function resolveScore(game):
  if game.home_score_official != null and game.away_score_official != null:
    return { state: 'official', public: true }          # shows everywhere

  reports = game_score_reports(game)                     # 0, 1, or 2 rows

  if reports.length == 2:
    if reports[0].home == reports[1].home and reports[0].away == reports[1].away:
      return { state: 'confirmed', public: true }        # both teams agree → shows everywhere
    else:
      flag_dispute(game)                                 # surfaced in operator console
      return { state: 'disputed', public: false }        # shows nowhere public until resolved

  if reports.length == 1:
    return { state: 'reported', public: false,           # shows only on that team's own recap
             team_local: reports[0].team_id }

  return { state: 'none', public: false }                # no score; recap still publishes
```

**Where each state shows:**

| State | Team's own recap / schedule | Competition public page (shareable version) |
|---|---|---|
| Official | ✓ | ✓ |
| Confirmed (both teams agree) | ✓ | ✓ |
| Reported (one team, or teams disagree) | ✓ (that team's own reported number, label "as reported") | ✗ |
| None | — (no score) | ✗ |

- **Disputes** (two teams disagree) raise a flag in the operator console; the operator can enter an official score in one action, which promotes it to Official.
- **Never let score state block recap publishing.** A recap publishes and can be featured with or without a score.
- On a team's own recap, display priority is Official > Confirmed > that team's own report.

---

## 7. Game recaps & curation

- **Both teams in a game may each write their own game recap** (two perspectives, two storybooks). Don't restrict to one side. Auto-tag still applies to the authoring team's full roster; the opponent's players are tagged only if that opponent also claims and writes their own recap.
- **Link recaps to the competition:** when a recap is created for a claimed competition game, set `competition_id` and `competition_game_id` (derivable via the game).
- **Curation queue:** the operator console lists recaps whose `competition_id` matches, newest first. Each has **Feature** (sets `featured = true`) and **Hide**. The public page's featured rail renders recaps where `featured = true` for that competition.
- Query that feeds the queue: `game_recaps WHERE competition_id = :id ORDER BY created_at DESC`. Query that feeds the public rail: same, `AND featured = true`.

---

## 8. Branding & the cascade

Four fields drive branding: `logo_url`, `brand_color`, `banner_url`, `website_url`. The same objects render differently depending on whose page you're on:

- **Competition public page:** competition brand is **primary** — hero uses `brand_color`, shows `logo_url` and `banner_url`. Kinectem appears only as a small "Powered by Kinectem" credit.
- **Team's own schedule (member-only) and the team's game recap:** the **team/org** is primary. Claimed competition games carry a small competition **badge** — logo + "`{division}` · `{competition name}`". The competition is attribution here, not the theme.
- **Featured recap card on the competition page:** the card carries the **authoring team's** color accent, sitting inside the competition-branded page. (Three layers visible at once: competition owns the page, each recap carries its team's color, Kinectem is the credit.)

---

## 9. Front-end surfaces

Build three surfaces. All reuse Kinectem components; see §10 for how the public page stands out.

### 9a. Public competition page (`/c/{slug}`)
Sections top to bottom:
1. **Branded hero** — `brand_color` band, `logo_url`, competition name, type tag, dates + location, "X / Y teams telling their story", "Sign up your team" CTA, "Powered by Kinectem" credit.
2. **Featured game recaps rail** — cards from §7 (the only section with a new data dependency). Hide the section entirely if none are featured yet.
3. **Teams / claim grid** — existing two-column claim list (name + `{year} {age} {gender} {level} · {bracket}` subtitle + Claim / Taken). This is the funnel; unclaimed rows stay visible.
4. **Schedule** — existing division-grouped match list (`#match · date · time · field`, "A vs B", score on the right where resolved per §6).

Reads: everything except the featured rail reads data that already exists (competition, slots, claims, games, scores).

### 9b. Operator console (per competition, owner-gated)
Panels top to bottom:
1. **Header** — name, `slug`, type toggle (Tournament / League), status, "View public page".
2. **Branding** — logo upload, `brand_color` picker, banner upload, website field.
3. **Game recaps (curation queue)** — incoming recaps with Feature / Hide; a "new" count badge.
4. **Claims** — `auto_approve_claims` toggle + claimed/total count; pending-claim approvals when auto-approve is off.
5. **Schedule & results** — "Replace schedule" upload + the existing match/score list; note when scores were imported.

### 9c. Self-serve create flow
The entry a brand-new operator hits:
1. **Details** — name, type (Tournament / League), dates, location, description.
2. **Branding** — logo, color, banner, website (skippable, editable later).
3. **Upload schedule** — the existing importer.
On completion, the creator is set as `owner_user_id` and lands in the operator console (9b).

---

## 10. Design direction (consistent, but a standout)

Use Kinectem's existing UI everywhere — same nav, sidebar patterns, card style, typography (Poppins/Inter per the system), gradient primary buttons, outline secondaries, gray uppercase section labels, Tabler-style outline icons. The operator console and create flow should feel identical to the current admin console.

Make the **public competition page** clearly distinct from org and team pages by:
- **Custom brand theming** — org/team pages use Kinectem's standard chrome; the competition page themes its hero (and accents) with the operator's `brand_color`. That colored, logo-forward hero is the immediate signal "this is a competition, not a team."
- **The featured game recaps rail** — a section org/team pages don't have. It's the visual centerpiece.
- **The public claim directory + division schedule** — a public, event-scale layout, versus the member-only, single-team feel of a team page.

Net: same building blocks, distinctly branded and broader in scope.

---

## 11. Moderation

Self-serve means anyone can publish a branded public page, which is a new moderation surface. Ensure the existing platform Moderation tools cover competitions — name, logo, banner, and featured recaps — so a bad actor can't publish junk branding. Scope this now; it's annoying to retrofit.

---

## 12. Suggested build order

1. Rename `tournament` → `competition` + `type` tag + migration (§1).
2. Ownership + self-serve permissions; move create/console out of Admin-only (§3).
3. Branding fields + branding editor panel (§2, §8, §9b).
4. Public competition page with branded hero + existing claim grid + schedule (§9a) — no featured rail yet.
5. Recap → competition link + `featured` flag + curation queue + public featured rail (§7).
6. Score reconciliation ladder + `game_score_report` + dispute flag (§6).
7. League incremental-append import behavior (§4).
8. Self-serve create flow polish (§9c) + moderation coverage (§11).

Steps 1–4 already stand on mostly-existing code; 5–6 are the genuinely new logic.

---

## 13. Locked decisions (quick reference)

- One `competition` entity; operator picks a `tournament | league` tag.
- v1 is self-serve: creator owns and operates their competition page.
- Both teams in a game may each write a game recap.
- Both teams may report scores. Official (imported/operator) wins; if two team reports agree it's Confirmed; a single report or a disagreement stays off the public/shareable version (team-local or flagged); disagreement flags the operator to resolve.
- Claims auto-approve by default, with a per-competition toggle to require operator approval.
- Branding cascades: competition brand on its own page; competition badge on team surfaces; Kinectem as a small credit.
- Terminology: always "game recap" (never "recap" alone); auto-tag = the full roster.
