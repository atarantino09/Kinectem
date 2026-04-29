import { type ReactNode } from "react";

const URL_REGEX = /((?:https?:\/\/|www\.)[^\s<>]+)/gi;

const TRAILING_PUNCT = ".,;:!?'\"`…";
const TRAILING_CLOSERS: Record<string, string> = {
  ")": "(",
  "]": "[",
  "}": "{",
  ">": "<",
};

function trimTrailing(url: string): string {
  let result = url;
  while (result.length > 0) {
    const last = result[result.length - 1];
    if (TRAILING_CLOSERS[last]) {
      const opener = TRAILING_CLOSERS[last];
      let opens = 0;
      let closes = 0;
      for (const ch of result) {
        if (ch === opener) opens++;
        else if (ch === last) closes++;
      }
      if (closes > opens) {
        result = result.slice(0, -1);
        continue;
      }
      break;
    }
    if (TRAILING_PUNCT.includes(last)) {
      result = result.slice(0, -1);
      continue;
    }
    break;
  }
  return result;
}

function toHref(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  return `https://${url}`;
}

export function linkify(text: string): ReactNode[] {
  if (!text) return [];
  const nodes: ReactNode[] = [];
  const regex = new RegExp(URL_REGEX.source, "gi");
  let lastIndex = 0;
  let key = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const start = match.index;
    const raw = match[0];
    const url = trimTrailing(raw);
    if (!url) {
      regex.lastIndex = start + 1;
      continue;
    }
    if (start > lastIndex) {
      nodes.push(text.slice(lastIndex, start));
    }
    nodes.push(
      <a
        key={`linkify-${key++}-${start}`}
        href={toHref(url)}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="text-primary underline underline-offset-2 hover:text-primary/80 break-words"
      >
        {url}
      </a>,
    );
    lastIndex = start + url.length;
    regex.lastIndex = lastIndex;
  }
  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }
  return nodes;
}
