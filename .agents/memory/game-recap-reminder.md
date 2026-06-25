---
name: Game-recap reminder scheduler
description: How the "write your game recap" reminder is delivered durably without double-sending or sending stale reminders.
---

# Game-recap reminder

A couple hours after a game (`event_type` in `game | scrimmage`, not all-day)
starts, recap-writing staff get an in-app notification nudging them to write
the recap — but only if no recap is linked yet.

## Why a DB sweep, not a per-event timer
In-process timers are lost on restart and don't coordinate across Autoscale
instances. The reminder runs as a startup + interval sweep over
`schedule_events`, mirroring `consent-scheduler.ts`. The "already sent" state
lives in a column (`schedule_events.recap_reminder_sent_at`), not memory.

## Double-send / stale-send safety (the non-obvious part)
The claim is an atomic `UPDATE ... SET recap_reminder_sent_at = now()
WHERE recap_reminder_sent_at IS NULL AND game_recap_id IS NULL
AND status = 'scheduled' RETURNING`. The mutable predicates (`game_recap_id`,
`status`) must be re-checked **inside the UPDATE**, not just in the SELECT —
a recap linked or game canceled between SELECT and UPDATE would otherwise send
a stale reminder.

**Why release-on-failure:** the stamp happens before the notification insert
(so a concurrent sweep can't also send). If the insert fails, the claim is
reverted (`recap_reminder_sent_at = NULL`) so a later sweep retries. Stamping
before send without the revert silently drops reminders on transient errors.

## Recipients
Mirror `notifyStaffOfPendingHighlight`: org owners/admins (`organization_admins`
role owner/admin) + accepted roster entries with `role = coach` OR
`position` in (`author`, `manager`). Same people who see the "Write game recap"
prompt on the event. System-generated, so the notification `actor_user_id` is
null.
