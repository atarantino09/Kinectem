---
name: Daily admin digest
description: The operator-facing daily activity email — why its content is masked differently from user-facing campaigns, and its two send paths.
---

# Daily admin digest

A daily ops email summarizing *yesterday's* platform activity, sent to a
manually-managed list of operator addresses (admin-curated), NOT to app users.
A cron (Scheduled Deployment) runs the sender; an in-app admin page manages the
recipient list and can trigger a "send preview now".

## Why its masking rules differ from the user-facing email campaigns

The user-facing campaigns (weekly digest, nudges) are COPPA-safe via
minor→guardian routing + unsubscribe links. The admin digest has **neither** —
it goes to arbitrary operator inboxes that are not necessarily platform admins.
So the only lever is *content*:

- **Itemize only public or masked names**: org names + team names (public), and
  member display names with minors masked via the shared `maskDisplayName`.
- **Keep free-text UGC count-only**: recap titles, highlight titles, and content
  report `reason`/`note` are all free text that can embed a minor's full name.
  Never itemize them — emit a count only. Recaps/highlights are itemized by
  their **team** name instead of their title.

**Why:** a code review flagged the first version as a blocking COPPA leak — it
listed raw recap/highlight titles and grouped report reasons, any of which can
contain a minor's name, to recipients with no consent relationship.
**How to apply:** if you add a new itemized section, ask "is every string in it
either a public entity name or a masked display name?" If it's user-authored
free text, keep it count-only.

## Two send paths (intentional)

- **In-app preview** uses the api-server admin-aware sender (`lib/email.ts`),
  which respects admin-configured SendGrid credentials.
- **Cron** uses the connector/env positional sender in
  `scripts/src/lib/email-campaign.ts` (`resolveCredentials()` + `sendEmail`).

The digest **builder is a pure function** of `(db, window)` shared by both, so
preview and cron always render identically. The "yesterday" window is computed
in `ADMIN_DIGEST_TIME_ZONE` (default UTC). A quiet day still sends an email
(zero-event digest is intentional, so recipients know the job ran).
