import { describe, expect, it, beforeEach } from "vitest";
import {
  emptyDraft, saveDraft, loadDraft, clearDraft, planRequest, deliveryLabel,
  defaultSignupDest, DRAFT_TTL_MS, draftKey,
} from "./family-setup";

describe("family-setup", () => {
  beforeEach(() => sessionStorage.clear());
  it("round-trips drafts per user and expires them", () => {
    const d = emptyDraft();
    saveDraft("u1", "family", d);
    expect(loadDraft("u1", "family")?.requestId).toBe(d.requestId);
    expect(loadDraft("u2", "family")).toBeNull();
    expect(loadDraft("u1", "family", Date.now() + DRAFT_TTL_MS + 5000)).toBeNull();
    expect(sessionStorage.getItem(draftKey("u1", "family"))).toBeNull();
  });
  it("clears and never contains a password", () => {
    saveDraft("u1", "t", emptyDraft());
    expect(sessionStorage.getItem(draftKey("u1", "t"))).not.toMatch(/password/i);
    clearDraft("u1", "t");
    expect(loadDraft("u1", "t")).toBeNull();
  });
  it("keeps key for same name, flags changes after an attempt", () => {
    const d = { ...emptyDraft(), requestName: { firstName: "Ava", lastName: "Lee" }, attempted: true };
    expect(planRequest(d, " ava", "LEE ").kind).toBe("reuse");
    expect(planRequest(d, "Ava", "Li").kind).toBe("changed-after-attempt");
    expect(planRequest({ ...d, attempted: false }, "Ava", "Li").kind).toBe("fresh");
  });
  it("never reports delivery for false or null", () => {
    expect(deliveryLabel(true)).toBe("sent");
    expect(deliveryLabel(false)).toBe("failed");
    expect(deliveryLabel(null)).toBe("saved");
  });
  it("routes parent signups to setup unless returnTo given", () => {
    expect(defaultSignupDest("parent", null)).toBe("/family?setup=1");
    expect(defaultSignupDest("parent", "/family-invites/guardian/x")).toBeNull();
    expect(defaultSignupDest("coach", null)).toBeNull();
  });
});
