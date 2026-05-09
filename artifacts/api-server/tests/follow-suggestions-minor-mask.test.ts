// Task #421 — Dedicated regression coverage for the People-to-follow
// card surface. The /follow-suggestions endpoint already drops minor
// rows for non-privileged viewers via filterOutMinors, so a stranger
// can never naturally surface a minor through the e2e seam. This file
// proves the new defense-in-depth layer (the minorNameCtx flowing
// through toPublicUser) at the projection level: a minor row that
// somehow reaches the projector for a non-privileged viewer renders
// with a first-initial last name; a privileged viewer (linked
// guardian, self, admin, shared-roster teammate) keeps the full name.
//
// The companion e2e file (`minor-name-mask-e2e.test.ts`) exercises
// the live HTTP path for the linked-guardian case (deterministic
// child-in-suggestions assertion) and asserts the stranger case
// returns no leak — together this proves both layers.

import { describe, expect, it } from "vitest";
import { toPublicUser } from "../src/lib/spec-helpers";
import type { MinorNameViewerContext } from "../src/lib/spec-helpers";

type UserShape = Parameters<typeof toPublicUser>[0];

function makeUser(overrides: Partial<UserShape> = {}): UserShape {
  const now = new Date("2025-01-01T00:00:00.000Z");
  return {
    id: "u-samira",
    name: "Samira Carter",
    email: "samira@example.com",
    bio: null,
    website: null,
    city: null,
    state: null,
    avatarUrl: null,
    isMinor: true,
    role: "athlete",
    accountStatus: "active",
    parentId: "u-lisa",
    createdAt: now,
    profileVisibility: "followers",
    dateOfBirth: null,
    // Cast: the runtime helper only reads the fields above, so any
    // remaining columns on UserRow can be safely defaulted by the
    // partial spread; ts will accept the cast at the call site.
    ...overrides,
  } as UserShape;
}

const STRANGER_CTX: MinorNameViewerContext = {
  viewerId: "u-stranger",
  viewerRole: "athlete",
  privilegedTargetIds: new Set<string>(),
};

const GUARDIAN_CTX: MinorNameViewerContext = {
  viewerId: "u-lisa",
  viewerRole: "parent",
  privilegedTargetIds: new Set<string>(["u-samira"]),
};

const ADMIN_CTX: MinorNameViewerContext = {
  viewerId: "u-admin",
  viewerRole: "admin",
  privilegedTargetIds: new Set<string>(),
  bypass: true,
};

describe("Task #421 — toPublicUser minorNameCtx (People to follow)", () => {
  it("masks the minor's last name to a first initial for a stranger viewer", () => {
    const out = toPublicUser(makeUser(), { minorNameCtx: STRANGER_CTX });
    expect(out.firstName).toBe("Samira");
    expect(out.lastName).toBe("C.");
    // Defense in depth: the full surname must NOT appear anywhere in
    // the projected payload (catches a regression where a future
    // field on the public user accidentally re-exports `u.name`).
    expect(JSON.stringify(out)).not.toContain("Carter");
  });

  it("preserves the full surname for the linked guardian", () => {
    const out = toPublicUser(makeUser(), { minorNameCtx: GUARDIAN_CTX });
    expect(out.firstName).toBe("Samira");
    expect(out.lastName).toBe("Carter");
  });

  it("preserves the full surname for the minor herself", () => {
    const out = toPublicUser(makeUser(), {
      minorNameCtx: {
        viewerId: "u-samira",
        viewerRole: "athlete",
        privilegedTargetIds: new Set<string>(),
      },
    });
    expect(out.lastName).toBe("Carter");
  });

  it("preserves the full surname for a platform admin (bypass)", () => {
    const out = toPublicUser(makeUser(), { minorNameCtx: ADMIN_CTX });
    expect(out.lastName).toBe("Carter");
  });

  it("preserves the full surname for a shared-roster teammate", () => {
    const out = toPublicUser(makeUser(), {
      minorNameCtx: {
        viewerId: "u-daniela",
        viewerRole: "athlete",
        privilegedTargetIds: new Set<string>(["u-samira"]),
      },
    });
    expect(out.lastName).toBe("Carter");
  });

  it("never masks an adult target, even with a stranger context", () => {
    const out = toPublicUser(makeUser({ isMinor: false, name: "Marcus Lee" }), {
      minorNameCtx: STRANGER_CTX,
    });
    expect(out.firstName).toBe("Marcus");
    expect(out.lastName).toBe("Lee");
  });

  it("preserves legacy full-name behavior when no minorNameCtx is supplied", () => {
    // Surfaces that haven't been audited (e.g. the user's own profile
    // resource where the carve-out applies) call toPublicUser without
    // the ctx and must continue to receive the full name.
    const out = toPublicUser(makeUser());
    expect(out.lastName).toBe("Carter");
  });
});
