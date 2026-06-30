---
name: Production data seeding after publish
description: Publishing syncs schema only (not rows); operator-seeded data must be reseeded into prod, and secret tokens are environment-specific.
---

# Production data seeding after publish

Publishing this monorepo syncs the **database schema only, not row data**. Any
data that exists only in the development DB (e.g. operator-seeded "written-in"
organization pages) will be **absent in production** after the first publish and
must be explicitly reseeded.

**Why:** a fresh prod DB starts empty of app rows; the agent has read-only prod
access and cannot INSERT into prod directly, so reseeding has to run *inside* the
production environment.

**How to apply:**
- Run reseed/backfill scripts as a Replit Scheduled/one-off Deployment so
  `DATABASE_URL` resolves to prod. The agent cannot trigger publish or run code
  in the prod environment itself.
- Secret tokens (e.g. org `claim_token`) are **minted fresh per environment** —
  dev tokens are NOT valid in prod. Always export claim/invite links *from the
  prod run*, never reuse dev links.
- The seed list travels dev -> prod as a committed CSV (the prod job can't read
  the dev DB). That snapshot goes **stale** as new rows are added in dev, so
  **regenerate it from the dev DB right before publishing**, or the seed job
  pushes an outdated list.
- Prefer dry-run-by-default for any prod-writing job (mirror the repo's
  `--dry-run` / `--apply` convention), and print the masked DB host + mode before
  writing as an operator safeguard.
- Exporting secrets/tokens to deployment logs (stdout) is a leak vector; prefer
  `--out=<secured-path>` when log readers may be broader than intended.

**Single-deployment ("Publishing") projects have no scheduled-job UI.** When the
whole monorepo ships as one Autoscale deployment, there is no separate
Scheduled/one-off Deployment to "Run now", so script-based reseeding has nowhere
to run. Instead, expose the reseed as an **authed, idempotent endpoint inside the
already-deployed server** (reuse the existing operator password gate, e.g. the
founding-admin HMAC-bearer flow) that the operator triggers once from the browser
and that returns the claim-links CSV directly.
- Bundle the seed list **into the server** (a generated TS module), don't read a
  CSV at runtime — the prod bundle's CWD/filesystem layout is not guaranteed, and
  an embedded module is guaranteed present so the seed works on the first click.
- The endpoint creates rows with read-then-insert; there's **no unique index on
  org name**, so wrap it in a tx + `pg_advisory_xact_lock(hashtext(...))` to make
  concurrent/double-click runs race-safe (same pattern as team-cap enforcement).
- A user's **dev login won't work in prod** (publish copies no user rows); that's
  why the password-gated operator page — not an app account — is the right vehicle.
