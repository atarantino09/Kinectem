---
name: Critical email MIME parity
description: Preserve material meaning across HTML and plaintext versions of compliance, security, and billing emails.
---

When restructuring an email for scanability, the HTML version must retain every material compliance, security, billing, expiration, and account-state term from the approved plaintext version.

**Why:** Most recipients read HTML. Keeping plaintext byte-for-byte stable is not enough if the redesigned HTML omits a required second step, a locked-account condition, a cancellation right, or another material term.

**How to apply:** Compare both MIME alternatives semantically for consent, authentication, billing, invitation-security, and account-state emails. Presentation may differ, but the action, timing, consequences, and rights must match.