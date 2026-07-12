import { type ReactNode } from "react";
import { Link } from "wouter";
import { linkify } from "./linkify";

// Inline @-mention token stored in the plain-text recap body
// (task #739). The OpenAPI spec is locked, so the token lives inside
// the existing `body` string:
//
//   @[Display Name](user:<uuid>)
//
// The server parses the same shape to upsert player tags; the client
// renders it as a profile link. Names are sanitized at insert time
// (no brackets / parens / newlines) so the regex stays simple.
export const MENTION_TOKEN_RE =
  /@\[([^\]\n]{1,80})\]\(user:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)/gi;

// Build a token from a picked roster member. Strips the characters
// that would break the token grammar out of the display name.
export function buildMentionToken(name: string, userId: string): string {
  const safe = name
    .replace(/[[\]()\n]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return `@[${safe || "player"}](user:${userId})`;
}

// Render a body string: mention tokens become profile links, and the
// plain-text segments in between still get URL linkification.
//
// When `opts.validUserIds` is provided (the post detail page passes the
// ids from the server's viewer-visible `taggedUsers` list), only tokens
// whose user is in that set render as links; everything else — deleted
// accounts, removed tags, tokens the server hasn't validated for this
// viewer — degrades to plain "@Name" text so there are never broken
// links. When the caller has no tag data (feed cards), tokens render as
// links unconditionally: bodies are sanitized server-side at write time,
// so any token that persisted was roster-validated, and the profile
// page enforces COPPA visibility server-side regardless.
export function renderBodyWithMentions(
  text: string,
  opts?: { validUserIds?: ReadonlySet<string> },
): ReactNode[] {
  if (!text) return [];
  const validUserIds = opts?.validUserIds;
  const nodes: ReactNode[] = [];
  const re = new RegExp(MENTION_TOKEN_RE.source, "gi");
  let lastIndex = 0;
  let key = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(...linkify(text.slice(lastIndex, match.index)));
    }
    const name = match[1];
    const userId = match[2];
    const resolvable =
      !validUserIds || validUserIds.has(userId.toLowerCase());
    nodes.push(
      resolvable ? (
        <Link
          key={`mention-${key++}-${match.index}`}
          href={`/users/${userId}`}
          onClick={(e) => e.stopPropagation()}
          className="font-semibold text-primary hover:underline underline-offset-2"
          data-testid={`link-mention-${userId}`}
        >
          @{name}
        </Link>
      ) : (
        <span
          key={`mention-${key++}-${match.index}`}
          data-testid={`text-mention-${userId}`}
        >
          @{name}
        </span>
      ),
    );
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    nodes.push(...linkify(text.slice(lastIndex)));
  }
  return nodes;
}

// Truncate a body for a preview without ever cutting a mention token
// in half (a half token would render as raw "@[Jane Do…" garbage).
// If the cut position lands inside a token, we back the cut up to the
// token's start instead.
export function truncateMentionSafe(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const re = new RegExp(MENTION_TOKEN_RE.source, "gi");
  let cut = maxChars;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    if (start >= cut) break;
    if (end > cut) {
      cut = start;
      break;
    }
  }
  return text.slice(0, cut).trimEnd();
}
