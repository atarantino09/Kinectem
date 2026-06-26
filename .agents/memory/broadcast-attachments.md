---
name: Broadcast / announcement attachments
description: How org-announcement file attachments work and the server-side type-allowlist rule.
---

# Org announcement attachments

Org announcements (broadcasts, scope=organization) can carry file attachments (camp/tryout flyers). Stored via a `broadcast_assets` join table, reusing the shared 3-step asset pipeline (request/PUT/confirm) and the inline data-URL convention (same as message_assets/album_photos).

## Rule: enforce the attachment type allowlist server-side, not just in the picker

The asset upload pipeline accepts a broader MIME set than announcements allow (images jpeg/png/webp + PDF). The client file picker filters types, but the send route takes raw `assetIds`. An org admin can therefore confirm a disallowed asset (e.g. `video/mp4`) through the generic pipeline and attach it by id, bypassing the picker.

**Why:** Architect flagged this as a blocking IDOR-adjacent gap during review. Client validation is cosmetic; the id-based attach path is the real trust boundary.

**How to apply:** The send route's ownership/validation helper must check each asset's `fileType` against the allowlist (alongside owner + confirmed) before inserting join rows, and return a 400. Any future "attach existing asset by id" feature needs the same server-side type check.

## Payload shape rule

- List endpoint (`/me/broadcasts`, up to 100 rows): return only `attachmentCount` (a count subquery). Never embed the data-URL bytes here — it bloats the inbox response.
- Detail endpoint (`/broadcasts/:id`): return full `attachments[]` with inline data URLs (single opened item only).
