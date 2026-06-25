import Anthropic from "@anthropic-ai/sdk";
import { db, aiProviderKeys } from "@workspace/db";
import { eq } from "drizzle-orm";
import { decryptSecret } from "./secret-crypto";

// Sensible default when an admin hasn't pinned a specific model. The admin
// can override this per provider from /admin/ai-keys. Pinned to a dated
// Sonnet release rather than a `-latest` alias so the model can't silently
// disappear out from under us (the old `claude-3-5-sonnet-latest` alias is
// no longer served and returned 404 "not_found_error: model").
export const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-5-20250929";

// Thrown when no Anthropic key has been configured by an admin yet. Routes
// translate this into a 503 with a friendly "ask an admin" message.
export class AiNotConfiguredError extends Error {
  constructor() {
    super("AI is not configured yet. An admin must add an Anthropic API key.");
    this.name = "AiNotConfiguredError";
  }
}

async function getAnthropicConfig(): Promise<{
  apiKey: string;
  model: string;
  systemContext: string | null;
}> {
  const [row] = await db
    .select()
    .from(aiProviderKeys)
    .where(eq(aiProviderKeys.provider, "anthropic"))
    .limit(1);
  if (!row) throw new AiNotConfiguredError();
  return {
    apiKey: decryptSecret(row.keyCiphertext),
    model: row.model || DEFAULT_ANTHROPIC_MODEL,
    systemContext: row.systemContext?.trim() || null,
  };
}

// Lists the Claude models available to the configured API key, newest first.
// Used to populate the model dropdown on the admin AI Assist page so admins
// pick from real model ids instead of typing one (and risking a 404).
export async function listAnthropicModels(): Promise<
  { id: string; displayName: string }[]
> {
  const { apiKey } = await getAnthropicConfig();
  const client = new Anthropic({ apiKey });
  const models: { id: string; displayName: string }[] = [];
  // Page through all models (the SDK exposes async iteration).
  for await (const model of client.models.list({ limit: 100 })) {
    models.push({ id: model.id, displayName: model.display_name ?? model.id });
  }
  return models;
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

function textFromMessage(message: Anthropic.Message): string {
  return message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
}

export async function generatePostText(input: AssistInput): Promise<string> {
  const { apiKey, model, systemContext } = await getAnthropicConfig();
  const client = new Anthropic({ apiKey });
  const { system, user } = buildPrompt(input);
  // The admin-authored context & personality (if any) takes precedence —
  // prepend it so it frames every generation.
  const finalSystem = systemContext ? `${systemContext}\n\n${system}` : system;
  const message = await client.messages.create({
    model,
    max_tokens: 2048,
    system: finalSystem,
    messages: [{ role: "user", content: user }],
  });
  return textFromMessage(message);
}

// ---------------------------------------------------------------------------
// Monthly recap newsletter (task #623)
// ---------------------------------------------------------------------------

// A single published recap fed into the newsletter prompt. Only already-public
// recap metadata (title, team, date, score, summary) is sent — no minor PII
// beyond what the recap already exposes.
export interface NewsletterRecapInput {
  title: string;
  teamName?: string | null;
  gameDate?: string | null;
  opponentName?: string | null;
  teamScore?: number | null;
  opponentScore?: number | null;
  summary?: string | null;
}

export interface NewsletterInput {
  orgName: string;
  startDate?: string | null;
  endDate?: string | null;
  recaps: NewsletterRecapInput[];
}

function buildNewsletterPrompt(input: NewsletterInput): {
  system: string;
  user: string;
} {
  const system = [
    "You are an assistant that helps youth-sports organizations write a recurring newsletter for the Kinectem platform.",
    "Weave the supplied game recaps into a single, cohesive newsletter that an organization can post for its parents and followers.",
    "Audience: players, parents, and fans. Tone: positive, energetic, encouraging, and age-appropriate for youth sports.",
    "Open with a short, warm intro that frames the time period, then summarize each recap as its own short highlight (a sentence or two), and close with a brief, upbeat sign-off.",
    "Celebrate effort and teamwork across all the teams. Never criticize or negatively single out a child.",
    "Only use the scores, dates, team names, and details provided. Do not invent specific scores, stats, or player names that were not provided.",
    "Use plain paragraphs and simple line breaks. Do not output Markdown formatting, headings with '#', or surrounding quotation marks.",
    "Return only the finished newsletter text, with no preamble or labels.",
  ].join(" ");

  const range =
    input.startDate || input.endDate
      ? `Time period: ${input.startDate ?? "the start"} to ${input.endDate ?? "now"}.`
      : "";
  const header = [`Organization: ${input.orgName}.`, range]
    .filter(Boolean)
    .join("\n");

  const recapBlocks = input.recaps
    .map((r, i) => {
      const lines: string[] = [`Recap ${i + 1}: ${r.title}`];
      if (r.teamName) lines.push(`Team: ${r.teamName}`);
      if (r.gameDate) lines.push(`Game date: ${r.gameDate}`);
      if (r.opponentName) lines.push(`Opponent: ${r.opponentName}`);
      if (r.teamScore != null && r.opponentScore != null) {
        lines.push(`Score: ${r.teamScore}-${r.opponentScore}`);
      }
      if (r.summary && r.summary.trim()) {
        lines.push(`Summary: ${r.summary.trim()}`);
      }
      return lines.join("\n");
    })
    .join("\n\n");

  const user = `${header}\n\nWrite the newsletter based on these ${input.recaps.length} game recap(s):\n\n"""\n${recapBlocks}\n"""`;

  return { system, user };
}

export async function generateNewsletterText(
  input: NewsletterInput,
): Promise<string> {
  const { apiKey, model, systemContext } = await getAnthropicConfig();
  const client = new Anthropic({ apiKey });
  const { system, user } = buildNewsletterPrompt(input);
  // The admin-authored context & personality (if any) frames every
  // generation, exactly like the single-post path.
  const finalSystem = systemContext ? `${systemContext}\n\n${system}` : system;
  const message = await client.messages.create({
    model,
    max_tokens: 4096,
    system: finalSystem,
    messages: [{ role: "user", content: user }],
  });
  return textFromMessage(message);
}

// A team-scoped season/tournament recap: weave a team's individual game
// recaps over a date range into ONE cohesive long-form recap article
// (great for a tournament's worth of games or a whole season).
export interface SeasonRecapInput {
  teamName: string;
  startDate?: string | null;
  endDate?: string | null;
  recaps: NewsletterRecapInput[];
}

function buildSeasonRecapPrompt(input: SeasonRecapInput): {
  system: string;
  user: string;
} {
  const system = [
    "You are an assistant that helps youth-sports coaches write a single, cohesive season or tournament recap for the Kinectem platform.",
    "Weave the supplied individual game recaps into one flowing recap article that tells the story of the team's run across the whole period.",
    "Audience: players, parents, and fans. Tone: positive, energetic, encouraging, and age-appropriate for youth sports.",
    "Open with a short intro that frames the stretch of games, walk through the games in order as one connected narrative (not a list of separate posts), highlight the team's growth, key moments, and teamwork, and close with a warm, forward-looking sign-off.",
    "Celebrate effort and teamwork. Never criticize or negatively single out a child.",
    "Only use the scores, dates, opponents, and details provided. Do not invent specific scores, stats, or player names that were not provided.",
    "Use plain paragraphs and simple line breaks. Do not output Markdown formatting, headings with '#', or surrounding quotation marks.",
    "Return only the finished recap text, with no preamble or labels.",
  ].join(" ");

  const range =
    input.startDate || input.endDate
      ? `Time period: ${input.startDate ?? "the start"} to ${input.endDate ?? "now"}.`
      : "";
  const header = [`Team: ${input.teamName}.`, range].filter(Boolean).join("\n");

  const recapBlocks = input.recaps
    .map((r, i) => {
      const lines: string[] = [`Game ${i + 1}: ${r.title}`];
      if (r.gameDate) lines.push(`Game date: ${r.gameDate}`);
      if (r.opponentName) lines.push(`Opponent: ${r.opponentName}`);
      if (r.teamScore != null && r.opponentScore != null) {
        lines.push(`Score: ${r.teamScore}-${r.opponentScore}`);
      }
      if (r.summary && r.summary.trim()) {
        lines.push(`Summary: ${r.summary.trim()}`);
      }
      return lines.join("\n");
    })
    .join("\n\n");

  const user = `${header}\n\nWrite one cohesive recap based on these ${input.recaps.length} game recap(s), presented in order:\n\n"""\n${recapBlocks}\n"""`;

  return { system, user };
}

export async function generateSeasonRecapText(
  input: SeasonRecapInput,
): Promise<string> {
  const { apiKey, model, systemContext } = await getAnthropicConfig();
  const client = new Anthropic({ apiKey });
  const { system, user } = buildSeasonRecapPrompt(input);
  // The admin-authored context & personality (if any) frames every
  // generation, exactly like the single-post and newsletter paths.
  const finalSystem = systemContext ? `${systemContext}\n\n${system}` : system;
  const message = await client.messages.create({
    model,
    max_tokens: 4096,
    system: finalSystem,
    messages: [{ role: "user", content: user }],
  });
  return textFromMessage(message);
}

// Meta-assist: helps an admin author the "context & personality" instruction
// itself (the field that is later prepended to post-generation prompts).
export async function generateContextSuggestion(
  instruction?: string,
): Promise<string> {
  const { apiKey, model } = await getAnthropicConfig();
  const client = new Anthropic({ apiKey });
  const system = [
    "You are helping a Kinectem platform administrator write a short \"context & personality\" instruction.",
    "This instruction is prepended to the system prompt of an AI assistant that drafts youth-sports posts (game recaps and highlight captions) for coaches and team admins.",
    "Write clear, second-person guidance describing the desired voice, tone, values, and any organization-specific context the assistant should follow.",
    "Keep it concise — roughly 3 to 6 sentences, or a short bulleted list.",
    "Emphasize positivity, encouragement, teamwork, and age-appropriateness for youth sports; never anything that criticizes or negatively singles out a child.",
    "Return only the instruction text, with no preamble, labels, or surrounding quotation marks.",
  ].join(" ");
  const user = instruction?.trim()
    ? `Write the context & personality instruction based on what the admin wants:\n\n"""\n${instruction.trim()}\n"""`
    : "Write a sensible default context & personality instruction for a youth-sports platform that wants warm, encouraging, family-friendly posts.";
  const message = await client.messages.create({
    model,
    max_tokens: 1024,
    system,
    messages: [{ role: "user", content: user }],
  });
  return textFromMessage(message);
}
