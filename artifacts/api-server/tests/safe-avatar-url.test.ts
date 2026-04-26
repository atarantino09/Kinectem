import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, users } from "@workspace/db";
import {
  safeAvatarUrl,
  MAX_AVATAR_DATA_URL_LENGTH,
} from "../src/lib/spec-helpers";
import { app, loginAs, request } from "./helpers";
import { classifyAvatar } from "../scripts/cleanup-bad-avatars";

describe("safeAvatarUrl()", () => {
  it("returns null for null/undefined/empty input", () => {
    expect(safeAvatarUrl(null)).toBeNull();
    expect(safeAvatarUrl(undefined)).toBeNull();
    expect(safeAvatarUrl("")).toBeNull();
  });

  it("passes through ordinary http(s) URLs untouched, regardless of length", () => {
    expect(safeAvatarUrl("https://example.com/me.png")).toBe(
      "https://example.com/me.png",
    );
    // http(s) URLs are not size-checked because the JSON payload only
    // carries the URL string, not the image bytes.
    const longHttp = "https://example.com/" + "a".repeat(MAX_AVATAR_DATA_URL_LENGTH);
    expect(safeAvatarUrl(longHttp)).toBe(longHttp);
  });

  it("passes through small data: URLs untouched", () => {
    const small = "data:image/png;base64,iVBORw0KGgo=";
    expect(safeAvatarUrl(small)).toBe(small);
  });

  it("returns null for a data: URL one byte over the cap", () => {
    const tooLong = "data:image/png;base64," + "A".repeat(MAX_AVATAR_DATA_URL_LENGTH);
    expect(tooLong.length).toBeGreaterThan(MAX_AVATAR_DATA_URL_LENGTH);
    expect(safeAvatarUrl(tooLong)).toBeNull();
  });

  it("accepts a data: URL exactly at the cap", () => {
    const atCap = "data:image/png;base64,".padEnd(MAX_AVATAR_DATA_URL_LENGTH, "A");
    expect(atCap.length).toBe(MAX_AVATAR_DATA_URL_LENGTH);
    expect(safeAvatarUrl(atCap)).toBe(atCap);
  });
});

describe("cleanup-bad-avatars classifyAvatar()", () => {
  it("flags an oversized data URL as 'oversize'", () => {
    const tooLong = "data:image/png;base64," + "A".repeat(MAX_AVATAR_DATA_URL_LENGTH);
    expect(classifyAvatar(tooLong)).toMatchObject({ kind: "oversize" });
  });

  it("flags a corrupt PNG (valid IHDR, undecodable IDAT) as 'corrupt'", () => {
    // 1x1 PNG header with deliberately garbage IDAT bytes. IHDR parses,
    // inflate() fails — this is exactly the marcus@kinectem.demo
    // failure mode that produced blank avatars in the live app.
    const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    // IHDR chunk: length=13, type='IHDR', data=13B describing 1x1 RGBA, CRC
    const ihdrLen = Buffer.from([0, 0, 0, 13]);
    const ihdrType = Buffer.from("IHDR", "ascii");
    const ihdrData = Buffer.from([
      0, 0, 0, 1, // width
      0, 0, 0, 1, // height
      8, 6, 0, 0, 0, // bit depth, color type, compression, filter, interlace
    ]);
    const ihdrCrc = Buffer.from([0, 0, 0, 0]);
    // IDAT chunk filled with garbage that won't inflate
    const idatLen = Buffer.from([0, 0, 0, 8]);
    const idatType = Buffer.from("IDAT", "ascii");
    const idatData = Buffer.from([0xde, 0xad, 0xbe, 0xef, 0xde, 0xad, 0xbe, 0xef]);
    const idatCrc = Buffer.from([0, 0, 0, 0]);
    // IEND
    const iendLen = Buffer.from([0, 0, 0, 0]);
    const iendType = Buffer.from("IEND", "ascii");
    const iendCrc = Buffer.from([0, 0, 0, 0]);
    const corruptPng = Buffer.concat([
      sig,
      ihdrLen, ihdrType, ihdrData, ihdrCrc,
      idatLen, idatType, idatData, idatCrc,
      iendLen, iendType, iendCrc,
    ]);
    const dataUrl = `data:image/png;base64,${corruptPng.toString("base64")}`;
    expect(classifyAvatar(dataUrl)).toMatchObject({ kind: "corrupt" });
  });

  it("keeps a valid 1x1 PNG", () => {
    // The smallest valid PNG with a real (inflatable) IDAT.
    const validTinyPng = Buffer.from(
      "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082",
      "hex",
    );
    const dataUrl = `data:image/png;base64,${validTinyPng.toString("base64")}`;
    expect(classifyAvatar(dataUrl)).toBeNull();
  });
});

describe("oversized avatar URL is filtered to null at egress", () => {
  it("GET /users/:userId returns avatarUrl: null even if the DB row holds a giant data URL", async () => {
    const { agent, user } = await loginAs((u) => u.role === "athlete");

    // Plant a row that's well over the cap *directly* in the database,
    // bypassing the PATCH endpoint's validation. This simulates a future
    // migration or import that re-introduces oversize rows. The egress
    // guard must still null it out so the client never sees a giant
    // data URL fanned out across list responses.
    const oversize = "data:image/png;base64," + "A".repeat(MAX_AVATAR_DATA_URL_LENGTH);
    await db.update(users).set({ avatarUrl: oversize }).where(eq(users.id, user.id));

    try {
      const res = await agent.get(`/api/v1/users/${user.id}`);
      expect(res.status).toBe(200);
      expect(res.body.avatarUrl).toBeNull();
    } finally {
      // Restore so we don't poison other tests that share this seed user.
      await db
        .update(users)
        .set({ avatarUrl: user.avatarUrl })
        .where(eq(users.id, user.id));
    }
  });

  it("PATCH /users/:userId rejects an avatarUrl over the new cap with 400", async () => {
    const { agent, user } = await loginAs((u) => u.email === "marcus@kinectem.demo");
    const tooLong = "data:image/png;base64," + "A".repeat(MAX_AVATAR_DATA_URL_LENGTH);
    expect(tooLong.length).toBeGreaterThan(MAX_AVATAR_DATA_URL_LENGTH);

    const res = await agent
      .patch(`/api/v1/users/${user.id}`)
      .send({ avatarUrl: tooLong });
    expect(res.status).toBe(400);
    expect(String(res.body?.error ?? "")).toMatch(/avatarUrl is too long/i);
  });
});
