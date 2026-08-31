import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { articles, assets, db, teams, users } from "@workspace/db";
import { app, loginAs, request } from "./helpers";

const MAX_BYTES = 10 * 1024 * 1024;
const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082",
  "hex",
);

function bmff(brand: "isom" | "qt  "): Buffer {
  return Buffer.concat([
    Buffer.from([0, 0, 0, 24]),
    Buffer.from("ftyp", "ascii"),
    Buffer.from(brand, "ascii"),
    Buffer.alloc(4),
    Buffer.from(brand === "isom" ? "mp42" : "qt  ", "ascii"),
  ]);
}

async function publishedRecapId(): Promise<string> {
  const [recap] = await db
    .select({ id: articles.id })
    .from(articles)
    .where(eq(articles.status, "published"))
    .limit(1);
  return `article-${recap.id}`;
}

async function uploadAndConfirm(
  agent: ReturnType<typeof request.agent>,
  bytes: Buffer,
  fileType: string,
  fileName: string,
): Promise<string> {
  const start = await agent.post("/api/v1/assets/upload").send({
    fileName,
    fileType,
    fileSize: bytes.length,
  });
  expect(start.status).toBe(201);
  const url = new URL(start.body.uploadUrl as string);
  const put = await agent
    .put(`${url.pathname}${url.search}`)
    .set("Content-Type", fileType)
    .send(bytes);
  expect(put.status).toBe(204);
  const confirm = await agent.post(
    `/api/v1/assets/${start.body.assetId as string}/confirm`,
  );
  expect(confirm.status).toBe(200);
  return start.body.assetId as string;
}

async function insertConfirmedAsset(
  ownerId: string,
  fileType: string,
  bytes: Buffer,
  fileSize = bytes.length,
): Promise<string> {
  const [asset] = await db
    .insert(assets)
    .values({
      ownerId,
      fileName: "album-media",
      fileType,
      fileSize,
      status: "confirmed",
      url: `data:${fileType};base64,${bytes.toString("base64")}`,
    })
    .returning({ id: assets.id });
  return asset.id;
}

describe("game album photo-and-video media", () => {
  it.each([
    ["video/mp4", "clip.mp4", bmff("isom")],
    ["video/quicktime", "clip.mov", bmff("qt  ")],
  ])("uploads, attaches, and lists %s with its confirmed MIME type", async (fileType, fileName, bytes) => {
    const { agent } = await loginAs((u) => u.email === "coach@kinectem.demo");
    const postId = await publishedRecapId();
    const assetId = await uploadAndConfirm(agent, bytes, fileType, fileName);

    const created = await agent.post(`/api/v1/posts/${postId}/album`).send({
      assetId,
      uploaderName: "Coach Mike",
      caption: "Fourth-quarter clip",
    });
    expect(created.status).toBe(201);
    expect(created.body.fileType).toBe(fileType);

    const listed = await agent.get(`/api/v1/posts/${postId}/album`);
    expect(listed.status).toBe(200);
    expect(listed.body.data[0]).toMatchObject({
      assetId,
      fileType,
      uploaderName: "Coach Mike",
      caption: "Fourth-quarter clip",
    });
  });

  it("keeps the existing PNG photo path working", async () => {
    const { agent } = await loginAs((u) => u.email === "coach@kinectem.demo");
    const postId = await publishedRecapId();
    const assetId = await uploadAndConfirm(agent, PNG, "image/png", "photo.png");
    const created = await agent.post(`/api/v1/posts/${postId}/album`).send({
      assetId,
      uploaderName: "Coach",
      caption: "",
    });
    expect(created.status).toBe(201);
    expect(created.body.fileType).toBe("image/png");
  });

  it("rejects unsupported and MIME-spoofed confirmed assets", async () => {
    const coach = await loginAs((u) => u.email === "coach@kinectem.demo");
    const postId = await publishedRecapId();
    const unsupported = await insertConfirmedAsset(
      coach.user.id,
      "video/x-msvideo",
      Buffer.from("RIFFnot-a-supported-video"),
    );
    const unsupportedRes = await coach.agent
      .post(`/api/v1/posts/${postId}/album`)
      .send({ assetId: unsupported, uploaderName: "Coach", caption: "" });
    expect(unsupportedRes.status).toBe(400);
    expect(unsupportedRes.body.code).toBe("ALBUM_UNSUPPORTED_FORMAT");

    const spoofed = await insertConfirmedAsset(
      coach.user.id,
      "video/mp4",
      PNG,
    );
    const spoofedRes = await coach.agent
      .post(`/api/v1/posts/${postId}/album`)
      .send({ assetId: spoofed, uploaderName: "Coach", caption: "" });
    expect(spoofedRes.status).toBe(400);
    expect(spoofedRes.body.code).toBe("ALBUM_ASSET_MISMATCH");
  });

  it("enforces the 10 MB boundary in the asset contract and album attachment", async () => {
    const coach = await loginAs((u) => u.email === "coach@kinectem.demo");
    const atLimit = await coach.agent.post("/api/v1/assets/upload").send({
      fileName: "limit.mp4",
      fileType: "video/mp4",
      fileSize: MAX_BYTES,
    });
    expect(atLimit.status).toBe(201);
    const overLimit = await coach.agent.post("/api/v1/assets/upload").send({
      fileName: "over.mp4",
      fileType: "video/mp4",
      fileSize: MAX_BYTES + 1,
    });
    expect(overLimit.status).toBe(400);

    const oversized = await insertConfirmedAsset(
      coach.user.id,
      "video/mp4",
      bmff("isom"),
      MAX_BYTES + 1,
    );
    const attach = await coach.agent
      .post(`/api/v1/posts/${await publishedRecapId()}/album`)
      .send({ assetId: oversized, uploaderName: "Coach", caption: "" });
    expect(attach.status).toBe(413);
    expect(attach.body.code).toBe("ALBUM_FILE_TOO_LARGE");
  });

  it("preserves ownership and team-community contribution permissions", async () => {
    const coach = await loginAs((u) => u.email === "coach@kinectem.demo");
    const outsider = await loginAs((u) => u.email === "lisa@kinectem.demo");
    const postId = await publishedRecapId();

    const outsidersAsset = await insertConfirmedAsset(
      outsider.user.id,
      "video/mp4",
      bmff("isom"),
    );
    const wrongOwner = await coach.agent
      .post(`/api/v1/posts/${postId}/album`)
      .send({ assetId: outsidersAsset, uploaderName: "Coach", caption: "" });
    expect(wrongOwner.status).toBe(403);

    const membersOnly = await outsider.agent
      .post(`/api/v1/posts/${postId}/album`)
      .send({ assetId: outsidersAsset, uploaderName: "Lisa", caption: "" });
    expect(membersOnly.status).toBe(403);
    expect(membersOnly.body.code).toBe("ALBUM_MEMBERS_ONLY");
  });

  it("keeps under-13 accounts limited to JPEG/PNG photos", async () => {
    await db
      .update(users)
      .set({ isMinor: true })
      .where(eq(users.email, "samira@kinectem.demo"));
    const minor = await loginAs((u) => u.email === "samira@kinectem.demo");
    const [team] = await db.select({ id: teams.id }).from(teams).limit(1);
    const [recap] = await db
      .insert(articles)
      .values({
        teamId: team.id,
        authorId: minor.user.id,
        title: "Minor-authored recap",
        body: "Game recap",
        status: "published",
        publishedAt: new Date(),
      })
      .returning({ id: articles.id });
    const videoAsset = await insertConfirmedAsset(
      minor.user.id,
      "video/mp4",
      bmff("isom"),
    );
    const denied = await minor.agent
      .post(`/api/v1/posts/article-${recap.id}/album`)
      .send({ assetId: videoAsset, uploaderName: "Samira", caption: "" });
    expect(denied.status).toBe(400);
    expect(denied.body).toMatchObject({
      code: "MINOR_BLOCKED",
      minorBlocked: true,
    });
  });
});