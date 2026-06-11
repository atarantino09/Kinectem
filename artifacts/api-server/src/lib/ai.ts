import Anthropic from "@anthropic-ai/sdk";
import { db, aiProviderKeys } from "@workspace/db";
import { eq } from "drizzle-orm";
import { decryptSecret } from "./secret-crypto";

// Sensible default when an admin hasn't pinned a specific model. The admin
// can override this per provider from /admin/ai-keys.
export const DEFAULT_ANTHROPIC_MODEL = "claude-3-5-sonnet-latest";

// Thrown when no Anthropic key has been configured by an admin yet. Routes
// translate this into a 503 with a friendly "ask an admin" message.
export class AiNotConfiguredError extends Error {
  constructor() {
    super("AI is not configured yet. An admin must add an Anthropic API key.");
    this.name = "AiNotConfiguredError";
  }
}

async function getAnthropicConfig(): Promise<{ apiKey: string; model: string }> {
  const [row] = await db
    .select()
    .from(aiProviderKeys)
    .where(eq(aiProviderKeys.provider, "anthropic"))
    .limit(1);
  if (!row) throw new AiNotConfiguredError();
  return {
    apiKey: decryptSecret(row.keyCiphertext),
    model: row.model || DEFAULT_ANTHROPIC_MODEL,
  };
}

export type AssistMode = "draft" | "polish";
export type AssistPostType = "short" | "long";

export interface AssistInput {
  mode: AssistMode;
  postType: AssistPostType;
  notes?: string;
  body?: string;
  title?: string;
  teamName?: string;
  gameDate?: string;
}

function buildPrompt(input: AssistInput): { system: string; user: string } {
  const kind =
    input.postType === "short"
      ? "short social highlight caption"
      : "youth-sports game recap";
  const system = [
    "You are an assistant that helps youth-sports coaches and team admins write posts for the Kinectem platform.",
    `Write a ${kind}.`,
    "Audience: players, parents, and fans. Tone: positive, energetic, encouraging, and age-appropriate for youth sports.",
    "Celebrate effort and teamwork. Never criticize or negatively single out a child.",
    "Do not invent specific scores, stats, or player names that were not provided.",
    input.postType === "short"
      ? "Keep it to 1-3 sentences."
      : "Use 2-4 short paragraphs. Do not write a headline or title — only the body text.",
    "Return only the finished post text, with no preamble, labels, or surrounding quotation marks.",
  ].join(" ");

  const context: string[] = [];
  if (input.title) context.push(`Title: ${input.title}`);
  if (input.teamName) context.push(`Team: ${input.teamName}`);
  if (input.gameDate) context.push(`Game date: ${input.gameDate}`);
  const ctxBlock = context.length ? `${context.join("\n")}\n\n` : "";

  const user =
    input.mode === "polish"
      ? `${ctxBlock}Polish and improve the following draft. Keep the author's facts and intent; fix grammar, flow, and tone. Do not add invented details.\n\n"""\n${input.body ?? ""}\n"""`
      : `${ctxBlock}Write the post based on these notes from the coach:\n\n"""\n${input.notes ?? ""}\n"""`;

  return { system, user };
}

export async function generatePostText(input: AssistInput): Promise<string> {
  const { apiKey, model } = await getAnthropicConfig();
  const client = new Anthropic({ apiKey });
  const { system, user } = buildPrompt(input);
  const message = await client.messages.create({
    model,
    max_tokens: 2048,
    system,
    messages: [{ role: "user", content: user }],
  });
  return message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
}
