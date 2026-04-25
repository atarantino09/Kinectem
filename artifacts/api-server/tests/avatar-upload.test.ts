import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, assets } from "@workspace/db";
import { app, loginAs, request } from "./helpers";

// Mirrors the constants in src/routes/spec.ts. These are duplicated (not
// imported) because the production constants are not exported, so if the
// real cap is ever bumped, this copy must be updated to match.
const ASSET_MAX_BYTES = 10 * 1024 * 1024;
const MAX_AVATAR_URL_LENGTH = Math.ceil(ASSET_MAX_BYTES / 3) * 4 + 64;

const TINY_PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082",
  "hex",
);

async function uploadAndConfirmTinyImage(
  agent: ReturnType<typeof request.agent>,
  fileName = "avatar.png",
): Promise<{ assetId: string; url: string }> {
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

  const url = new URL(uploadUrl);
  const putRes = await agent
    .put(`${url.pathname}${url.search}`)
    .set("Content-Type", "image/png")
    .send(TINY_PNG);
  expect(putRes.status).toBe(204);

  const confirmRes = await agent.post(`/api/v1/assets/${assetId}/confirm`);
  expect(confirmRes.status).toBe(200);
  expect(confirmRes.body.status).toBe("confirmed");
  expect(confirmRes.body.url).toBeTruthy();

  return { assetId, url: confirmRes.body.url as string };
}

describe("profile avatar upload + PATCH /users/:userId", () => {
  it("happy path: upload, confirm, then PATCH avatarUrl persists the new avatar", async () => {
    const { agent, user } = await loginAs((u) => u.role === "athlete");
    const { url: assetUrl } = await uploadAndConfirmTinyImage(agent);

    const patch = await agent
      .patch(`/api/v1/users/${user.id}`)
      .send({ avatarUrl: assetUrl });
    expect(patch.status).toBe(200);
    expect(patch.body.id).toBe(user.id);
    expect(patch.body.avatarUrl).toBe(assetUrl);

    const me = await agent.get("/api/v1/users/me");
    expect(me.status).toBe(200);
    expect(me.body.avatarUrl).toBe(assetUrl);
  });

  it("accepts an avatarUrl whose length is exactly at the computed cap", async () => {
    const { agent, user } = await loginAs((u) => u.email === "coach@kinectem.demo");
    const { assetId } = await uploadAndConfirmTinyImage(agent, "boundary-ok.png");

    // Force the asset's stored URL to a string at exactly the cap so we can
    // exercise the boundary without needing a real 10 MB upload.
    const atCap = "data:image/png;base64,".padEnd(MAX_AVATAR_URL_LENGTH, "A");
    expect(atCap.length).toBe(MAX_AVATAR_URL_LENGTH);
    await db.update(assets).set({ url: atCap }).where(eq(assets.id, assetId));

    const patch = await agent
      .patch(`/api/v1/users/${user.id}`)
      .send({ avatarUrl: atCap });
    expect(patch.status).toBe(200);
    expect(patch.body.avatarUrl).toBe(atCap);
  });

  it("rejects an avatarUrl one character past the cap with 400 'avatarUrl is too long'", async () => {
    const { agent, user } = await loginAs((u) => u.email === "coach@kinectem.demo");
    const tooLong = "data:image/png;base64,".padEnd(MAX_AVATAR_URL_LENGTH + 1, "A");
    expect(tooLong.length).toBe(MAX_AVATAR_URL_LENGTH + 1);

    const patch = await agent
      .patch(`/api/v1/users/${user.id}`)
      .send({ avatarUrl: tooLong });
    expect(patch.status).toBe(400);
    expect(String(patch.body?.error ?? "")).toMatch(/avatarUrl is too long/i);
  });

  it("rejects an arbitrary external URL that does not reference a confirmed owned asset", async () => {
    const { agent, user } = await loginAs((u) => u.role === "athlete");

    const patch = await agent
      .patch(`/api/v1/users/${user.id}`)
      .send({ avatarUrl: "https://evil.example.com/photo.png" });
    expect(patch.status).toBe(400);
    expect(String(patch.body?.error ?? "")).toMatch(
      /avatarUrl must reference a confirmed asset you uploaded/i,
    );
  });

  it("PATCH with avatarUrl: null clears the user's avatar", async () => {
    const { agent, user } = await loginAs((u) => u.email === "marcus@kinectem.demo");

    // First set an avatar so the clear is observable.
    const { url: assetUrl } = await uploadAndConfirmTinyImage(agent, "to-clear.png");
    const set = await agent
      .patch(`/api/v1/users/${user.id}`)
      .send({ avatarUrl: assetUrl });
    expect(set.status).toBe(200);
    expect(set.body.avatarUrl).toBe(assetUrl);

    const cleared = await agent
      .patch(`/api/v1/users/${user.id}`)
      .send({ avatarUrl: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.avatarUrl).toBeNull();

    const me = await agent.get("/api/v1/users/me");
    expect(me.status).toBe(200);
    expect(me.body.avatarUrl).toBeNull();
  });
});
