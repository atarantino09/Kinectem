// Set a user's password directly in the DEVELOPMENT database.
//
// Used to restore access to a dev account when the reset-email flow is
// unavailable (e.g. after dev reset links pointed at production). Uses the
// exact same scrypt format as the api-server's `hashPassword()`
// (`scrypt$<salt-hex>$<derived-hex>`), so the app's `verifyPassword()`
// accepts it.
//
// SAFETY: refuses to run when NODE_ENV=production — production password
// changes must go through the real reset flow.
//
// Run from the repo root:
//   pnpm --filter @workspace/scripts run set-dev-user-password -- <email> <newPassword>
//
// Example (restore the dev admin):
//   pnpm --filter @workspace/scripts run set-dev-user-password -- atarantino@kinectem.com 'KinectemDev2026!'

import { randomBytes, scrypt as scryptCb } from "node:crypto";
import { promisify } from "node:util";
import { db, users } from "@workspace/db";
import { eq } from "drizzle-orm";

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

const KEYLEN = 64;

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, KEYLEN);
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

async function main() {
  if (process.env.NODE_ENV === "production") {
    console.error(
      "Refusing to run with NODE_ENV=production — use the real password reset flow in production.",
    );
    process.exit(1);
  }

  const [email, newPassword] = process.argv.slice(2).filter((a) => a !== "--");
  if (!email || !newPassword) {
    console.error(
      "Usage: pnpm --filter @workspace/scripts run set-dev-user-password -- <email> <newPassword>",
    );
    process.exit(1);
  }

  const normalized = email.toLowerCase();
  const [user] = await db
    .select({ id: users.id, email: users.email, role: users.role })
    .from(users)
    .where(eq(users.email, normalized))
    .limit(1);
  if (!user) {
    console.error(`No user found with email ${normalized}`);
    process.exit(1);
  }

  const passwordHash = await hashPassword(newPassword);
  await db.update(users).set({ passwordHash }).where(eq(users.id, user.id));
  console.log(`Password updated for ${user.email} (id: ${user.id}, role: ${user.role}).`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
