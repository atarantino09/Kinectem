---
name: Notification bell acknowledgement
description: Opening the bell acknowledges unread notifications without resolving pending actions.
---

Opening the top-bar notification bell means marking current notifications as read and clearing the number immediately, including the parent’s child-notification counts. Do not require a separate “mark as read” click.

**Why:** The user explicitly wants clicking the bell to acknowledge notifications, rather than leave the number until each notification is opened individually.

**How to apply:** Reading is not deletion, invitation acceptance, or consent. Preserve notification history and pending actions. Child-stream acknowledgement is specific to the viewing parent, not other guardians. Notifications arriving later should still count as new until the next opening.
