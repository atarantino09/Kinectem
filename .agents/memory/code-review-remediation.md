---
name: Code review remediation — intentional deviations & blockers
description: Why several CODE_REVIEW.md findings were deliberately not implemented as written, and which are blocked by locked files.
---

# Code review remediation: intentional deviations & constraints

The repo carries a `CODE_REVIEW.md` (S1–S14 security, F1–F5 frontend, B1–B6
backend). Most were implemented, but a few were deliberately deviated from or
left blocked. Future hardening work must stay consistent with these.

## Session cookie stays SameSite=None + Secure (NOT Lax)
S1/S8 literally say "switch session cookie to SameSite=Lax". Do **not** do this.
**Why:** the app is previewed/served inside the Replit proxy iframe (cross-site
context); SameSite=Lax would drop the `kinectem_session` cookie and break auth in
the preview. CSRF is instead mitigated via a CORS allowlist + Origin/Referer
checks. **How to apply:** if you touch cookie attributes, keep
`SameSite=None; Secure`; never "fix" it to Lax on the basis of the review text.

## Cursor pagination (F2, B5 org-list) is blocked by the locked OpenAPI spec
`lib/api-spec/openapi.yaml` is user-locked (no edits). Only `/search` and
`/assets/{id}/data` expose cursor params there. `/notifications`,
`/follow-requests`, `/teams/:id/members`, `/organizations/:id/teams` have none, so
their generated clients/validators can't take a cursor without editing the spec.
**How to apply:** treat F2/B5-org as constraint-blocked until the spec lock lifts;
don't hand-roll cursor params that diverge from the generated contract.
Note: the feed's infinite-scroll is inert by design (`paginate()` hardcodes
`hasMore:false`; `/feed` ignores cursor/limit) — works for page 1, not a crash.

## Missing optional secrets warn at boot, they do not hard-fail (S8/S9)
S8/S9 suggested hard-failing boot when security-relevant env (e.g.
`AI_KEYS_ENCRYPTION_KEY`) is absent. We kept a boot **WARN**, not a fatal.
**Why:** hard-fail risks bricking a deploy; the AI key is optional and
`SESSION_SECRET` (the fallback derivation source) is already ≥32 chars.
**How to apply:** prefer loud warn + safe fallback over fatal boot checks for
*optional* config.

## Deferred (documented, low-value / high-regression-risk)
- F1 roster virtualization (`TeamRosterTabs`, ~800 lines, bounded team-size data).
- B4 "flatten feed query" — only a "consider"; touches COPPA-sensitive paths.
- S11, S14 (S14 adds a DB write to the hot auth path), F5 Layout split — LOW.

## Locked files (never edit)
`lib/api-spec/openapi.yaml`, `artifacts/api-server/src/lib/coppa.ts`,
`exports/kinectem-sdk/`.
