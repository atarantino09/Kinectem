---
name: Team game hiding & recap-game links
description: Team-page competition game hide/unhide semantics and per-game recap links (extra-spec fields, viewer-aware schedule).
---

# Team game hiding & recap-game links

- **Hide scope is the team page only.** `team_hidden_competition_games` filters matches out of `GET /teams/:teamId/tournament-schedule` for non-managers; team admins still see them with an extra-spec `hidden: true` flag. Competition public/console pages are intentionally unaffected.
  - **Why:** Teams wanted to curate their own page (e.g. bad losses) without rewriting tournament history for organizers/followers.
  - **How to apply:** Never filter hidden games on competition-side endpoints; keep POST/DELETE `/teams/:teamId/competition-games/:matchId/hide` idempotent + `canManageTeam`-gated.
- **Recap→game link is extra-spec** (`openapi.yaml` locked): create/PATCH accept `competitionGameId`, validated by `validateExplicitGameLink` (game must belong to the selected competition for that team → `invalid_competition_game`). Schedule emits per-match `recapPostId` via `articlePostId()` (`article-<uuid>`, valid for `/posts/{id}`).
- **Client touch-gating pitfall:** `GET /posts/:id` does not expose the game id (locked spec), so on draft reload `competitionGameId` starts `""` untouched. PATCH must only send it when `gameTouched && competitionId` — otherwise the first autosave clears the server-side game link (same class of bug as draft-autosave-field-clobber).
- Deep-link pattern: `/app/posts/new?...&competitionId=<id>&matchId=<id>` pre-selects competition + game with touched=true so autofill (gameDate/opponent) applies.

## Competition-only authoring

An explicit competition does not imply a specific imported game. A deliberate unlisted-game choice must suppress date-based match guessing; untouched saves must preserve the optional link even when they resend the same competition.

**Why:** Playoff and extra games can share a date with an imported match, or fall after the competition's imported date range. Guessing by date can incorrectly place a recap on a different game's schedule row.

**How to apply:** Keep competition validation and ordinary automatic derivation, but distinguish an absent match choice from an explicit no-match choice. Competition-level entry points must not prefill a date, opponent, or match.

Empty competition visibility for staff must use recap-authoring rights, not management rights. An accepted roster author or manager may write recaps without permission to see hidden games or assignment-management details.

**Why:** A manager-only empty-group fallback hides the entire new authoring entry point from otherwise authorized staff when the competition has no public game rows.

**How to apply:** Retain empty claimed competition groups for recap authors while keeping hidden match rows and management metadata restricted to managers.
