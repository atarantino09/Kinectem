import crypto from "node:crypto";
import type { Request, Response } from "express";
import { db, rosterInvites, organizationInvites } from "@workspace/db";
import { and, eq, isNull, lte, or } from "drizzle-orm";
import { logger } from "../lib/logger.js";

// Task #666 — SendGrid Event Webhook. Optional: only active when
// SENDGRID_WEBHOOK_VERIFICATION_KEY is set. Configure a Signed Event Webhook in
// the SendGrid dashboard (Settings → Mail Settings → Event Webhook) pointing at
// <APP_BASE_URL>/api/sendgrid/webhook, enable signature verification, and paste
// the public "Verification Key" into Secrets. Without it, invites still send and
// the always-available copy-link fallback covers undelivered mail; this handler
// just keeps the per-invite delivery_status fresh (bounced/dropped/etc).

// Map SendGrid event names → our invite_delivery_status enum. Only the events
// that move an invite's delivery state are tracked; opens/clicks are ignored.
const EVENT_STATUS: Record<string, string> = {
  processed: "sent",
  delivered: "delivered",
  deferred: "deferred",
  bounce: "bounced",
  dropped: "dropped",
  spamreport: "spam",
};

type SendGridEvent = {
  event?: string;
  timestamp?: number;
  reason?: string;
  type?: string;
  kinectem_invite_id?: string;
  kinectem_invite_kind?: string;
};

// Verify SendGrid's ECDSA (prime256v1) signature over `timestamp + rawBody`.
// The verification key is a base64-encoded DER SPKI public key; the signature
// header is a base64 DER-encoded ECDSA signature.
function verifySignature(
  publicKeyBase64: string,
  payload: Buffer,
  signatureB64: string,
  timestamp: string,
): boolean {
  try {
    const key = crypto.createPublicKey({
      key: Buffer.from(publicKeyBase64, "base64"),
      format: "der",
      type: "spki",
    });
    const verifier = crypto.createVerify("sha256");
    verifier.update(timestamp);
    verifier.update(payload);
    verifier.end();
    return verifier.verify(
      { key, dsaEncoding: "der" },
      Buffer.from(signatureB64, "base64"),
    );
  } catch (err) {
    logger.warn({ err }, "SendGrid webhook signature verification errored");
    return false;
  }
}

async function applyEvent(ev: SendGridEvent): Promise<void> {
  const inviteId = ev.kinectem_invite_id;
  const kind = ev.kinectem_invite_kind;
  const status = ev.event ? EVENT_STATUS[ev.event] : undefined;
  if (!inviteId || !kind || !status) return;

  const eventAt = ev.timestamp ? new Date(ev.timestamp * 1000) : new Date();
  // SendGrid can deliver events slightly out of order; only advance the row
  // when this event is at least as recent as the one already recorded so a
  // late "delivered" can't overwrite a real "bounced".
  const notOlder = or(
    isNull(rosterInvites.deliveryEventAt),
    lte(rosterInvites.deliveryEventAt, eventAt),
  );
  const reason = ev.reason ? ev.reason.slice(0, 500) : null;

  if (kind === "roster") {
    await db
      .update(rosterInvites)
      .set({ deliveryStatus: status as never, deliveryEventAt: eventAt, deliveryReason: reason })
      .where(and(eq(rosterInvites.id, inviteId), notOlder));
  } else if (kind === "org") {
    await db
      .update(organizationInvites)
      .set({
        deliveryStatus: status as never,
        deliveryEventAt: eventAt,
        deliveryReason: reason,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(organizationInvites.id, inviteId),
          or(
            isNull(organizationInvites.deliveryEventAt),
            lte(organizationInvites.deliveryEventAt, eventAt),
          ),
        ),
      );
  }
}

export async function sendgridWebhookHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const verificationKey = process.env.SENDGRID_WEBHOOK_VERIFICATION_KEY;
  if (!verificationKey) {
    res.status(503).json({ error: "Webhook not configured" });
    return;
  }
  if (!Buffer.isBuffer(req.body)) {
    logger.error(
      "SendGrid webhook body is not a Buffer — express.json() ran before the raw parser",
    );
    res.status(500).json({ error: "Webhook processing error" });
    return;
  }

  const sigHeader = req.headers["x-twilio-email-event-webhook-signature"];
  const tsHeader = req.headers["x-twilio-email-event-webhook-timestamp"];
  const signature = Array.isArray(sigHeader) ? sigHeader[0] : sigHeader;
  const timestamp = Array.isArray(tsHeader) ? tsHeader[0] : tsHeader;
  if (!signature || !timestamp) {
    res.status(400).json({ error: "Missing signature headers" });
    return;
  }
  if (!verifySignature(verificationKey, req.body, signature, timestamp)) {
    res.status(400).json({ error: "Invalid signature" });
    return;
  }

  let events: SendGridEvent[];
  try {
    const parsed = JSON.parse(req.body.toString("utf8"));
    events = Array.isArray(parsed) ? parsed : [];
  } catch {
    res.status(400).json({ error: "Invalid payload" });
    return;
  }

  try {
    for (const ev of events) {
      await applyEvent(ev);
    }
    res.status(200).json({ received: true });
  } catch (err) {
    logger.error({ err }, "SendGrid webhook handler error");
    res.status(500).json({ error: "Webhook processing error" });
  }
}
