import { beforeEach, describe, expect, it, vi } from "vitest";
import { completeInviteAuthentication, forgetInviteAccount, hasInviteAccount, inviteAccountToken, rememberInviteAccount } from "./parent-invite-account";

const fetch = vi.hoisted(() => vi.fn());
vi.mock("@workspace/api-client-react", () => ({ customFetch: (...args: unknown[]) => fetch(...args) }));

describe("invitation account continuation", () => {
  beforeEach(() => { sessionStorage.clear(); vi.clearAllMocks(); });
  it("accepts only sanitized invitation destinations", () => {
    expect(inviteAccountToken("/invites/valid-token")).toBe("valid-token");
    for (const destination of ["https://example.test/invites/token", "//evil.test/invites/token", "/\\evil.test", "/family", "/invites/token?continue=1", "/invites/token\n"]) {
      expect(inviteAccountToken(destination)).toBeNull();
    }
  });
  it.each(["signup", "sign-in"])("records verified identity after successful %s", async () => {
    fetch.mockResolvedValue({ authenticated: true, realUser: { id: "adult-a" } });
    await completeInviteAuthentication("/invites/token", "adult-a");
    expect(hasInviteAccount("token", "adult-a")).toBe(true);
    expect(hasInviteAccount("token", "adult-b")).toBe(false);
    expect(hasInviteAccount("another-token", "adult-a")).toBe(false);
  });
  it("rejects an unresolved session rather than marking step 1 completed", async () => {
    fetch.mockResolvedValue({ authenticated: false });
    await expect(completeInviteAuthentication("/invites/token", "adult-a")).rejects.toThrow("Please sign in again");
    expect(hasInviteAccount("token", "adult-a")).toBe(false);
  });
  it("never marks continuation when authentication verification fails", async () => {
    fetch.mockRejectedValue(new Error("offline"));
    await expect(completeInviteAuthentication("/invites/token", "adult-a")).rejects.toThrow("offline");
    expect(hasInviteAccount("token", "adult-a")).toBe(false);
  });
  it("does not affect ordinary signup or family invitation paths", async () => {
    await completeInviteAuthentication("/family", "adult-a");
    await completeInviteAuthentication("/family-invites/guardian/test", "adult-a");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("expires continuation and supports explicit forgetting without clearing drafts", () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1000);
    rememberInviteAccount("token", "adult-a");
    expect(hasInviteAccount("token", "adult-a")).toBe(true);
    now.mockReturnValue(1000 + 2 * 60 * 60 * 1000);
    expect(hasInviteAccount("token", "adult-a")).toBe(false);
    now.mockRestore();
    rememberInviteAccount("token", "adult-a");
    forgetInviteAccount("token");
    expect(hasInviteAccount("token", "adult-a")).toBe(false);
  });
  it("does not attribute authentication completion to a session that changed during signup", async () => {
    fetch.mockResolvedValue({ authenticated: true, realUser: { id: "adult-b" } });
    await expect(completeInviteAuthentication("/invites/token", "adult-a")).rejects.toThrow("session could not be confirmed");
    expect(hasInviteAccount("token", "adult-b")).toBe(false);
  });
});
