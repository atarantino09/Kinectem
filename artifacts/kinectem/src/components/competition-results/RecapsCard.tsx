import { useCallback, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { api, expectedRevisionsFor, missingRecapGroups, publishableRecaps, snapshotSummary, uuid, useInvalidateResults, type Snapshot, type Workspace } from "@/lib/competition-results";
import { errMsg } from "./ResultsUiHelpers";
import { RecapEditor } from "./RecapEditor";

type GenErr = { groupKey: string; error: string; code: string };
type PubErr = { id: string; error: string; code: string };

export function RecapsCard({ cid, snap, ws }: { cid: string; snap: Snapshot; ws: Workspace }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [dirtyIds, setDirtyIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<"gen" | "pub" | null>(null);
  const [genErrors, setGenErrors] = useState<GenErr[]>([]);
  const [pubErrors, setPubErrors] = useState<PubErr[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const requestId = useRef(uuid());
  const invalidate = useInvalidateResults(cid);
  const { toast } = useToast();
  const blocked = snapshotSummary(snap).blocked;
  const hasDirty = dirtyIds.size > 0;
  const label = (id: string) => ws.brackets.find((b) => b.id === id)?.label ?? "Bracket";
  const pending = publishableRecaps(ws.recaps);
  const failedKeys = genErrors.map((e) => e.groupKey);
  const setDirty = useCallback(
    (id: string, d: boolean) =>
      setDirtyIds((prev) => {
        if (prev.has(id) === d) return prev;
        const n = new Set(prev);
        if (d) n.add(id);
        else n.delete(id);
        return n;
      }),
    [],
  );
  const writeManually = async (groupKey: string) => {
    const g = snap.groups.find((x) => x.key === groupKey);
    if (!g) return;
    try {
      await api.createManual(cid, { importId: snap.id, groupKey, title: `${g.label} recap`, body: "Write the factual story of this bracket here." });
      setGenErrors((es) => es.filter((e) => e.groupKey !== groupKey));
    } catch (e) {
      toast({ title: "Couldn't create draft", description: errMsg(e), variant: "destructive" });
    }
    invalidate();
  };

  const generate = async () => {
    setBusy("gen");
    setNotice(null);
    try {
      const prepared = await api.prepareImport(cid, snap.id);
      const fresh = await api.workspace(cid);
      const keys = missingRecapGroups(prepared.groups, fresh.recaps).map((g) => g.key);
      if (keys.length === 0) {
        setGenErrors([]);
        setNotice("Every bracket already has a recap. Existing drafts and published stories were left untouched.");
        return;
      }
      const res = await api.generate(cid, {
        importId: prepared.id,
        groupKeys: keys.slice(0, 40),
        includeCoverage: true,
        requestId: requestId.current,
        expectedRevisions: expectedRevisionsFor(prepared.groups, keys, fresh.recaps),
        preserveExisting: true,
      });
      setGenErrors(res.errors);
      if (res.errors.length === 0) requestId.current = uuid();
      setNotice(`${res.data.length} bracket recap${res.data.length === 1 ? "" : "s"} ready as drafts.`);
    } catch (e) {
      setGenErrors([{ groupKey: "", error: errMsg(e), code: "request_failed" }]);
    } finally {
      setBusy(null);
      invalidate();
    }
  };

  const publishAll = async () => {
    setBusy("pub");
    setPubErrors([]);
    try {
      const res = await api.publishBatch(cid, { recaps: pending.map((r) => ({ id: r.id, expectedRevision: r.revision })) });
      setPubErrors(res.errors);
      toast({ title: "Publish finished", description: `${res.data.length} published${res.errors.length ? `, ${res.errors.length} failed` : ""}.` });
    } catch (e) {
      setPubErrors([{ id: "", error: errMsg(e), code: "request_failed" }]);
    } finally {
      setBusy(null);
      invalidate();
    }
  };

  const name = (id: string) => {
    const r = ws.recaps.find((x) => x.id === id);
    return r ? label(r.bracketId) : "Publish";
  };

  return (
    <Card data-testid="card-results-recaps">
      <CardHeader>
        <CardTitle className="text-base">2. Bracket recaps</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="brand" disabled={blocked || busy !== null} onClick={generate} data-testid="btn-generate-recaps">
            {busy === "gen" ? "Generating…" : failedKeys.length ? "Retry missing recaps" : "Generate bracket recaps"}
          </Button>
          <p className="text-xs text-muted-foreground">Teams and brackets are matched automatically. Existing recaps are never overwritten.</p>
        </div>
        {notice ? <p className="text-sm" data-testid="text-generate-notice">{notice}</p> : null}
        {genErrors.length > 0 ? (
          <ul className="space-y-1" data-testid="list-generate-errors">
            {genErrors.map((e, i) => (
              <li key={i} className="rounded-md border border-red-300 bg-red-50 p-2 text-xs">
                <span className="font-bold">{snap.groups.find((g) => g.key === e.groupKey)?.label ?? e.groupKey}</span>{" "}
                {e.code === "AI_NOT_CONFIGURED" ? "No AI provider is configured. " : ""}
                {e.error}
                {e.groupKey ? (
                  <Button size="sm" variant="ghost" className="ml-2 h-6 text-xs underline" disabled={busy !== null} onClick={() => writeManually(e.groupKey)} data-testid={`btn-manual-${e.groupKey}`}>
                    Write it myself
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}

        {ws.recaps.length > 0 ? (
          <div className="space-y-2">
            {hasDirty ? (
              <p className="text-xs text-amber-800" data-testid="text-dirty-block">
                You have unsaved edits. Save them before publishing.
              </p>
            ) : null}
            <Button variant="outline" disabled={pending.length === 0 || hasDirty || busy !== null} onClick={publishAll} data-testid="btn-publish-all">
              {busy === "pub" ? "Publishing…" : `Publish ${pending.length} saved draft${pending.length === 1 ? "" : "s"}`}
            </Button>
            {pubErrors.length > 0 ? (
              <ul className="space-y-1" data-testid="list-publish-errors">
                {pubErrors.map((e, i) => (
                  <li key={i} className="rounded-md border border-red-300 bg-red-50 p-2 text-xs">
                    <span className="font-bold">{name(e.id)}:</span> {e.error}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground" data-testid="text-no-recaps">No recaps yet. Press the button above to draft one per bracket.</p>
        )}

        <div className="space-y-3">
          {ws.recaps.map((r) => (
            <details key={r.id} className="rounded-xl border p-2" open={expanded.has(r.id)}>
              <summary className="cursor-pointer text-sm font-bold" onClick={(event) => {
                event.preventDefault();
                setExpanded(prev => {
                  const next = new Set(prev);
                  if (next.has(r.id)) next.delete(r.id);
                  else next.add(r.id);
                  return next;
                });
              }}>{label(r.bracketId)} {r.published ? "(published)" : "(draft)"}</summary>
              <RecapEditor cid={cid} recap={r} label={label(r.bracketId)} onDirty={setDirty} disabled={busy !== null} />
            </details>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
