---
name: Competition results grounding
description: Factuality, ownership, and blocked-source rules for organizer-written tournament stories
---

Tournament story generation uses an AI-selected, validated structure over reviewed result records, while score and winner sentences are rendered from those records. Operators can then edit and explicitly publish a normal draft.

**Why:** Tournament imports often contain incomplete scores or standings, and team-written accounts are not official results. Free-form generation can incorrectly invent a champion, scorer, statistic, or finished tournament. The constrained approach intentionally favors verifiable result coverage over an invented narrative.

**How to apply:** Future drafting improvements must validate every generated factual claim against the confirmed snapshot, or keep model output confined to references to known records. Supporting accounts remain clearly team-authored and must be re-fetched through public-visibility filtering.

Competition-owned tournament stories are distinct from team-authored game recaps; teams opt into canonical placements rather than owning or copying the original.

**Why:** The product requires that deleting a team cannot delete the competition story, and deleting a competition cannot delete a team's own game account.

**How to apply:** Do not implement new tournament-story integrations by creating fake team ownership or cloned articles. Preserve separate drafts and public versions when regenerating or editing a live story.

The supplied GotSport event page redirected to a JavaScript/reCAPTCHA verification page, not verified results.

**Why:** A verification document is not tournament evidence, and challenge solving or login bypass is explicitly outside the product scope.

**How to apply:** Treat verification responses as blocked before AI, give a truthful import status, and retain CSV/pasted-table fallback. Do not claim official GotSport parsing or use the schedule-import feature as proof of results support.

Do not show the “Post-competition results & bracket recaps” entry section on competition pages or in the competition console.

**Why:** On 2026-10-08 the user explicitly asked to remove the whole section, saying “it didnt work out.” This supersedes their earlier request for a prominent results-upload entry.

**How to apply:** Do not reintroduce the section during later competition-page changes. Removing its entry UI does not authorize deleting saved results, drafts, or published stories.

Competition pages must show only organizer-curated Featured Game Recaps as their recap section. Do not display the automatic Tournament Recaps / More team coverage section.

**Why:** On 2026-10-08 the user explicitly confirmed its removal and said recaps must be featured by the competition admin to appear.

**How to apply:** Do not restore automatic recap coverage on competition pages. Keep the explicit featuring permission gate and leave saved recap records and team-page stories intact.

Organizers must not be required to confirm individual matches, fill missing scores, or manually resolve every team before creating bracket recaps from a whole results source.

**Why:** The user described the process as “way too difficult” and explicitly said they cannot confirm each match and will not do extra work when scores are missing.

**How to apply:** Make automated source validation and safe identity resolution support a simple upload, batch-generation, and explicit-publication flow. Missing scores stay unknown and produce partial coverage without invented outcomes. Detailed corrections may be optional, but must not become a required checklist; uncertain team identities remain unlinked rather than guessed.

Automatic results identity linking must respect known bracket membership, even when a name, age, and gender match.

**Why:** A single same-named team in another bracket does not establish that it is the participant in this source; automatic preparation must not freeze a conflicting identity.

**How to apply:** Prefer an unambiguous team already in the target bracket. An unassigned identity needs unique, sufficient source context; conflicting or ambiguous identities stay unlinked without blocking generation.

Large brackets must not require organizers to split results manually to accommodate AI limits. Retain the complete imported evidence and disclose when a generated roundup covers a bounded selection.

**Why:** Full-record narratives can exceed provider or editable-draft size limits, while the user explicitly rejects extra preparation work.

**How to apply:** Automatically bound generation inputs, keep full source data available, and label the coverage truthfully rather than silently dropping records or implying a complete final result.
