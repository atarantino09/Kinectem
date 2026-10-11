# Recap submission safety

## Reproduced defects

The regression harness was run against the original committed composer and
API route sources using temporary Vite load overrides (removed after the run):

- A delayed first create, two Save Draft calls, and two form submissions
  started **four independent create mutations**, not one. This reproduces the
  missing synchronous guard and the asynchronous first-draft-ID race.
- Injecting a rejected `applyArticleTagFanout` after insertion returned **500**
  from the original create route, despite the earlier article insert.
  A response error did not mean persistence had failed.

These are reproducible code defects, not a claim about the specific actions
the production coach took.

## Production evidence, read-only

On 2026-10-11 a narrowly scoped, read-only production query found three
published `Tournament review` articles on `Legacy 2016/17 Boys Gold`, linked
to `Full 360 Columbus Day Cup 2026`. They have one author and identical body
hashes, but distinct IDs and creation times:

| Article ID | Creation time (UTC) |
| --- | --- |
| 84e922f7-a4d5-4810-bb5e-9f9eba0b7c14 | 2026-10-11 13:37:30.959 |
| bdbf6ac0-4dde-48f0-a570-b5a855c1f6f3 | 2026-10-11 13:37:41.185 |
| 90aec91b-5da6-4dcf-bced-f0dc36893681 | 2026-10-11 13:37:45.805 |

This confirms distinct database rows, rather than only repeated rendering.
It does not establish whether those requests were repeated clicks, retries,
separate composer sessions, or intentional separate submissions. Historical
request identities and an original browser interaction trace are unavailable.
No existing articles, reactions, or production data were modified.

## Persistence boundary

- Each normal composer session and each opened combined-recap dialog gets a
  stable `Idempotency-Key` through existing generated-hook request options.
  The locked OpenAPI and exported SDK are unchanged.
- The first request payload stays frozen after an uncertain response. Retry
  recovers its canonical ID, then current content is PATCHed to that ID.
  A definite 413 size rejection clears the frozen create and rotates the key,
  allowing a corrected photo/text payload; network and server errors retain it.
- Normal manual saves, autosaves, and publication share one promise queue.
  Handler-level intent refs guard before React renders. Publication drains
  saves and latest edits; the form prevents editing during publication.
  A sent snapshot, not later unsaved edits, becomes the saved baseline.
- Both button locations remain busy until the entire workflow finishes.
  Created IDs are retained before cache refreshes, tag work, or schedule
  linking. Recoverable follow-up failures are warnings, not failed creations.
- Actor + request key is a durable primary key. PostgreSQL transaction locks
  serialize same-key inserts across application processes, and article plus
  request identity commit in the same transaction. The request fingerprint
  rejects reuse for another payload. Deletion leaves a tombstone rather than
  resurrecting the article on retry.
- Draft publication conditionally updates only `status = draft`. Only the
  transition winner performs follow-up work. Repeats return current canonical
  state without resetting publication timestamps or rerunning transition-only
  notifications. Approval policy and guardian-routing helpers are unchanged.

Keys identify operations, **not content**. Different keys may create recaps
with the same team, game, title, date, and body. Unkeyed API clients retain
independent-create behavior. Team/feed listing logic is unchanged.

## Verification

- Frontend: 36 focused tests pass across the normal composer, form fields,
  and combined-recap dialog. Deferred responses cover click/form-submit
  overlap, delayed autosaves, latest edits, creation retries, whole-operation
  busy state, and recoverable schedule-link failures.
- Browser: a manually held first-create response verified Save Draft alone
  remains a draft; while it was pending the latest body edit and a form
  submission were applied. The observed order was one create, one latest-body
  PATCH, then one publication request. Both button locations were disabled.
  The team listing contained one canonical article with the latest body.
  The first timed-delay attempt was inconclusive; a narrow controlled repeat
  resolved the verification gap without reproducing an app failure.
- API: 8 new retry/transition tests pass. Coverage includes simultaneous
  same-key requests, ignored successful responses followed by retries,
  separate keys with identical content, actor isolation, mismatched payloads,
  post-insert failure, repeat publication, approval policy, and deletion
  tombstones. Retried operations yield one persisted article and one item in
  both team and home-feed responses, including combined recaps.
- Existing API suites: auto-tagging + pagination (40 tests), and combined /
  competition-only recaps (19 tests) pass. Existing permission and tagging
  behavior remain covered without changing their policies.
- Shared database declarations build successfully. The web production build
  passes with the artifact's PORT and BASE_PATH. Leaf typechecks still fail
  on unrelated pre-existing frontend test casts and backend Express/Drizzle
  errors; no unrelated baseline errors were repaired.

Retry recovery currently lasts for the mounted composer/dialog session.
Recovering an operation after a full browser reload would require separately
persisting its key and frozen request, which is not part of this change.
Optional delivery/tagging failures are not a general durable job queue: a
retry returns the same article, rather than replaying all notification work.
