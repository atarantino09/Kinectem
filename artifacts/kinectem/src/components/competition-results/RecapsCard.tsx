import { useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { api, expectedRevisionsFor, uuid, useInvalidateResults, type ResultGroup, type Snapshot, type Workspace } from "@/lib/competition-results";
import { errMsg } from "./ResultsUiHelpers";
import { RecapEditor } from "./RecapEditor";

export function RecapsCard({ cid, snap, ws }: { cid: string; snap: Snapshot; ws: Workspace }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [coverage, setCoverage] = useState(true);
  const [dirtyIds, setDirtyIds] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [errors, setErrors] = useState<{ groupKey: string; error: string; code: string }[]>([]);
  const [confirmRegen, setConfirmRegen] = useState(false);
  const cancelRef = useRef(false);
  const recapsRef = useRef(ws.recaps);
  recapsRef.current = ws.recaps;
  const invalidate = useInvalidateResults(cid);
  const { toast } = useToast();

  const eligible = snap.confirmed ? snap.groups.filter((g) => g.bracketId) : [];
  const bracketLabel = (id: string) => ws.brackets.find((b) => b.id === id)?.label ?? "Bracket";
  const existingFor = (g: ResultGroup) => ws.recaps.find((r) => r.bracketId === g.bracketId);
  const selectedGroups = eligible.filter((g) => selected.has(g.key));
  const overwrites = selectedGroups.filter((g) => existingFor(g));
  const running = progress !== null;
  const hasDirty = dirtyIds.size > 0;
  const setDirty = useMemo(
    () => (id: string, d: boolean) =>
      setDirtyIds((prev) => {
        if (prev.has(id) === d) return prev;
        const n = new Set(prev);
        if (d) n.add(id);
        else n.delete(id);
        return n;
      }),
    [],
  );

  const run = async () => {
    cancelRef.current = false;
    setErrors([]);
    const keys = selectedGroups.map((g) => g.key);
    setProgress({ done: 0, total: keys.length });
    const collected: typeof errors = [];
    let saved = 0;
    for (let i = 0; i < keys.length; i++) {
      if (cancelRef.current) break;
      try {
        // One bracket per request so progress/cancel work between drafts.
        const res = await api.generate(cid, {
          importId: snap.id,
          groupKeys: [keys[i]],
          includeCoverage: coverage,
          requestId: uuid(),
          expectedRevisions: expectedRevisionsFor(snap.groups, [keys[i]], recapsRef.current),
        });
        saved += res.data.length;
        collected.push(...res.errors);
        // Refresh so the next expectedRevision is current.
        await invalidate();
        const fresh = await api.workspace(cid).catch(() => null);
        if (fresh) recapsRef.current = fresh.recaps;
      } catch (e) {
        collected.push({ groupKey: keys[i], error: errMsg(e), code: "request_failed" });
      }
      setProgress({ done: i + 1, total: keys.length });
    }
    setErrors(collected);
    setProgress(null);
    invalidate();
    toast({
      title: cancelRef.current ? "Generation cancelled" : "Generation finished",
      description: `${saved} draft${saved === 1 ? "" : "s"} saved${cancelRef.current ? "; saved drafts were kept" : ""}.`,
    });
  };

  const manual = useMutation({
    mutationFn: (g: ResultGroup) =>
      api.createManual(cid, {
        importId: snap.id,
        groupKey: g.key,
        title: `${g.label} recap`,
        body: "Write the factual story of this bracket here.",
      }),
    onSuccess: () => invalidate(),
    onError: (e) => toast({ title: "Couldn't create draft", description: errMsg(e), variant: "destructive" }),
  });

  return (
    <Card data-testid="card-results-recaps">
      <CardHeader>
        <CardTitle className="text-base">3. Tournament recaps</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!snap.confirmed ? (
          <p className="text-sm text-muted-foreground" data-testid="text-confirm-first">
            Confirm the mappings above to draft recaps from this import.
          </p>
        ) : eligible.length === 0 ? (
          <p className="text-sm text-muted-foreground">No group is mapped to a bracket, so there is nothing to recap.</p>
        ) : (
          <div className="space-y-3">
            {eligible.map((g) => (
              <div key={g.key} className="flex flex-wrap items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  id={`sel-${g.key}`}
                  checked={selected.has(g.key)}
                  disabled={running}
                  onChange={(e) =>
                    setSelected((s) => {
                      const n = new Set(s);
                      if (e.target.checked) n.add(g.key);
                      else n.delete(g.key);
                      return n;
                    })
                  }
                  data-testid={`check-generate-${g.key}`}
                />
                <label htmlFor={`sel-${g.key}`} className="font-bold">
                  {g.label}
                </label>
                <span className="text-xs text-muted-foreground">to {bracketLabel(g.bracketId!)}</span>
                {existingFor(g) ? (
                  <Badge variant="outline">has {existingFor(g)!.published ? "published" : "draft"} recap</Badge>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 text-xs underline"
                    disabled={manual.isPending}
                    onClick={() => manual.mutate(g)}
                    data-testid={`btn-manual-${g.key}`}
                  >
                    Write manually
                  </Button>
                )}
              </div>
            ))}
            <div className="flex items-center gap-2">
              <Switch checked={coverage} onCheckedChange={setCoverage} id="inc-cov" data-testid="switch-include-coverage" />
              <Label htmlFor="inc-cov" className="text-xs">
                Weave in published team coverage
              </Label>
            </div>
            {hasDirty ? (
              <p className="text-xs text-amber-800" data-testid="text-dirty-block">
                You have unsaved edits. Save them first; generating is disabled so they are never overwritten.
              </p>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="brand"
                disabled={selectedGroups.length === 0 || hasDirty || running}
                onClick={() => (overwrites.length ? setConfirmRegen(true) : run())}
                data-testid="btn-generate-recaps"
              >
                {running ? `Generating ${progress!.done}/${progress!.total}…` : `Generate ${selectedGroups.length || ""} draft${selectedGroups.length === 1 ? "" : "s"}`}
              </Button>
              {running ? (
                <Button variant="outline" onClick={() => (cancelRef.current = true)} data-testid="btn-cancel-generate">
                  Cancel after current
                </Button>
              ) : null}
            </div>
            {errors.length > 0 ? (
              <ul className="space-y-1" data-testid="list-generate-errors">
                {errors.map((e, i) => (
                  <li key={i} className="rounded-md border border-red-300 bg-red-50 p-2 text-xs">
                    <span className="font-bold">{snap.groups.find((g) => g.key === e.groupKey)?.label ?? e.groupKey}:</span>{" "}
                    {e.code === "AI_NOT_CONFIGURED"
                      ? "No AI provider is configured. Write this recap manually or retry later. "
                      : ""}
                    {e.error}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        )}

        <div className="space-y-3">
          {ws.recaps.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="text-no-recaps">
              No recaps yet. One canonical recap lives on each bracket.
            </p>
          ) : (
            ws.recaps.map((r) => <RecapEditor key={r.id} cid={cid} recap={r} label={bracketLabel(r.bracketId)} onDirty={setDirty} />)
          )}
        </div>
      </CardContent>
      <AlertDialog open={confirmRegen} onOpenChange={setConfirmRegen}>
        <AlertDialogContent data-testid="dialog-regenerate">
          <AlertDialogHeader>
            <AlertDialogTitle>Regenerate existing drafts?</AlertDialogTitle>
            <AlertDialogDescription>
              {overwrites.length} selected bracket{overwrites.length === 1 ? " already has" : "s already have"} a recap. The saved
              draft is replaced; published stories stay live until you publish again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmRegen(false);
                run();
              }}
              data-testid="btn-confirm-regenerate"
            >
              Regenerate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
