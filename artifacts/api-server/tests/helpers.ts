import request, { type Agent } from "supertest";
import app from "../src/app";
import { DEMO_PASSWORD } from "../src/lib/seed";

export type SeedUser = {
  id: string;
  firstName: string;
  lastName: string;
  role: "athlete" | "coach" | "admin" | "parent";
  email: string | null;
  avatarUrl: string | null;
  sport: string | null;
  position: string | null;
};

export async function listSeedUsers(): Promise<SeedUser[]> {
  const res = await request(app).get("/api/v1/auth/users");
  if (res.status !== 200) {
    throw new Error(`Failed to list seed users: ${res.status} ${res.text}`);
  }
  return res.body as SeedUser[];
}

export async function findUser(
  match: (u: SeedUser) => boolean,
): Promise<SeedUser> {
  const users = await listSeedUsers();
  const u = users.find(match);
  if (!u) throw new Error("No matching seed user found");
  return u;
}

export async function loginAs(
  match: ((u: SeedUser) => boolean) | string,
): Promise<{ agent: Agent; user: SeedUser }> {
  const matcher =
    typeof match === "function"
      ? match
      : (u: SeedUser) => u.email === match || u.id === match;
  const user = await findUser(matcher);
  if (!user.email) {
    throw new Error(`Seed user ${user.id} has no email; cannot log in.`);
  }
  const agent = request.agent(app);
  const res = await agent
    .post("/api/v1/auth/login")
    .send({ email: user.email, password: DEMO_PASSWORD });
  if (res.status !== 200) {
    throw new Error(`Login failed: ${res.status} ${res.text}`);
  }
  return { agent, user };
}

export { request, app, DEMO_PASSWORD };
