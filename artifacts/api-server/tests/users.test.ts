import { describe, expect, it } from "vitest";
import type { Agent } from "supertest";
import { app, loginAs, request } from "./helpers";

const ADMIN_EMAIL = "andrew@kinectem.com";
const PARENT_EMAIL = "lisa@kinectem.demo";
const CHILD_EMAIL = "samira@kinectem.demo";
const STRANGER_EMAIL = "marcus@kinectem.demo";

async function uploadAsset(
  agent: Agent,
  fileName = "avatar.png",
  fileType = "image/png",
): Promise<string> {
  const upload = await agent.post("/api/v1/assets/upload").send({
    fileName,
    fileType,
    fileSize: 4,
  });
  if (upload.status !== 201) {
    throw new Error(
      `assets/upload failed: ${upload.status} ${upload.text}`,
    );
  }
  const assetId = upload.body.assetId as string;
  const put = await agent
    .put(`/api/v1/assets/${assetId}/data`)
    .set("Content-Type", fileType)
    .send(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  if (put.status !== 204) {
    throw new Error(`PUT asset data failed: ${put.status} ${put.text}`);
  }
  const confirm = await agent.post(`/api/v1/assets/${assetId}/confirm`);
  if (confirm.status !== 200) {
    throw new Error(
      `assets/confirm failed: ${confirm.status} ${confirm.text}`,
    );
  }
  return confirm.body.url as string;
}

describe("users routes — parent ↔ child permissions", () => {
  describe("GET /users/:userId elevation for linked parent", () => {
    it("returns Private response (with parentId) but isOwnProfile:false for the linked parent", async () => {
      const { agent: parent } = await loginAs((u) => u.email === PARENT_EMAIL);
      const { user: child } = await loginAs((u) => u.email === CHILD_EMAIL);

      const res = await parent.get(`/api/v1/users/${child.id}`);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(child.id);
      // Private fields are present
      expect(res.body).toHaveProperty("parentId");
      expect(res.body).toHaveProperty("email");
      expect(res.body).toHaveProperty("role");
      expect(res.body).toHaveProperty("dateOfBirth");
      // parentId points back at the linked parent
      const { user: parentUser } = await loginAs(
        (u) => u.email === PARENT_EMAIL,
      );
      expect(res.body.parentId).toBe(parentUser.id);
      // …but the response must NOT claim the parent owns the profile
      expect(res.body.isOwnProfile).toBe(false);
    });

    it("returns Private response with isOwnProfile:true when the child views themselves", async () => {
      const { agent: child, user: childUser } = await loginAs(
        (u) => u.email === CHILD_EMAIL,
      );
      const res = await child.get(`/api/v1/users/${childUser.id}`);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(childUser.id);
      expect(res.body).toHaveProperty("parentId");
      expect(res.body).toHaveProperty("email");
      expect(res.body.isOwnProfile).toBe(true);
    });

    it("returns Public response (no parentId/email) for a stranger", async () => {
      const { agent: stranger } = await loginAs(
        (u) => u.email === STRANGER_EMAIL,
      );
      const { user: child } = await loginAs((u) => u.email === CHILD_EMAIL);

      const res = await stranger.get(`/api/v1/users/${child.id}`);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(child.id);
      expect(res.body.isOwnProfile).toBe(false);
      // PublicUserResponse does not include these private fields
      expect(res.body).not.toHaveProperty("parentId");
      expect(res.body).not.toHaveProperty("email");
      expect(res.body).not.toHaveProperty("role");
      expect(res.body).not.toHaveProperty("dateOfBirth");
    });
  });

  describe("PATCH /users/:userId permission ladder", () => {
    it("lets the linked parent edit their child", async () => {
      const { agent: parent } = await loginAs((u) => u.email === PARENT_EMAIL);
      const { user: child } = await loginAs((u) => u.email === CHILD_EMAIL);

      const res = await parent
        .patch(`/api/v1/users/${child.id}`)
        .send({ bio: "Updated by parent" });
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(child.id);
      expect(res.body.bio).toBe("Updated by parent");
      // Parent is not the owner of the profile they just patched.
      expect(res.body.isOwnProfile).toBe(false);
    });

    it("lets the child edit themselves (isOwnProfile stays true)", async () => {
      const { agent: child, user: childUser } = await loginAs(
        (u) => u.email === CHILD_EMAIL,
      );
      const res = await child
        .patch(`/api/v1/users/${childUser.id}`)
        .send({ bio: "Updated by child" });
      expect(res.status).toBe(200);
      expect(res.body.bio).toBe("Updated by child");
      expect(res.body.isOwnProfile).toBe(true);
    });

    it("lets a real (non-masquerading) admin edit anyone", async () => {
      const { agent: admin } = await loginAs((u) => u.email === ADMIN_EMAIL);
      const { user: child } = await loginAs((u) => u.email === CHILD_EMAIL);

      const res = await admin
        .patch(`/api/v1/users/${child.id}`)
        .send({ bio: "Updated by admin" });
      expect(res.status).toBe(200);
      expect(res.body.bio).toBe("Updated by admin");
      // Admin is not the owner either.
      expect(res.body.isOwnProfile).toBe(false);
    });

    it("rejects a masquerading admin (real-account-only check)", async () => {
      const { agent: admin } = await loginAs((u) => u.email === ADMIN_EMAIL);
      const { user: stranger } = await loginAs(
        (u) => u.email === STRANGER_EMAIL,
      );
      const { user: child } = await loginAs((u) => u.email === CHILD_EMAIL);

      // Admin masquerades as a stranger (no parent link to the child).
      const start = await admin.post(
        `/api/v1/admin/masquerade/${stranger.id}/start`,
      );
      expect(start.status).toBe(200);

      const res = await admin
        .patch(`/api/v1/users/${child.id}`)
        .send({ bio: "Should not stick" });
      expect(res.status).toBe(403);
    });

    it("rejects a masquerading parent (parent power requires the real account)", async () => {
      const { agent: admin } = await loginAs((u) => u.email === ADMIN_EMAIL);
      const { user: parent } = await loginAs(
        (u) => u.email === PARENT_EMAIL,
      );
      const { user: child } = await loginAs((u) => u.email === CHILD_EMAIL);

      // Admin masquerades as the linked parent — the parent-edit power must
      // not transfer to a masqueraded session.
      const start = await admin.post(
        `/api/v1/admin/masquerade/${parent.id}/start`,
      );
      expect(start.status).toBe(200);

      const res = await admin
        .patch(`/api/v1/users/${child.id}`)
        .send({ bio: "Should not stick" });
      expect(res.status).toBe(403);
    });

    it("rejects a stranger trying to edit someone else", async () => {
      const { agent: stranger } = await loginAs(
        (u) => u.email === STRANGER_EMAIL,
      );
      const { user: child } = await loginAs((u) => u.email === CHILD_EMAIL);

      const res = await stranger
        .patch(`/api/v1/users/${child.id}`)
        .send({ bio: "Nope" });
      expect(res.status).toBe(403);
    });

    it("rejects unauthenticated PATCH requests", async () => {
      const { user: child } = await loginAs((u) => u.email === CHILD_EMAIL);
      const res = await request(app)
        .patch(`/api/v1/users/${child.id}`)
        .send({ bio: "Nope" });
      expect(res.status).toBe(401);
    });
  });

  describe("Soft-deleted child", () => {
    it("returns 404 for the linked parent and still works for a real admin", async () => {
      const { agent: admin } = await loginAs((u) => u.email === ADMIN_EMAIL);
      const { agent: parent } = await loginAs((u) => u.email === PARENT_EMAIL);
      const { user: child } = await loginAs((u) => u.email === CHILD_EMAIL);

      // Admin soft-deletes the child.
      const del = await admin.delete(`/api/v1/admin/users/${child.id}`);
      expect(del.status).toBe(200);

      // Parent (a non-admin) gets the same 404 GET returns for soft-deleted
      // users — the linked-parent power must not bypass the soft-delete gate.
      const parentPatch = await parent
        .patch(`/api/v1/users/${child.id}`)
        .send({ bio: "Should be hidden" });
      expect(parentPatch.status).toBe(404);

      // Real admin can still patch (admin sees soft-deleted rows).
      const adminPatch = await admin
        .patch(`/api/v1/users/${child.id}`)
        .send({ bio: "Admin can still touch this" });
      expect(adminPatch.status).toBe(200);
      expect(adminPatch.body.bio).toBe("Admin can still touch this");
    });
  });

  describe("avatarUrl asset-ownership check", () => {
    it("lets the parent set an avatar URL backed by an asset they own", async () => {
      const { agent: parent } = await loginAs((u) => u.email === PARENT_EMAIL);
      const { user: child } = await loginAs((u) => u.email === CHILD_EMAIL);

      const ownAssetUrl = await uploadAsset(parent);
      const res = await parent
        .patch(`/api/v1/users/${child.id}`)
        .send({ avatarUrl: ownAssetUrl });
      expect(res.status).toBe(200);
      expect(res.body.avatarUrl).toBe(ownAssetUrl);
    });

    it("rejects the parent setting an avatar URL backed by a third party's asset", async () => {
      const { agent: parent } = await loginAs((u) => u.email === PARENT_EMAIL);
      const { agent: stranger } = await loginAs(
        (u) => u.email === STRANGER_EMAIL,
      );
      const { user: child } = await loginAs((u) => u.email === CHILD_EMAIL);

      const strangerAssetUrl = await uploadAsset(stranger);
      const res = await parent
        .patch(`/api/v1/users/${child.id}`)
        .send({ avatarUrl: strangerAssetUrl });
      expect(res.status).toBe(400);
      expect(String(res.body.error ?? "")).toMatch(/avatarUrl/i);
    });
  });
});
