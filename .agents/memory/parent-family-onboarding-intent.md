---
name: Parent family onboarding intent
description: Prevent duplicate player setup when separate parents receive the same team-chat invitation.
---

Parent onboarding must prominently ask parents to coordinate, offer the other-parent invitation before player creation, and make one shared player profile the normal path. Each adult keeps their own login; inviting the other parent must not mean creating their password or sharing credentials. Single-parent families must be able to skip the optional invitation.

**Why:** The user reports that both parents receive a coach’s invitation in TeamSnap or similar team chats and independently create the same child, producing duplicate roster players. They explicitly want the other-parent setup and coordination guidance before creating the player.

**How to apply:** Apply this ordering and clear copy to parent signup and team-invitation onboarding. Reuse secure guardian invitations to connect the second adult to the same child, never infer family authorization from names, and treat existing duplicate cleanup as a separate reviewed action.

An uncertain player-creation response remains the same creation intent even if the parent edits the spelling before retrying. Invitation delivery and player creation are separate outcomes; an email failure must never restart player creation.

**Why:** An earlier request can still commit after the browser reports a network error. Giving the retry a new identity can create a second player. A saved invitation also does not prove an email was delivered or that the other parent accepted.

**How to apply:** Preserve the creation intent and original submitted spelling across uncertain retries, and recover its exact result rather than guessing from a name. A missing receipt can mean the first request is still running, not that it failed; any request-reuse conflict must check for the committed profile again. Distinguish saved invitation, confirmed email submission, and accepted guardian access in every family-invitation UI.
