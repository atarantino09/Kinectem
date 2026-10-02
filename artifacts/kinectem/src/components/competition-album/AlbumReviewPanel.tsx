import { useMemo, useState } from "react";
import { Check, Maximize2, Tags, Undo2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { timeAgo } from "@/lib/format";
import {
  errText,
  useReviewPhotos,
  useSetPhotoTags,
  type AlbumPhoto,
  type AlbumStatus,
  type AlbumTeam,
} from "@/lib/competitionAlbum";

export function AlbumReviewPanel({
  competitionId,
  status,
  photos,
  teams,
  onOpen,
}: {
  competitionId: string;
  status: AlbumStatus;
  photos: AlbumPhoto[];
  teams: AlbumTeam[];
  onOpen: (photo: AlbumPhoto) => void;
}) {
  const { toast } = useToast();
  const review = useReviewPhotos(competitionId);
  const setTags = useSetPhotoTags(competitionId);
  const [uploader, setUploader] = useState("all");
  const [batch, setBatch] = useState("all");
  const [team, setTeam] = useState("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [tagOpen, setTagOpen] = useState(false);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [report, setReport] = useState<string | null>(null);

  const uploaders = useMemo(
    () => Array.from(new Set(photos.map((p) => p.uploadedByName))).sort(),
    [photos],
  );
  const batches = useMemo(() => {
    const map = new Map<string, AlbumPhoto[]>();
    for (const p of photos) map.set(p.batchId, [...(map.get(p.batchId) ?? []), p]);
    return Array.from(map.entries()).map(([id, list], i) => ({
      id,
      label: `Batch ${i + 1} · ${list[0].uploadedByName} · ${list.length}`,
    }));
  }, [photos]);

  const visible = photos.filter(
    (p) =>
      (uploader === "all" || p.uploadedByName === uploader) &&
      (batch === "all" || p.batchId === batch) &&
      (team === "all" || p.teamIds.includes(team)),
  );
  const selectedVisible = visible.filter((p) => selected.has(p.id));
  const ids = Array.from(selected).filter((id) => photos.some((p) => p.id === id));

  const toggle = (id: string) =>
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const run = async (action: "approve" | "reject") => {
    if (ids.length === 0) return;
    setReport(null);
    try {
      const r = await review.mutateAsync({ photoIds: ids, action, expectedStatus: status });
      const parts = [`${r.changedIds.length} updated`];
      if (r.conflictIds.length > 0)
        parts.push(`${r.conflictIds.length} skipped — another reviewer already changed them`);
      setReport(parts.join(", "));
      setSelected(new Set(r.conflictIds));
      toast({
        title: parts[0],
        description: parts[1],
        variant: r.conflictIds.length ? "destructive" : undefined,
      });
    } catch (err) {
      setReport(`Nothing was changed: ${errText(err)}`);
      toast({ title: "Couldn’t update photos", description: errText(err), variant: "destructive" });
    }
  };

  const applyTags = async () => {
    try {
      await setTags.mutateAsync({ photoIds: ids, teamIds: tagIds });
      setReport(`Team tags set on ${ids.length} photo${ids.length === 1 ? "" : "s"}`);
      setTagOpen(false);
    } catch (err) {
      toast({ title: "Couldn’t update tags", description: errText(err), variant: "destructive" });
    }
  };

  const busy = review.isPending || setTags.isPending;

  return (
    <div className="space-y-3" data-testid={`review-panel-${status}`}>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Filter label="Uploader" value={uploader} onChange={setUploader} options={uploaders.map((u) => ({ value: u, label: u }))} />
        <Filter label="Batch" value={batch} onChange={setBatch} options={batches.map((b) => ({ value: b.id, label: b.label }))} />
        <Filter label="Team" value={team} onChange={setTeam} options={teams.map((t) => ({ value: t.id, label: t.name }))} />
      </div>

      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-xl border bg-card/95 p-2 backdrop-blur">
        <Button size="sm" variant="outline" className="font-bold" onClick={() => setSelected(new Set([...selected, ...visible.map((p) => p.id)]))} disabled={visible.length === 0} data-testid="button-select-visible">
          Select visible ({visible.length})
        </Button>
        {batch !== "all" && (
          <Button size="sm" variant="outline" className="font-bold" onClick={() => setSelected(new Set([...selected, ...photos.filter((p) => p.batchId === batch).map((p) => p.id)]))} data-testid="button-select-batch">
            Select batch
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())} disabled={selected.size === 0}>
          Clear
        </Button>
        <span className="ml-auto text-xs font-bold" aria-live="polite" data-testid="text-selected-count">
          {ids.length} selected
        </span>
        {status !== "approved" && (
          <Button size="sm" variant="brand" className="gap-1 font-bold" disabled={ids.length === 0 || busy} onClick={() => run("approve")} data-testid="button-bulk-approve">
            <Check className="h-4 w-4" />
            Approve
          </Button>
        )}
        {status === "pending" && (
          <Button size="sm" variant="outline" className="gap-1 border-destructive/50 font-bold text-destructive" disabled={ids.length === 0 || busy} onClick={() => run("reject")} data-testid="button-bulk-reject">
            <X className="h-4 w-4" />
            Reject
          </Button>
        )}
        {status === "approved" && (
          <Button size="sm" variant="outline" className="gap-1 border-destructive/50 font-bold text-destructive" disabled={ids.length === 0 || busy} onClick={() => run("reject")} data-testid="button-bulk-withdraw">
            <Undo2 className="h-4 w-4" />
            Withdraw approval
          </Button>
        )}
        <Button size="sm" variant="outline" className="gap-1 font-bold" disabled={ids.length === 0 || busy} onClick={() => setTagOpen((v) => !v)} aria-expanded={tagOpen} data-testid="button-bulk-tag">
          <Tags className="h-4 w-4" />
          Team tags
        </Button>
      </div>

      {tagOpen && (
        <div className="space-y-2 rounded-xl border bg-muted/30 p-3">
          <p className="text-xs font-bold">Set tags for {ids.length} selected photo{ids.length === 1 ? "" : "s"} (replaces existing tags)</p>
          <div className="flex flex-wrap gap-2">
            {teams.map((t) => (
              <label key={t.id} className="flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold">
                <Checkbox
                  checked={tagIds.includes(t.id)}
                  onCheckedChange={(v) => setTagIds((prev) => (v ? [...prev, t.id] : prev.filter((x) => x !== t.id)))}
                />
                {t.name}
              </label>
            ))}
            {teams.length === 0 && <span className="text-xs text-muted-foreground">No participating teams yet.</span>}
          </div>
          <Button size="sm" variant="brand" onClick={applyTags} disabled={busy || ids.length === 0} data-testid="button-apply-tags">
            Apply tags
          </Button>
        </div>
      )}

      {report && (
        <p role="status" className="rounded-lg border bg-muted/40 px-3 py-2 text-sm font-medium" data-testid="text-review-report">
          {report}
        </p>
      )}

      {visible.length === 0 ? (
        <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          {photos.length === 0 ? `No ${status} photos right now.` : "No photos match these filters."}
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {visible.map((p) => {
            const on = selected.has(p.id);
            return (
              <li key={p.id} className={`overflow-hidden rounded-xl border bg-card ${on ? "ring-2 ring-primary" : ""}`} data-testid={`review-tile-${p.id}`}>
                <div className="relative aspect-[4/3] bg-muted">
                  <img src={p.url} alt={`Submitted by ${p.uploadedByName}`} loading="lazy" className="h-full w-full object-cover" />
                  <label className="absolute left-1.5 top-1.5 flex h-7 w-7 cursor-pointer items-center justify-center rounded-md bg-white/90 shadow">
                    <Checkbox checked={on} onCheckedChange={() => toggle(p.id)} aria-label={`Select photo by ${p.uploadedByName}`} />
                  </label>
                  <button type="button" onClick={() => onOpen(p)} aria-label="Enlarge photo" className="absolute right-1.5 top-1.5 rounded-md bg-black/60 p-1.5 text-white">
                    <Maximize2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="space-y-0.5 p-2 text-xs">
                  <p className="truncate font-bold">{p.uploadedByName}</p>
                  <p className="truncate text-muted-foreground">
                    {timeAgo(p.createdAt)}
                    {p.teamNames.length > 0 ? ` · ${p.teamNames.join(", ")}` : " · no team tags"}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {selectedVisible.length !== ids.length && ids.length > 0 && (
        <p className="text-xs text-muted-foreground">{ids.length - selectedVisible.length} selected photos are hidden by filters.</p>
      )}
    </div>
  );
}

function Filter({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="space-y-1">
      <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{label}</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger aria-label={`Filter by ${label.toLowerCase()}`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All</SelectItem>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
