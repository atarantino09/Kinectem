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
