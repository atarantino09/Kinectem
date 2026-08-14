import { useEffect, useRef, useState } from "react";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Upload, ChevronDown, Plus, X } from "lucide-react";
import { STAGED_EMAIL_RE } from "@/components/StageCoachesDialog";

// Task #832 — the numbered two-column (team name + optional coach email)
// row-list editor, factored out of BulkAddTeamsDialog so the admin org
// quick-setup page shares the exact same input UI. Zebra stripes span the
// number gutter and both columns; cells auto-grow when a long value wraps;
// Enter jumps to the same column of the next row; a multi-line paste into
// either column splits down that column; Upload CSV replaces the list.

// A row is one team; `email` is the first coach and `extraEmails` holds any
// additional coaches added via the per-row "+ Add coach" control.
export type BulkPair = { name: string; email: string; extraEmails?: string[] };

export function trimTrailingEmpty(pairs: BulkPair[]): BulkPair[] {
  let end = pairs.length;
  while (
    end > 0 &&
    !pairs[end - 1].name.trim() &&
    !pairs[end - 1].email.trim() &&
    !(pairs[end - 1].extraEmails ?? []).some((e) => e.trim())
  )
    end--;
  return pairs.slice(0, end);
}

// Task #817 — tiny dependency-free CSV parser (quoted-field aware, handles
// \r\n and \n, escaped quotes ""). Returns rows of cells; no type coercion.
export function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  let atFieldStart = true;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"' && atFieldStart) {
      // Quote mode only opens at the start of a field; a quote appearing
      // mid-cell (e.g. 5'10" Team) is a literal character.
      inQuotes = true;
      atFieldStart = false;
      continue;
    }
    atFieldStart = ch === "," || ch === "\n" || ch === "\r";
    if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && input[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      rows.push(row);
      row = [];
    } else {
      cell += ch;
    }
  }
  row.push(cell);
  rows.push(row);
  // Drop rows where every cell is blank (incl. the trailing newline row).
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

// Task #817 — detect an optional CSV header row like "Team,Coach Email":
// col 1 mentions team/name, or col 2 mentions email/coach without BEING an
// email address itself.
export function isCsvHeaderRow(row: string[]): boolean {
  const c1 = (row[0] ?? "").trim();
  const c2 = (row[1] ?? "").trim();
  if (/^teams?(\s*names?)?$/i.test(c1) || /^names?$/i.test(c1)) return true;
  if (c2 && /(email|coach)/i.test(c2) && !STAGED_EMAIL_RE.test(c2.toLowerCase()))
    return true;
  return false;
}

// Task #817 — one auto-growing cell of the row list. A 1-row textarea that
// wraps long values and resizes to fit, so the row's zebra stripe grows with
// it (the stripe lives on the row container, which stretches both columns).
function GrowCell({
  value,
  onChange,
  onEnter,
  placeholder,
  disabled,
  testId,
  refKey,
  cellRefs,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  onEnter: () => void;
  placeholder?: string;
  disabled?: boolean;
  testId: string;
  refKey: string;
  cellRefs: React.MutableRefObject<Map<string, HTMLTextAreaElement>>;
  autoFocus?: boolean;
}) {
  const innerRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return (
    <textarea
      ref={(el) => {
        innerRef.current = el;
        if (el) cellRefs.current.set(refKey, el);
        else cellRefs.current.delete(refKey);
      }}
      rows={1}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          onEnter();
        }
      }}
      placeholder={placeholder}
      disabled={disabled}
      autoFocus={autoFocus}
      className="w-full min-w-0 resize-none overflow-hidden break-words bg-transparent px-2 py-1 text-sm leading-6 outline-none placeholder:text-muted-foreground/60 focus-visible:ring-1 focus-visible:ring-ring rounded-sm disabled:opacity-50"
      data-testid={testId}
    />
  );
}

export function BulkPairEditor({
  pairs,
  onPairsChange,
  disabled,
  idPrefix,
  minRows = 5,
  expandStep = 5,
  autoFocusFirst = false,
  listMaxHeightClass = "max-h-52",
}: {
  pairs: BulkPair[];
  onPairsChange: (next: BulkPair[]) => void;
  disabled?: boolean;
  // Test-id prefix — "bulk" reproduces BulkAddTeamsDialog's historical ids
  // (input-bulk-team-name-0, btn-bulk-upload-csv, ...).
  idPrefix: string;
  minRows?: number;
  // "Show N more rows" step for the expander under the list. Always shown,
  // so there's always room for more rows.
  expandStep?: number;
  autoFocusFirst?: boolean;
  listMaxHeightClass?: string;
}) {
  const [extraRows, setExtraRows] = useState(0);
  const { toast } = useToast();
  const csvInputRef = useRef<HTMLInputElement | null>(null);
  const cellRefs = useRef(new Map<string, HTMLTextAreaElement>());

  // A multi-line paste into either column splits down that column (line k
  // lands on row i+k).
  const updateCell = (i: number, col: "name" | "email", value: string) => {
    const next = pairs.map((p) => ({ ...p }));
    const lines = value.split("\n");
    const ensure = (j: number) => {
      while (next.length <= j) next.push({ name: "", email: "" });
    };
    for (let k = 0; k < lines.length; k++) {
      ensure(i + k);
      next[i + k][col] = lines[k];
    }
    onPairsChange(trimTrailingEmpty(next));
  };

  // Per-row extra coach emails ("+ Add coach" expands the row downward).
  const withRow = (i: number, fn: (p: BulkPair) => void) => {
    const next: BulkPair[] = pairs.map((p) => ({
      ...p,
      extraEmails: p.extraEmails ? [...p.extraEmails] : undefined,
    }));
    while (next.length <= i) next.push({ name: "", email: "" });
    fn(next[i]);
    onPairsChange(trimTrailingEmpty(next));
  };
  const addExtraEmail = (i: number) => {
    withRow(i, (p) => {
      p.extraEmails = [...(p.extraEmails ?? []), ""];
    });
    requestAnimationFrame(() => {
      cellRefs.current
        .get(`extra-${i}-${(pairs[i]?.extraEmails ?? []).length}`)
        ?.focus();
    });
  };
  const updateExtraEmail = (i: number, j: number, value: string) => {
    withRow(i, (p) => {
      const list = [...(p.extraEmails ?? [])];
      list[j] = value.replace(/\n/g, " ");
      p.extraEmails = list;
    });
  };
  const removeExtraEmail = (i: number, j: number) => {
    withRow(i, (p) => {
      const list = [...(p.extraEmails ?? [])];
      list.splice(j, 1);
      p.extraEmails = list.length > 0 ? list : undefined;
    });
  };

  const focusCell = (i: number, col: "name" | "email") => {
    // Rendered rows always include one empty trailing row, so the target
    // exists on the next paint.
    requestAnimationFrame(() => {
      cellRefs.current.get(`${col}-${i}`)?.focus();
    });
  };

  const onCsvChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    let raw = "";
    try {
      raw = await file.text();
    } catch {
      toast({ title: "Couldn't read that file", variant: "destructive" });
      return;
    }
    let csvRows = parseCsv(raw);
    if (csvRows.length > 0 && isCsvHeaderRow(csvRows[0])) {
      csvRows = csvRows.slice(1);
    }
    const imported = trimTrailingEmpty(
      csvRows.map((r) => ({
        name: (r[0] ?? "").trim(),
        email: (r[1] ?? "").trim(),
      })),
    );
    if (imported.length === 0) {
      toast({
        title: "No rows found in that CSV",
        description:
          "Expected team name in the first column and an optional coach email in the second.",
        variant: "destructive",
      });
      return;
    }
    if (
      trimTrailingEmpty(pairs).length > 0 &&
      !window.confirm(
        "Replace what's currently in the list with the CSV contents?",
      )
    ) {
      return;
    }
    onPairsChange(imported);
    toast({
      title: `Loaded ${imported.length} row${imported.length === 1 ? "" : "s"} from CSV`,
      description: "Review the pairings below.",
    });
  };

  // Render `minRows` up front (plus any expansions); filled rows always
  // render, with one empty trailing row so there is always somewhere to
  // keep typing.
  const renderedRows = Math.max(minRows + extraRows, pairs.length + 1);

  return (
    <div className="space-y-1.5">
      {/* CSV upload: team name in column 1, coach email in column 2; an
          optional header row is skipped. Kept on its own row so the column
          labels line up exactly with the columns below. */}
      <div className="flex justify-end">
        <input
          ref={csvInputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={onCsvChange}
          data-testid={`input-${idPrefix}-csv`}
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="shrink-0 font-bold rounded-full"
          onClick={() => csvInputRef.current?.click()}
          disabled={disabled}
          data-testid={`btn-${idPrefix}-upload-csv`}
        >
          <Upload className="w-3.5 h-3.5 mr-1.5" />
          Upload CSV
        </Button>
      </div>
      {/* Mirrors the row layout below (number gutter + two equal columns)
          so each label sits directly over its column. */}
      <div className="flex gap-2">
        <div className="w-7 shrink-0" aria-hidden />
        <div className="flex-1 min-w-0 px-2">
          <Label className="font-bold">Team names</Label>
        </div>
        <div className="flex-1 min-w-0 px-2">
          <Label className="font-bold">
            Coach email{" "}
            <span className="font-medium text-muted-foreground">
              (optional)
            </span>
          </Label>
        </div>
      </div>
      {/* Zebra-striped rows. The stripe sits on the row container, so it
          spans number + both columns and grows when a long value wraps;
          later row numbers shift down with it. */}
      <div
        className={`${listMaxHeightClass} overflow-y-auto rounded-md border border-input`}
        data-testid={`list-${idPrefix}-rows`}
      >
        {Array.from({ length: renderedRows }, (_, i) => {
          const pair = pairs[i] ?? { name: "", email: "" };
          return (
            <div
              key={i}
              className={`flex items-start gap-2 px-1 py-0.5 ${
                i % 2 === 1
                  ? "bg-purple-50 dark:bg-purple-950/30"
                  : "bg-background"
              }`}
              data-testid={`row-${idPrefix}-input-${i}`}
            >
              <div
                className="w-7 shrink-0 pr-1 pt-1 text-right text-xs leading-6 text-muted-foreground select-none"
                aria-hidden
              >
                {i + 1}
              </div>
              <div className="flex-1 min-w-0">
                <GrowCell
                  value={pair.name}
                  onChange={(v) => updateCell(i, "name", v)}
                  onEnter={() => focusCell(i + 1, "name")}
                  placeholder={i === 0 ? "Westfield U14 Boys" : undefined}
                  disabled={disabled}
                  testId={`input-${idPrefix}-team-name-${i}`}
                  refKey={`name-${i}`}
                  cellRefs={cellRefs}
                  autoFocus={autoFocusFirst && i === 0}
                />
              </div>
              <div className="flex-1 min-w-0">
                <GrowCell
                  value={pair.email}
                  onChange={(v) => updateCell(i, "email", v)}
                  onEnter={() => focusCell(i + 1, "email")}
                  placeholder={i === 0 ? "coach@example.com" : undefined}
                  disabled={disabled}
                  testId={`input-${idPrefix}-coach-email-${i}`}
                  refKey={`email-${i}`}
                  cellRefs={cellRefs}
                />
                {(pair.extraEmails ?? []).map((extra, j) => (
                  <div
                    key={j}
                    className="flex items-center gap-1"
                    data-testid={`row-${idPrefix}-extra-coach-${i}-${j}`}
                  >
                    <GrowCell
                      value={extra}
                      onChange={(v) => updateExtraEmail(i, j, v)}
                      onEnter={() => addExtraEmail(i)}
                      placeholder="another-coach@example.com"
                      disabled={disabled}
                      testId={`input-${idPrefix}-extra-coach-${i}-${j}`}
                      refKey={`extra-${i}-${j}`}
                      cellRefs={cellRefs}
                    />
                    <button
                      type="button"
                      onClick={() => removeExtraEmail(i, j)}
                      disabled={disabled}
                      aria-label="Remove coach"
                      className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground disabled:opacity-50"
                      data-testid={`btn-${idPrefix}-remove-extra-coach-${i}-${j}`}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
                {(pair.name.trim() || pair.email.trim()) && (
                  <button
                    type="button"
                    onClick={() => addExtraEmail(i)}
                    disabled={disabled}
                    className="mt-0.5 flex items-center gap-1 px-2 pb-0.5 text-[11px] font-medium text-muted-foreground hover:text-foreground disabled:opacity-50"
                    data-testid={`btn-${idPrefix}-add-coach-${i}`}
                  >
                    <Plus className="w-3 h-3" />
                    Add coach
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {/* Always available — expands the list `expandStep` rows at a time so
          there's always room for a longer list. */}
      <div className="flex justify-center">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 text-xs text-muted-foreground"
          onClick={() =>
            setExtraRows((n) => renderedRows - minRows + expandStep)
          }
          disabled={disabled}
          data-testid={`btn-${idPrefix}-show-more`}
        >
          <ChevronDown className="w-3.5 h-3.5 mr-1" />
          Show {expandStep} more rows
        </Button>
      </div>
    </div>
  );
}
