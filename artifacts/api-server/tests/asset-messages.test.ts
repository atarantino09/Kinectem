import { describe, expect, it } from "vitest";
import { app, loginAs, request } from "./helpers";

const TINY_PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082",
  "hex",
);

async function uploadImage(
  agent: ReturnType<typeof request.agent>,
  fileName = "tiny.png",
): Promise<string> {
  const reqRes = await agent.post("/api/v1/assets/upload").send({
    fileName,
    fileType: "image/png",
    fileSize: TINY_PNG.length,
  });
  expect(reqRes.status).toBe(201);
  const { assetId, uploadUrl } = reqRes.body as {
    assetId: string;
    uploadUrl: string;
  };
  expect(assetId).toBeTruthy();
  expect(uploadUrl).toContain(`/assets/${assetId}/data`);

  const url = new URL(uploadUrl);
  const putRes = await agent
    .put(`${url.pathname}${url.search}`)
    .set("Content-Type", "image/png")
    .send(TINY_PNG);
  expect(putRes.status).toBe(204);

  const confirmRes = await agent.post(`/api/v1/assets/${assetId}/confirm`);
  expect(confirmRes.status).toBe(200);
  expect(confirmRes.body.status).toBe("confirmed");
  return assetId;
}

describe("asset upload + message attachments", () => {
  it("requires authentication for /assets/upload", async () => {
    const res = await request(app).post("/api/v1/assets/upload").send({
      fileName: "x.png",
      fileType: "image/png",
      fileSize: 10,
    });
    expect(res.status).toBe(401);
  });

  it("validates the upload request payload", async () => {
    const { agent } = await loginAs((u) => u.email === "coach@kinectem.demo");
    const bad = await agent.post("/api/v1/assets/upload").send({
      fileName: "",
      fileType: "image/png",
      fileSize: 10,
    });
    expect(bad.status).toBe(400);

    const tooBig = await agent.post("/api/v1/assets/upload").send({
      fileName: "huge.png",
      fileType: "image/png",
      fileSize: 50 * 1024 * 1024,
    });
    expect(tooBig.status).toBe(400);
  });

  it("uploads an image, creates a conversation with the attachment, and exposes it on the message", async () => {
    const sender = await loginAs((u) => u.email === "coach@kinectem.demo");
    const recipient = await loginAs((u) => u.email === "marcus@kinectem.demo");

    const assetId = await uploadImage(sender.agent);

    const createRes = await sender.agent.post("/api/v1/conversations").send({
      recipientType: "user",
      recipientId: recipient.user.id,
      message: { body: "look at this", assetIds: [assetId] },
    });
    expect(createRes.status).toBe(201);
    const conversationId: string = createRes.body.id;
    expect(conversationId).toBeTruthy();

    const msgsRes = await sender.agent.get(
      `/api/v1/conversations/${conversationId}/messages`,
    );
    expect(msgsRes.status).toBe(200);
    const messages = msgsRes.body.data as Array<{
      id: string;
      body?: string | null;
      assets: Array<{ id: string; mimeType: string; url: string | null }>;
    }>;
    expect(messages.length).toBe(1);
    const m = messages[0];
    expect(m.body).toBe("look at this");
    expect(m.assets).toHaveLength(1);
    expect(m.assets[0].id).toBe(assetId);
    expect(m.assets[0].mimeType).toBe("image/png");
    expect(m.assets[0].url).toBeTruthy();

    const recipientMsgs = await recipient.agent.get(
      `/api/v1/conversations/${conversationId}/messages`,
    );
    expect(recipientMsgs.status).toBe(200);
    expect(recipientMsgs.body.data[0].assets[0].id).toBe(assetId);
  });

  it("rejects assetIds the sender does not own", async () => {
    const owner = await loginAs((u) => u.email === "marcus@kinectem.demo");
    const other = await loginAs((u) => u.email === "coach@kinectem.demo");
    const recipient = await loginAs((u) => u.email === "lisa@kinectem.demo");

    const assetId = await uploadImage(owner.agent);

    const res = await other.agent.post("/api/v1/conversations").send({
      recipientType: "user",
      recipientId: recipient.user.id,
      message: { body: "stealing your asset", assetIds: [assetId] },
    });
    expect([400, 403, 404]).toContain(res.status);
  });

  it("rejects assetIds that have not been confirmed", async () => {
    const sender = await loginAs((u) => u.email === "coach@kinectem.demo");
    const recipient = await loginAs((u) => u.email === "jordan@kinectem.demo");

    const reqRes = await sender.agent.post("/api/v1/assets/upload").send({
      fileName: "pending.png",
      fileType: "image/png",
      fileSize: TINY_PNG.length,
    });
    expect(reqRes.status).toBe(201);
    const assetId: string = reqRes.body.assetId;

    const res = await sender.agent.post("/api/v1/conversations").send({
      recipientType: "user",
      recipientId: recipient.user.id,
      message: { body: "premature send", assetIds: [assetId] },
    });
    expect([400, 422]).toContain(res.status);
  });

  it("rejects more than 10 attachments on a brand-new conversation, even when every id is valid", async () => {
    const sender = await loginAs((u) => u.email === "coach@kinectem.demo");
    const recipient = await loginAs((u) => u.email === "tyler@kinectem.demo");

    // Upload 11 real, owner-owned, confirmed assets so the only thing that
    // can reject the request is the strict per-message attachment cap.
    const assetIds: string[] = [];
    for (let i = 0; i < 11; i++) {
      assetIds.push(await uploadImage(sender.agent, `cap-${i}.png`));
    }

    const res = await sender.agent.post("/api/v1/conversations").send({
      recipientType: "user",
      recipientId: recipient.user.id,
      message: { body: "too many", assetIds },
    });
    expect(res.status).toBe(400);
    expect(String(res.body?.error ?? "")).toMatch(/10/);
  });

  it("rejects more than 10 attachments when sending into an existing conversation", async () => {
    const sender = await loginAs((u) => u.email === "coach@kinectem.demo");
    const recipient = await loginAs((u) => u.email === "chris@kinectem.demo");

    // Open a conversation first with a tiny single message so we have an id.
    const startAssetId = await uploadImage(sender.agent, "start.png");
    const startRes = await sender.agent.post("/api/v1/conversations").send({
      recipientType: "user",
      recipientId: recipient.user.id,
      message: { body: "kicking it off", assetIds: [startAssetId] },
    });
    expect(startRes.status).toBe(201);
    const conversationId: string = startRes.body.id;

    const assetIds: string[] = [];
    for (let i = 0; i < 11; i++) {
      assetIds.push(await uploadImage(sender.agent, `reply-cap-${i}.png`));
    }

    const res = await sender.agent
      .post(`/api/v1/conversations/${conversationId}/messages`)
      .send({ body: "too many on a reply", assetIds });
    expect(res.status).toBe(400);
    expect(String(res.body?.error ?? "")).toMatch(/10/);
  });
});
