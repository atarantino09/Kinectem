---
name: Invite delivery tracking + always-on copy link
description: How pending team/org invites flag undelivered email and always offer a shareable link (SendGrid Event Webhook).
---

# Invite delivery tracking (SendGrid Event Webhook)

Pending invites (team roster + org) carry a `delivery_status` enum
(`unknown|sent|delivered|deferred|bounced|dropped|spam`) plus
`delivery_event_at` / `delivery_reason`, on both `roster_invites` and
`organization_invites`.

**How status moves:**
- Set to `sent` right after a successful `sendEmail` hand-off.
- Advanced by the SendGrid Event Webhook (`POST /api/sendgrid/webhook`),
  matched back to the row via per-personalization `custom_args`
  (`kinectem_invite_id` + `kinectem_invite_kind` = `roster|org`).
- **Out-of-order guard:** webhook UPDATE only applies when the incoming event
  is `>=` the stored `delivery_event_at` (or it's null), so a late `delivered`
  can't clobber a real `bounced`.

**Webhook security / degradation:**
- Mounted BEFORE `express.json()` with `express.raw()` (needs raw body for the
  ECDSA verify), same as the Stripe webhook.
- Verify = Node `crypto`: `createPublicKey({format:"der",type:"spki"})` over the
  base64 `SENDGRID_WEBHOOK_VERIFICATION_KEY`; `createVerify("sha256")` over
  `timestamp + rawBody`, `dsaEncoding:"der"`. Headers:
  `x-twilio-email-event-webhook-{signature,timestamp}`.
- **Key unset → 503** (graceful degrade); copy-link fallback still covers it.

**Copy link is ALWAYS available (the real point of the feature):**
- Roster tokens are stored PLAINTEXT → client builds the link directly from the
  serialized `token`: `${origin}${BASE_URL}invites/${token}`. No endpoint needed.
- Org tokens are HASHED at rest → can't reconstruct. `POST
  /organizations/:orgId/invites/:inviteId/link` ROTATES the token and returns a
  fresh `acceptUrl`. Frontend caches the minted link per-row so re-copying
  doesn't keep rotating.

**Serialization:** delivery fields ride as extra fields on `toInvite`
(spec-helpers) and `toInviteResponse` (organization-invites) — `openapi.yaml` is
locked, so the client reads them via a narrow cast (same pattern as
`emailSent`/`acceptUrl`/`hasOwner`).
