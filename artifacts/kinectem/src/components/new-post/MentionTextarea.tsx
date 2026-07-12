import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { Textarea } from "@/components/ui/textarea";
import { UserAvatar } from "@/components/UserAvatar";
import { buildMentionToken } from "@/lib/mentions";
import type { RosterPickerMember } from "./RosterTagPicker";

interface MentionTextareaProps {
  id?: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  className?: string;
  members: RosterPickerMember[];
  membersLoading?: boolean;
  "data-testid"?: string;
}

// Recap-body textarea with an @-mention picker (task #739). Typing
// "@" at the start of a line/word opens a dropdown of the team's
// roster players; picking one inserts an inline mention token
// (`@[Name](user:id)`) at the caret. Everything else behaves like the
// plain Textarea it wraps.
//
// The dropdown is anchored under the textarea rather than at the
// caret — caret-positioning inside a <textarea> needs a mirror-div
// measurement hack that isn't worth the complexity here.
//
// Active-query detection: from the caret, walk back to the nearest
// "@" that is at position 0 or preceded by whitespace. The text
// between that "@" and the caret is the filter query. We bail when
// the span contains a newline or "]" (the "]" check means the "@" of
// an already-inserted token can never re-trigger the picker) or runs
// past 40 chars.
const MAX_QUERY_LEN = 40;

function findActiveMention(
  text: string,
  caret: number,
): { start: number; query: string } | null {
  const upto = text.slice(0, caret);
  const at = upto.lastIndexOf("@");
  if (at === -1) return null;
  if (at > 0 && !/[\s(]/.test(upto[at - 1])) return null;
  const query = upto.slice(at + 1);
  if (query.length > MAX_QUERY_LEN) return null;
  if (/[\n\]]/.test(query)) return null;
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
  }, [value]);

  const syncActive = () => {
    const el = textareaRef.current;
    if (!el) return;
    // Only track a collapsed caret — a range selection closes the picker.
    if (el.selectionStart !== el.selectionEnd) {
      setActive(null);
      return;
    }
    setActive(findActiveMention(el.value, el.selectionStart));
  };

  const insertMention = (member: RosterPickerMember) => {
    const el = textareaRef.current;
    if (!el || !active) return;
    const caret = el.selectionStart;
    const token = buildMentionToken(member.displayName, member.userId);
    const next = value.slice(0, active.start) + token + " " + value.slice(caret);
    pendingCaret.current = active.start + token.length + 1;
    setActive(null);
    onChange(next);
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
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          // Recompute against the fresh DOM state (selectionStart is
          // already updated inside the change event).
          const el = e.target;
          if (el.selectionStart === el.selectionEnd) {
            setActive(findActiveMention(el.value, el.selectionStart));
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
