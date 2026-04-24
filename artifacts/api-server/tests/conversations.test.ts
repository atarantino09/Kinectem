import { describe, expect, it } from "vitest";
import { app, loginAs, request } from "./helpers";

async function getMessages(agent: ReturnType<typeof request.agent>, convId: string) {
  const res = await agent.get(`/api/v1/conversations/${convId}/messages`);
  expect(res.status).toBe(200);
  return res.body.data as Array<{ id: string; body?: string }>;
}

describe("POST /conversations", () => {
  it("creates a new conversation with a first message and returns 201", async () => {
    const { agent } = await loginAs((u) => u.email === "marcus@kinectem.demo");
    const { user: sam } = await loginAs((u) => u.email === "sam@kinectem.demo");

    const res = await agent.post("/api/v1/conversations").send({
      recipientId: sam.id,
      recipientType: "user",
      message: { body: "hello sam" },
    });

    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.participant.id).toBe(sam.id);
    expect(res.body.lastMessage).toBeDefined();
    expect(res.body.lastMessage.bodyPreview).toBe("hello sam");

    const msgs = await getMessages(agent, res.body.id);
    expect(msgs.length).toBe(1);
    expect(msgs[0].body).toBe("hello sam");
  });

  it("creates a new conversation without a message and returns 201 with no messages persisted", async () => {
    const { agent } = await loginAs((u) => u.email === "marcus@kinectem.demo");
    const { user: sam } = await loginAs((u) => u.email === "sam@kinectem.demo");

    const res = await agent.post("/api/v1/conversations").send({
      recipientId: sam.id,
      recipientType: "user",
    });

    expect(res.status).toBe(201);
    expect(res.body.lastMessage).toBeUndefined();

    const msgs = await getMessages(agent, res.body.id);
    expect(msgs.length).toBe(0);
  });

  it("resumes an existing conversation, persists the new first message, and returns 200", async () => {
    const { agent } = await loginAs((u) => u.email === "marcus@kinectem.demo");
    const { user: sam } = await loginAs((u) => u.email === "sam@kinectem.demo");

    const first = await agent.post("/api/v1/conversations").send({
      recipientId: sam.id,
      recipientType: "user",
    });
    expect(first.status).toBe(201);
    const convId: string = first.body.id;

    const second = await agent.post("/api/v1/conversations").send({
      recipientId: sam.id,
      recipientType: "user",
      message: { body: "follow-up message" },
    });

    expect(second.status).toBe(200);
    expect(second.body.id).toBe(convId);
    expect(second.body.lastMessage).toBeDefined();
    expect(second.body.lastMessage.bodyPreview).toBe("follow-up message");

    const msgs = await getMessages(agent, convId);
    expect(msgs.length).toBe(1);
    expect(msgs[0].body).toBe("follow-up message");
  });

  it("resumes an existing conversation without a message, leaving messages untouched, and returns 200", async () => {
    const { agent } = await loginAs((u) => u.email === "marcus@kinectem.demo");
    const { user: sam } = await loginAs((u) => u.email === "sam@kinectem.demo");

    const first = await agent.post("/api/v1/conversations").send({
      recipientId: sam.id,
      recipientType: "user",
      message: { body: "initial" },
    });
    expect(first.status).toBe(201);
    const convId: string = first.body.id;

    const second = await agent.post("/api/v1/conversations").send({
      recipientId: sam.id,
      recipientType: "user",
    });

    expect(second.status).toBe(200);
    expect(second.body.id).toBe(convId);

    const msgs = await getMessages(agent, convId);
    expect(msgs.length).toBe(1);
    expect(msgs[0].body).toBe("initial");
  });
});

describe("GET /conversations/search/contacts", () => {
  it("is reachable and not shadowed by /conversations/:id", async () => {
    const { agent } = await loginAs((u) => u.email === "marcus@kinectem.demo");

    const res = await agent.get("/api/v1/conversations/search/contacts").query({ q: "sam" });

    // Critically: this must NOT be a 404 from the /:id handler treating
    // "search" as a conversation id, nor a 403 (not a participant).
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    const names = res.body.data.map((c: { displayName: string }) => c.displayName);
    expect(names.some((n: string) => /sam/i.test(n))).toBe(true);
    expect(res.body.data[0]).toHaveProperty("id");
    expect(res.body.data[0]).toHaveProperty("displayName");
    expect(res.body.data[0]).toHaveProperty("avatarUrl");
  });

  it("requires the q query parameter", async () => {
    const { agent } = await loginAs((u) => u.email === "marcus@kinectem.demo");
    const res = await agent.get("/api/v1/conversations/search/contacts");
    expect(res.status).toBe(400);
  });

  it("requires authentication", async () => {
    const res = await request(app)
      .get("/api/v1/conversations/search/contacts")
      .query({ q: "sam" });
    expect(res.status).toBe(401);
  });
});
