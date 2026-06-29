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
- Prefer dry-run-by-default for any prod-writing job (mirror the repo's
  `--dry-run` / `--apply` convention), and print the masked DB host + mode before
  writing as an operator safeguard.
- Exporting secrets/tokens to deployment logs (stdout) is a leak vector; prefer
  `--out=<secured-path>` when log readers may be broader than intended.
