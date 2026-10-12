import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, users } from "@workspace/db";
import { CONSENT_NOTICE_TEXT, CONSENT_NOTICE_VERSION } from "../src/lib/coppa";
import { app, request } from "./helpers";

describe("generated account and privacy assistance", () => {
  it("uses hello throughout the canonical parental notice without changing rights", () => {
    expect(CONSENT_NOTICE_VERSION).toBe("1.1.1");
    expect(CONSENT_NOTICE_TEXT.match(/hello@kinectem\.com/g)).toHaveLength(3);
    expect(CONSENT_NOTICE_TEXT).not.toContain("privacy@");
    expect(CONSENT_NOTICE_TEXT).toContain("10 business days");
    expect(CONSENT_NOTICE_TEXT).toContain("revoke consent (which immediately disables the account)");
  });

  it("returns hello as the help destination for a disabled account", async () => {
    const email = `support-contact-${crypto.randomUUID()}@kinectem.test`;
    const password = "SupportContactTest123!";
    const signup = await request(app).post("/api/v1/auth/signup").send({
      firstName: "Support", lastName: "Test", role: "parent",
      sport: "Soccer", email, password,
    });
    expect(signup.status).toBe(201);
    try {
      await db.update(users).set({ accountStatus: "disabled" }).where(eq(users.email, email));
      const login = await request(app).post("/api/v1/auth/login").send({ email, password });
      expect(login.status).toBe(403);
      expect(login.body.error).toBe("This account has been disabled because a parent or guardian revoked consent. Contact hello@kinectem.com if you believe this is a mistake.");
      expect(login.body.accountStatus).toBe("disabled");
    } finally {
      await db.delete(users).where(eq(users.email, email));
    }
  });
});
