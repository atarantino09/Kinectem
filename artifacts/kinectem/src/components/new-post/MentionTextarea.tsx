import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { Textarea } from "@/components/ui/textarea";
import { UserAvatar } from "@/components/UserAvatar";
import {
  displayToMentionTokens,
  mentionTokensToDisplay,
  sanitizeMentionName,
} from "@/lib/mentions";
import type { RosterPickerMember } from "./RosterTagPicker";

interface MentionTextareaProps {
  id?: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  className?: string;
  members: RosterPickerMember[];
  membersLoading?: boolean;
  disabled?: boolean;
  "data-testid"?: string;
}

// Recap-body textarea with an @-mention picker (task #739). Typing
// "@" at the start of a line/word opens a dropdown of the team's
// roster players; picking one inserts "@Name" at the caret. The
// author only ever sees the friendly "@Name" form — the canonical
// `value` handed to/from the parent keeps the full
// `@[Name](user:id)` token, converted both ways on every change
// (mentionTokensToDisplay / displayToMentionTokens). Everything else
// behaves like the plain Textarea it wraps.
//
// The dropdown is anchored under the textarea rather than at the
// caret — caret-positioning inside a <textarea> needs a mirror-div
// measurement hack that isn't worth the complexity here.
//
// Active-query detection: from the caret, walk back to the nearest
// "@" that is at position 0 or preceded by whitespace. The text
// between that "@" and the caret is the filter query. We bail when
// the span contains a newline or "]", runs past 40 chars, or starts
// with a completed roster-name mention (see below).
const MAX_QUERY_LEN = 40;

function findActiveMention(
  text: string,
  caret: number,
  completedNames: readonly string[],
): { start: number; query: string } | null {
  const upto = text.slice(0, caret);
  const at = upto.lastIndexOf("@");
  if (at === -1) return null;
  if (at > 0 && !/[\s(]/.test(upto[at - 1])) return null;
  const query = upto.slice(at + 1);
  if (query.length > MAX_QUERY_LEN) return null;
  if (/[\n\]]/.test(query)) return null;
  // The display text keeps completed mentions as plain "@Name", so a
  // caret sitting after one would otherwise re-open the picker (and a
  // stray Enter would insert a duplicate). If the text right after
  // this "@" is exactly a roster name (followed by a non-word char or
  // the caret), treat the mention as completed and stay closed —
  // UNLESS the query is still a prefix of a longer roster name (e.g.
  // "Avery Tarantino" typed while "Avery Tarantino Jr" also exists),
  // in which case keep the picker open so the longer name stays
  // reachable.
  for (const name of completedNames) {
    if (
      query.startsWith(name) &&
      (query.length === name.length || /\W/.test(query[name.length]))
    ) {
      const stillExtending = completedNames.some(
        (other) => other.length > query.length && other.startsWith(query),
      );
      if (!stillExtending) return null;
    }
  }
  return { start: at, query };
}

export function MentionTextarea({
  id,
  value,
  onChange,
  placeholder,
  className,
  members,
  membersLoading = false,
  disabled = false,
  "data-testid": testId,
}: MentionTextareaProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [active, setActive] = useState<{
    start: number;
    query: string;
  } | null>(null);
  const [highlight, setHighlight] = useState(0);
  // Caret position to restore after an insert (set → applied in the
  // effect below once the new value has rendered).
  const pendingCaret = useRef<number | null>(null);
  // What the textarea shows: tokens collapsed to "@Name".
  const display = useMemo(() => mentionTokensToDisplay(value), [value]);
  // Sanitized roster names — used to keep the picker closed when the
  // caret sits after an already-completed "@Name" mention.
  const completedNames = useMemo(
    () =>
      members
        .map((m) => sanitizeMentionName(m.displayName))
        .filter((n) => n.length > 0),
    [members],
  );
  // Re-tokenize the display text before handing it up to the parent.
  const emit = (nextDisplay: string) =>
    onChange(displayToMentionTokens(nextDisplay, members));

  const matches = useMemo(() => {
    if (!active) return [];
    const q = active.query.trim().toLowerCase();
    return members
      .filter((m) => !q || m.displayName.toLowerCase().includes(q))
      .slice(0, 8);
  }, [active, members]);

  useEffect(() => {
    setHighlight(0);
  }, [active?.query]);

  useEffect(() => {
    if (pendingCaret.current !== null && textareaRef.current) {
      const pos = pendingCaret.current;
      pendingCaret.current = null;
      textareaRef.current.focus();
      textareaRef.current.setSelectionRange(pos, pos);
    }
  }, [display]);

  const syncActive = () => {
    const el = textareaRef.current;
    if (!el) return;
    // Only track a collapsed caret — a range selection closes the picker.
    if (el.selectionStart !== el.selectionEnd) {
      setActive(null);
      return;
    }
    setActive(findActiveMention(el.value, el.selectionStart, completedNames));
  };

  const insertMention = (member: RosterPickerMember) => {
    const el = textareaRef.current;
    if (!el || !active) return;
    const caret = el.selectionStart;
    // Insert the friendly "@Name" form — emit() re-tokenizes it.
    const inserted = `@${sanitizeMentionName(member.displayName) || "player"}`;
    const next =
      display.slice(0, active.start) + inserted + " " + display.slice(caret);
    pendingCaret.current = active.start + inserted.length + 1;
    setActive(null);
    emit(next);
  };

  const open = !!active && (membersLoading || matches.length > 0);

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, matches.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter" && matches.length > 0) {
      e.preventDefault();
      insertMention(matches[Math.min(highlight, matches.length - 1)]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setActive(null);
    }
  };

  return (
    <div className="relative">
      <Textarea
        ref={textareaRef}
        id={id}
        value={display}
        onChange={(e) => {
          emit(e.target.value);
          // Recompute against the fresh DOM state (selectionStart is
          // already updated inside the change event).
          const el = e.target;
          if (el.selectionStart === el.selectionEnd) {
            setActive(
              findActiveMention(el.value, el.selectionStart, completedNames),
            );
          } else {
            setActive(null);
          }
        }}
        onKeyDown={onKeyDown}
        onClick={syncActive}
        onKeyUp={(e) => {
          // Arrow-left/right/home/end move the caret without firing
          // onChange — re-evaluate so the picker opens/closes correctly.
          if (
            ["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)
          ) {
            syncActive();
          }
        }}
        onBlur={() => {
          // Delay so a mousedown on a dropdown row wins the race
          // against blur closing the list.
          setTimeout(() => setActive(null), 150);
        }}
        placeholder={placeholder}
        className={className}
        disabled={disabled}
        data-testid={testId}
      />
      {open && (
        <div
          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-64 overflow-y-auto rounded-md border border-border bg-popover shadow-md"
          data-testid="dropdown-mention-picker"
        >
          {membersLoading && matches.length === 0 ? (
            <div className="px-3 py-2 text-sm text-muted-foreground">
              Loading roster…
            </div>
          ) : (
            matches.map((m, i) => (
              <button
                key={m.userId}
                type="button"
                // mousedown (not click) so the insert runs before the
                // textarea's delayed blur-close.
                onMouseDown={(e) => {
                  e.preventDefault();
                  insertMention(m);
                }}
                onMouseEnter={() => setHighlight(i)}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm ${
                  i === highlight ? "bg-accent" : ""
                }`}
                data-testid={`option-mention-${m.userId}`}
              >
                <UserAvatar
                  avatarUrl={m.avatarUrl}
                  displayName={m.displayName}
                  size="xs"
                  fallbackClassName="bg-slate-900 text-primary-foreground"
                />
                <span className="font-medium">{m.displayName}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
