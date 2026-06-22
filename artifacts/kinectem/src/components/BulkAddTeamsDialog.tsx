import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateTeam,
  getListOrgTeamsQueryKey,
} from "@workspace/api-client-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiErrorMessage } from "@/lib/api-errors";
import { CheckCircle2, XCircle } from "lucide-react";

// Mirrors CreateTeamDialog's slugify so bulk-created teams get the same
// URL handles as ones made one-at-a-time.
function slugify(s: string) {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

// Parse the textarea into a clean, de-duplicated list of team names.
// Blank / whitespace-only lines are dropped; surrounding whitespace is
// trimmed; case-insensitive duplicates collapse to the first occurrence
// (keeping the original casing the user typed).
function parseNames(raw: string): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const line of raw.split("\n")) {
    const name = line.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
}

type LineResult = {
  name: string;
  status: "success" | "error";
  reason?: string;
};

export function BulkAddTeamsDialog({
  orgId,
  open,
  onOpenChange,
}: {
  orgId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<LineResult[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(
    null,
  );

  const createTeam = useCreateTeam();

  const names = useMemo(() => parseNames(text), [text]);

  const handleOpenChange = (v: boolean) => {
    if (busy) return; // don't let the dialog close mid-run
    if (!v) {
      // Reset transient UI when fully closing so a reopen starts clean.
      setResults([]);
      setProgress(null);
    }
    onOpenChange(v);
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (names.length === 0) {
      toast({ title: "Enter at least one team name", variant: "destructive" });
      return;
    }
    setBusy(true);
    setResults([]);
    setProgress({ done: 0, total: names.length });
    const collected: LineResult[] = [];
    const failedNames: string[] = [];
    // Sequential on purpose: keeps slug-collision and rate-limit behavior
    // predictable, and lets a mid-list failure not lose the rest.
    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      const season = `Season ${new Date().getFullYear()}`;
      try {
        await createTeam.mutateAsync({
          orgId,
          data: {
            name,
            slug: slugify(name),
            season: { name: season },
          },
        });
        collected.push({ name, status: "success" });
      } catch (err) {
        collected.push({
          name,
          status: "error",
          reason: apiErrorMessage(err) ?? "Failed to create team",
        });
        failedNames.push(name);
      }
      setProgress({ done: i + 1, total: names.length });
      setResults([...collected]);
    }
    setBusy(false);
    await qc.invalidateQueries({ queryKey: getListOrgTeamsQueryKey(orgId) });

    const succeeded = collected.filter((r) => r.status === "success").length;
    const failed = collected.length - succeeded;
    // Keep only the failed lines in the textarea so the user can retry
    // just those; clear it entirely when everything succeeded.
    setText(failedNames.join("\n"));
    if (failed === 0) {
      toast({
        title:
          succeeded === 1
            ? "Team created!"
            : `${succeeded} teams created!`,
      });
    } else {
      toast({
        title: `${succeeded} created, ${failed} failed`,
        description: "Failed teams are kept below so you can retry.",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={onSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle className="font-black tracking-tight">
              Bulk add teams
            </DialogTitle>
            <DialogDescription>
              One team name per line. Each is created with just a name — you
              can set sport, season, and photos later.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="bulk-team-names" className="font-bold">
              Team names
            </Label>
            <Textarea
              id="bulk-team-names"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={"Westfield U14 Boys\nWestfield U12 Girls\nWestfield U10 Coed"}
              rows={8}
              disabled={busy}
              autoFocus
              data-testid="textarea-bulk-team-names"
            />
            <p
              className="text-xs font-medium text-muted-foreground"
              data-testid="text-bulk-team-count"
            >
              {names.length === 0
                ? "No teams yet — add one name per line."
                : `${names.length} team${names.length === 1 ? "" : "s"} will be created`}
            </p>
          </div>

          {progress && (
            <p
              className="text-xs font-bold text-muted-foreground"
              data-testid="text-bulk-progress"
            >
              {busy
                ? `Creating ${progress.done} of ${progress.total}...`
                : `Done — processed ${progress.total} team${progress.total === 1 ? "" : "s"}.`}
            </p>
          )}

          {results.length > 0 && (
            <div
              className="max-h-48 overflow-y-auto rounded-lg border border-border divide-y divide-border"
              data-testid="list-bulk-results"
            >
              {results.map((r, i) => (
                <div
                  key={`${r.name}-${i}`}
                  className="flex items-start gap-2 px-3 py-2 text-xs"
                  data-testid={`row-bulk-result-${i}`}
                >
                  {r.status === "success" ? (
                    <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0 mt-0.5" />
                  ) : (
                    <XCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
                  )}
                  <div className="min-w-0">
                    <p className="font-bold truncate">{r.name}</p>
                    {r.status === "error" && r.reason && (
                      <p className="text-muted-foreground">{r.reason}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => handleOpenChange(false)}
              disabled={busy}
            >
              {results.length > 0 && !busy ? "Close" : "Cancel"}
            </Button>
            <Button
              type="submit"
              variant="brand"
              disabled={busy || names.length === 0}
              data-testid="btn-bulk-create-teams"
            >
              {busy
                ? "Creating..."
                : names.length > 0
                  ? `Create ${names.length} team${names.length === 1 ? "" : "s"}`
                  : "Create teams"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
