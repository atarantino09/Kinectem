---
name: Two org-page claim flows
description: Ownerless (bulk-imported) org pages have TWO distinct claim paths — review-gated request vs. secret-token instant claim. Don't conflate them.
---

# Two distinct ways to claim an ownerless org page

Bulk-imported org pages are ownerless (no owner row, null creator). There are
**two** independent ways to claim one; keep them straight — they have different
trust models:

1. **Public claim *request* (review-gated) — RETIRED.** Originally an
   admin-role user could submit a request that a platform admin approved. This
   open path is now disabled: `POST /organizations/:orgId/claims` returns
   `403 CLAIM_INVITE_ONLY` and the in-app "Claim this organization" button is
   removed, so random users can't claim arbitrary org pages. The route + admin
   review queue are kept so any pre-existing pending rows stay reviewable.
   Claiming is now **invite-only via the secret link** (#2 below).
   **Why:** owner wants to hand-deliver claim links to specific admins, not let
   anyone who finds an unclaimed page request it. Unclaimed orgs intentionally
   stay publicly visible (search + detail) so the directory looks populated.

2. **Secret claim *link* (token = authorization, instant)** — operator copies a
   unique per-org link to each org; opening it and signing up makes the
   recipient the owner **directly**, bypassing both the admin-role gate and the
   platform-admin review. The token IS the authorization, same trust model as
   email invite links.

**Why the token is stored plaintext:** the link must be re-displayable (admin
screen + CSV export) so operators can re-send it. That follows the
email-invite-token precedent — NOT the hashed-token precedent
(guardian-confirm / password-reset), where the raw value only ever leaves the
server once.

**Frontend flow for the secret link:** unauthenticated visitor → signup/login
with `returnTo` → on return the claim finalizes **automatically** (no extra
confirmation click) → land on the org page. A logged-in visitor on a valid
unclaimed link auto-claims on arrival. This auto-finalize was an explicit
requirement — a manual "Claim" button alone is considered an incomplete
implementation of this flow.

**Race safety (both flows):** finalize runs in a transaction that re-checks for
an existing owner before inserting the owner row; the one-owner-per-org unique
index is the backstop — catch its duplicate-key violation and surface "already
claimed" (409), never a 500. A claimed link shows an "already claimed" state and
refuses to transfer ownership.

**How to apply:** when adding org-ownership features, decide which trust model
applies and don't bolt an instant-claim path onto the review-gated flow or vice
versa. Both must stay owner-exclusive (one owner per org, enforced by the
index).
