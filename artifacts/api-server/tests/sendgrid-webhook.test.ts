import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  db,
  organizationInvites,
  organizations,
  rosterInvites,
  teams,
} from "@workspace/db";
import { app, request } from "./helpers";

// Task #669 — prove the SendGrid Event Webhook actually flips an invite's
// delivery_status when SendGrid reports a failure (the whole point of #666:
// an undelivered invite must NOT keep looking "fine" to admins). We exercise
// the genuine handler end-to-end: generate a real prime256v1 keypair, expose
// the public key as SENDGRID_WEBHOOK_VERIFICATION_KEY, and sign requests with
// the matching private key exactly as SendGrid's Signed Event Webhook does.

const WEBHOOK_PATH = "/api/sendgrid/webhook";

// One ephemeral ECDSA keypair for the whole file. The public DER (SPKI) bytes,
// base64-encoded, are what the handler loads from the env var; we sign with the
// private half so verifySignature() accepts our payloads.
const keyPair = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const PUBLIC_KEY_B64 = keyPair.publicKey
  .export({ format: "der", type: "spki" })
  .toString("base64");

function signedHeaders(rawBody: string): Record<string, string> {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signer = crypto.createSign("sha256");
  signer.update(timestamp);
  signer.update(Buffer.from(rawBody, "utf8"));
  signer.end();
  const signature = signer
    .sign({ key: keyPair.privateKey, dsaEncoding: "der" })
    .toString("base64");
  return {
    "Content-Type": "application/json",
    "x-twilio-email-event-webhook-signature": signature,
    "x-twilio-email-event-webhook-timestamp": timestamp,
  };
}

function postWebhook(events: unknown[]) {
  const rawBody = JSON.stringify(events);
  return request(app)
    .post(WEBHOOK_PATH)
    .set(signedHeaders(rawBody))
    .send(rawBody);
}

async function getTeamId(): Promise<string> {
  const [team] = await db.select().from(teams).limit(1);
  if (!team) throw new Error("No seed team found");
  return team.id;
}

async function getOrgId(): Promise<string> {
  const [org] = await db.select().from(organizations).limit(1);
  if (!org) throw new Error("No seed organization found");
  return org.id;
}

async function insertRosterInvite(): Promise<string> {
  const teamId = await getTeamId();
  const [row] = await db
    .insert(rosterInvites)
    .values({
      token: `wh-test-${crypto.randomUUID()}`,
      teamId,
      invitedEmail: `bounce-${Date.now()}@example.com`,
      role: "player",
      status: "pending",
      deliveryStatus: "sent",
    })
    .returning();
  return row.id;
}

async function insertOrgInvite(): Promise<string> {
  const orgId = await getOrgId();
  const [row] = await db
    .insert(organizationInvites)
    .values({
      organizationId: orgId,
      invitedEmail: `org-bounce-${Date.now()}@example.com`,
      role: "member",
      tokenHash: `wh-test-hash-${crypto.randomUUID()}`,
      status: "pending",
      deliveryStatus: "sent",
    })
    .returning();
  return row.id;
}

describe("SendGrid Event Webhook delivery tracking (task #669)", () => {
  let originalKey: string | undefined;

  beforeEach(() => {
    originalKey = process.env.SENDGRID_WEBHOOK_VERIFICATION_KEY;
    process.env.SENDGRID_WEBHOOK_VERIFICATION_KEY = PUBLIC_KEY_B64;
  });

  afterEach(() => {
    if (originalKey === undefined) {
      delete process.env.SENDGRID_WEBHOOK_VERIFICATION_KEY;
    } else {
      process.env.SENDGRID_WEBHOOK_VERIFICATION_KEY = originalKey;
    }
  });

  it.each(["bounce", "dropped", "deferred", "spamreport"] as const)(
    "flips a roster invite's delivery_status on a %s event",
    async (event) => {
      const expected: Record<string, string> = {
        bounce: "bounced",
        dropped: "dropped",
        deferred: "deferred",
        spamreport: "spam",
      };
      const inviteId = await insertRosterInvite();

      const res = await postWebhook([
        {
          event,
          timestamp: Math.floor(Date.now() / 1000),
          reason: "550 mailbox unavailable",
          kinectem_invite_id: inviteId,
          kinectem_invite_kind: "roster",
        },
      ]);
      expect(res.status).toBe(200);

      const [row] = await db
        .select()
        .from(rosterInvites)
        .where(eq(rosterInvites.id, inviteId))
        .limit(1);
      expect(row.deliveryStatus).toBe(expected[event]);
      expect(row.deliveryEventAt).not.toBeNull();
      expect(row.deliveryReason).toBe("550 mailbox unavailable");
    },
  );

  it("flips an org invite's delivery_status on a bounce (matched via custom_args)", async () => {
    const inviteId = await insertOrgInvite();

    const res = await postWebhook([
      {
        event: "bounce",
        timestamp: Math.floor(Date.now() / 1000),
        reason: "551 user does not exist",
        kinectem_invite_id: inviteId,
        kinectem_invite_kind: "org",
      },
    ]);
    expect(res.status).toBe(200);

    const [row] = await db
      .select()
      .from(organizationInvites)
      .where(eq(organizationInvites.id, inviteId))
      .limit(1);
    expect(row.deliveryStatus).toBe("bounced");
    expect(row.deliveryReason).toBe("551 user does not exist");
  });

  it("does NOT overwrite a bounce with a late 'delivered' event (out-of-order guard)", async () => {
    const inviteId = await insertRosterInvite();
    const bounceTs = Math.floor(Date.now() / 1000);

    // First: a recent bounce.
    const bounceRes = await postWebhook([
      {
        event: "bounce",
        timestamp: bounceTs,
        reason: "550 mailbox unavailable",
        kinectem_invite_id: inviteId,
        kinectem_invite_kind: "roster",
      },
    ]);
    expect(bounceRes.status).toBe(200);

    // Then: an older 'delivered' arrives late — must be ignored.
    const lateRes = await postWebhook([
      {
        event: "delivered",
        timestamp: bounceTs - 60,
        kinectem_invite_id: inviteId,
        kinectem_invite_kind: "roster",
      },
    ]);
    expect(lateRes.status).toBe(200);

    const [row] = await db
      .select()
      .from(rosterInvites)
      .where(eq(rosterInvites.id, inviteId))
      .limit(1);
    expect(row.deliveryStatus).toBe("bounced");
  });

  it("does advance to 'delivered' when the event is newer than the stored one", async () => {
    const inviteId = await insertRosterInvite();
    const base = Math.floor(Date.now() / 1000);

    await postWebhook([
      {
        event: "deferred",
        timestamp: base,
        kinectem_invite_id: inviteId,
        kinectem_invite_kind: "roster",
      },
    ]);
    await postWebhook([
      {
        event: "delivered",
        timestamp: base + 60,
        kinectem_invite_id: inviteId,
        kinectem_invite_kind: "roster",
      },
    ]);

    const [row] = await db
      .select()
      .from(rosterInvites)
      .where(eq(rosterInvites.id, inviteId))
      .limit(1);
    expect(row.deliveryStatus).toBe("delivered");
  });

  it("returns 503 (no crash) when the verification key is unset", async () => {
    delete process.env.SENDGRID_WEBHOOK_VERIFICATION_KEY;
    const inviteId = await insertRosterInvite();

    const res = await postWebhook([
      {
        event: "bounce",
        timestamp: Math.floor(Date.now() / 1000),
        kinectem_invite_id: inviteId,
        kinectem_invite_kind: "roster",
      },
    ]);
    expect(res.status).toBe(503);

    // The row is untouched — it stays at its prior 'sent' status.
    const [row] = await db
      .select()
      .from(rosterInvites)
      .where(eq(rosterInvites.id, inviteId))
      .limit(1);
    expect(row.deliveryStatus).toBe("sent");
  });

  it("rejects a tampered/invalid signature with 400 and leaves the row untouched", async () => {
    const inviteId = await insertRosterInvite();
    const rawBody = JSON.stringify([
      {
        event: "bounce",
        timestamp: Math.floor(Date.now() / 1000),
        kinectem_invite_id: inviteId,
        kinectem_invite_kind: "roster",
      },
    ]);
    const headers = signedHeaders(rawBody);

    const res = await request(app)
      .post(WEBHOOK_PATH)
      .set({
        ...headers,
        "x-twilio-email-event-webhook-signature": "not-a-valid-signature",
      })
      .send(rawBody);
    expect(res.status).toBe(400);

    const [row] = await db
      .select()
      .from(rosterInvites)
      .where(eq(rosterInvites.id, inviteId))
      .limit(1);
    expect(row.deliveryStatus).toBe("sent");
  });

  it("rejects with 400 when signature headers are missing", async () => {
    const rawBody = JSON.stringify([{ event: "bounce" }]);
    const res = await request(app)
      .post(WEBHOOK_PATH)
      .set("Content-Type", "application/json")
      .send(rawBody);
    expect(res.status).toBe(400);
  });
});
