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

Post-competition results entry must be a visible, separate section for operators, distinct from schedule import, on both the competition page and its editor.

**Why:** The user could not find the URL/upload controls behind the results-management link and explicitly requested a separate field for after a tournament or league. They also requested that the CSV Results action immediately open file selection, not merely switch to a CSV text box.

**How to apply:** Keep results URL and upload inputs discoverable without navigating first. Open the CSV file picker directly from the user's click so browser user-gesture requirements are respected. Preserve explicit review and publication; importing results alone must never publish a recap.

Organizers must not be required to confirm individual matches, fill missing scores, or manually resolve every team before creating bracket recaps from a whole results source.

**Why:** The user described the process as “way too difficult” and explicitly said they cannot confirm each match and will not do extra work when scores are missing.

**How to apply:** Make automated source validation and safe identity resolution support a simple upload, batch-generation, and explicit-publication flow. Missing scores stay unknown and produce partial coverage without invented outcomes. Detailed corrections may be optional, but must not become a required checklist; uncertain team identities remain unlinked rather than guessed.
