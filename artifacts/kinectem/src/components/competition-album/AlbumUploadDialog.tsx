import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, ImagePlus, Loader2, RotateCw, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { classifyImageFile } from "@/lib/shrinkImage";
import {
  ALBUM_MAX_BATCH,
  completeBatch,
  createBatch,
  errText,
  invalidateAlbums,
  newClientId,
  uploadOne,
  type AlbumTeam,
  type UploadItem,
} from "@/lib/competitionAlbum";
import { useQueryClient } from "@tanstack/react-query";

type BatchState = {
  clientBatchId: string;
  batchId: string | null;
  completed: boolean;
  submittedCount: number | null;
};

const freshBatch = (): BatchState => ({
  clientBatchId: newClientId(),
  batchId: null,
  completed: false,
  submittedCount: null,
});

export function AlbumUploadDialog({
  open,
  onOpenChange,
  competitionId,
  teams,
  isAdmin,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  competitionId: string;
  teams: AlbumTeam[];
  isAdmin: boolean;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const taggable = teams.filter((t) => t.canTag);
  const [items, setItems] = useState<UploadItem[]>([]);
  const itemsRef = useRef<UploadItem[]>([]);
  const batchRef = useRef<BatchState>(freshBatch());
  const [batch, setBatch] = useState<BatchState>(batchRef.current);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [finalizeError, setFinalizeError] = useState<string | null>(null);
  const [batchError, setBatchError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const defaultedRef = useRef(false);

  // Default-tag the viewer's own team when it is the only option.
  useEffect(() => {
    if (open && !defaultedRef.current && taggable.length === 1) {
      defaultedRef.current = true;
      setTagIds([taggable[0].id]);
    }
  }, [open, taggable]);

  const setItemsBoth = (next: UploadItem[]) => {
    itemsRef.current = next;
    setItems(next);
  };
  const setBatchBoth = (b: BatchState) => {
    batchRef.current = b;
    setBatch(b);
  };
  const patchItem = (id: string, p: Partial<UploadItem>) =>
    setItemsBoth(itemsRef.current.map((i) => (i.id === id ? { ...i, ...p } : i)));

  const revokeAll = (list: UploadItem[]) =>
    list.forEach((i) => URL.revokeObjectURL(i.previewUrl));
  useEffect(() => () => revokeAll(itemsRef.current), []);

  const addFiles = (files: FileList | File[] | null) => {
    if (!files) return;
    const next = [...itemsRef.current];
    let skipped = 0;
    let capped = false;
    for (const f of Array.from(files)) {
      const cls = classifyImageFile(f);
      if (cls !== "supported") {
        skipped += 1;
        continue;
      }
      if (next.length >= ALBUM_MAX_BATCH) {
        capped = true;
        break;
      }
      next.push({
        id: newClientId(),
        file: f,
        previewUrl: URL.createObjectURL(f),
        status: "queued",
        progress: 0,
        clientPhotoId: newClientId(),
      });
    }
    setItemsBoth(next);
    if (skipped > 0)
      toast({
        title: `${skipped} file${skipped === 1 ? "" : "s"} skipped`,
        description: "Only JPEG, PNG, WebP or GIF photos can be added.",
        variant: "destructive",
      });
    if (capped)
      toast({
        title: `Up to ${ALBUM_MAX_BATCH} photos per batch`,
        description: "Upload this batch, then add more.",
        variant: "destructive",
      });
    if (inputRef.current) inputRef.current.value = "";
  };

  const removeItem = (id: string) => {
    const gone = itemsRef.current.find((i) => i.id === id);
    if (gone) URL.revokeObjectURL(gone.previewUrl);
    setItemsBoth(itemsRef.current.filter((i) => i.id !== id));
  };

  const finalize = async (): Promise<boolean> => {
    const b = batchRef.current;
    if (!b.batchId || b.completed) return true;
    const doneHere = itemsRef.current.filter(
      (i) => i.status === "done" && i.batchKey === b.clientBatchId,
    ).length;
    if (doneHere === 0) return true;
    try {
      const r = await completeBatch(competitionId, b.batchId);
      setBatchBoth({ ...b, completed: true, submittedCount: r.submittedCount });
      setFinalizeError(null);
      return true;
    } catch (err) {
      setFinalizeError(errText(err, "Couldn’t finish the submission."));
      return false;
    }
  };

  const start = async () => {
    if (running) return;
    setRunning(true);
    setBatchError(null);
    try {
      if (batchRef.current.completed) setBatchBoth(freshBatch());
      let b = batchRef.current;
      if (!b.batchId) {
        try {
          const created = await createBatch(competitionId, b.clientBatchId);
          b = { ...b, batchId: created.id };
          setBatchBoth(b);
        } catch (err) {
          setBatchError(errText(err, "Couldn’t start the upload."));
          return;
        }
      }
      const queue = itemsRef.current.filter(
        (i) => i.status === "queued" || i.status === "failed",
      );
      const batchId = b.batchId as string;
      const key = b.clientBatchId;
      let cursor = 0;
      const worker = async () => {
        while (cursor < queue.length) {
          const base = queue[cursor++];
          const fresh = () =>
            itemsRef.current.find((i) => i.id === base.id) ?? base;
          await uploadOne(
            competitionId,
            batchId,
            key,
            fresh(),
            tagIds,
            (p) => patchItem(base.id, p),
          );
        }
      };
      await Promise.all([worker(), worker(), worker()]);
      const ok = await finalize();
      await invalidateAlbums(qc);
      if (ok) {
        const failed = itemsRef.current.filter((i) => i.status === "failed").length;
        if (failed === 0)
          toast({
            title: isAdmin ? "Photos added to the album" : "Photos submitted",
            description: isAdmin
              ? undefined
              : "Your photos will be pending until a competition admin approves them.",
          });
      }
    } finally {
      setRunning(false);
    }
  };

  const retryFailed = () => {
    // Completed batch -> failed files go into a brand-new batch with new ids.
    if (batchRef.current.completed) {
      setBatchBoth(freshBatch());
      setItemsBoth(
        itemsRef.current.map((i) =>
          i.status === "failed"
            ? {
                ...i,
                status: "queued",
                progress: 0,
                error: undefined,
                clientPhotoId: newClientId(),
                photoId: undefined,
                uploaded: false,
              }
            : i,
        ),
      );
    } else {
      setItemsBoth(
        itemsRef.current.map((i) =>
          i.status === "failed" ? { ...i, status: "queued", error: undefined } : i,
        ),
      );
    }
    void start();
  };

  const retryFinalize = async () => {
    setRunning(true);
    const ok = await finalize();
    if (ok) await invalidateAlbums(qc);
    setRunning(false);
  };

  const close = (o: boolean) => {
    if (!o && running) return;
    if (!o) {
      revokeAll(itemsRef.current);
      setItemsBoth([]);
      setBatchBoth(freshBatch());
      setFinalizeError(null);
      setBatchError(null);
      defaultedRef.current = false;
      setTagIds([]);
    }
    onOpenChange(o);
  };

  const doneCount = items.filter((i) => i.status === "done").length;
  const failedCount = items.filter((i) => i.status === "failed").length;
  const queuedCount = items.filter((i) => i.status === "queued").length;
  const total = items.length;
  const overall = total
    ? Math.round(items.reduce((s, i) => s + (i.status === "done" ? 100 : i.progress), 0) / total)
    : 0;
  const started = doneCount + failedCount > 0 || running;
  const needsFinalize = !!batch.batchId && !batch.completed && doneCount > 0 && !running && queuedCount === 0;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl" data-testid="dialog-album-upload">
        <DialogHeader>
          <DialogTitle className="font-black tracking-tight">Add photos to the album</DialogTitle>
          <DialogDescription>
            {isAdmin
              ? "Photos you add as a competition admin are approved immediately."
              : "Your photos will be pending until a competition admin approves them."}
          </DialogDescription>
        </DialogHeader>

        {!isAdmin && (
          <p
            className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-950"
            data-testid="text-pending-copy"
          >
            Your photos will be pending until a competition admin approves them.
          </p>
        )}

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            addFiles(e.dataTransfer.files);
          }}
          className={`flex flex-col items-center gap-2 rounded-xl border-2 border-dashed p-5 text-center transition-colors ${
            dragging ? "border-primary bg-primary/5" : "border-border bg-muted/30"
          }`}
        >
          <ImagePlus className="h-6 w-6 text-muted-foreground" />
          <p className="text-sm font-bold">Drop photos here or choose from your device</p>
          <p className="text-xs text-muted-foreground">
            Up to {ALBUM_MAX_BATCH} photos at a time. Large phone photos are resized automatically.
          </p>
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif"
            multiple
            className="sr-only"
            id="album-bulk-files"
            onChange={(e) => addFiles(e.target.files)}
            data-testid="input-album-bulk-files"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="font-bold"
            disabled={running}
            onClick={() => inputRef.current?.click()}
            data-testid="button-choose-photos"
          >
            Choose photos
          </Button>
        </div>

        {taggable.length > 0 && (
          <fieldset className="space-y-1.5" disabled={running || started}>
            <legend className="text-xs font-bold">
              Tag teams <span className="font-normal text-muted-foreground">(optional)</span>
            </legend>
            <div className="flex flex-wrap gap-2">
              {taggable.map((t) => {
                const on = tagIds.includes(t.id);
                return (
                  <label
                    key={t.id}
                    className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold ${
                      on ? "border-primary bg-primary/10" : "border-border"
                    }`}
                  >
                    <Checkbox
                      checked={on}
                      onCheckedChange={(v) =>
                        setTagIds((prev) =>
                          v ? [...prev, t.id] : prev.filter((x) => x !== t.id),
                        )
                      }
                    />
                    {t.name}
                  </label>
                );
              })}
            </div>
          </fieldset>
        )}

        {total > 0 && (
          <div className="space-y-3">
            <div className="space-y-1" aria-live="polite">
              <div className="flex items-center justify-between text-xs font-bold">
                <span data-testid="text-upload-summary">
                  {doneCount} of {total} uploaded
                  {failedCount > 0 && ` · ${failedCount} failed`}
                </span>
                <span>{overall}%</span>
              </div>
              <div
                className="h-2 overflow-hidden rounded-full bg-muted"
                role="progressbar"
                aria-valuenow={overall}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Overall upload progress"
              >
                <div
                  className="h-full origin-left bg-primary transition-transform"
                  style={{ transform: `scaleX(${overall / 100})` }}
                />
              </div>
            </div>
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {items.map((i) => (
                <li key={i.id} className="relative aspect-square overflow-hidden rounded-lg bg-muted" data-testid={`upload-item-${i.id}`}>
                  <img src={i.previewUrl} alt={i.file.name} className="h-full w-full object-cover" />
                  {(i.status === "uploading" || i.status === "preparing") && (
                    <div className="absolute inset-0 flex flex-col items-center justify-end bg-black/30 p-1">
                      <Loader2 className="mb-auto mt-2 h-4 w-4 animate-spin text-white" />
                      <div className="h-1 w-full overflow-hidden rounded bg-white/40">
                        <div className="h-full bg-white" style={{ width: `${i.progress}%` }} />
                      </div>
                    </div>
                  )}
                  {i.status === "done" && (
                    <CheckCircle2 className="absolute bottom-1 right-1 h-5 w-5 rounded-full bg-white text-emerald-600" />
                  )}
                  {i.status === "failed" && (
                    <div className="absolute inset-0 flex flex-col justify-end bg-rose-900/70 p-1 text-white">
                      <AlertTriangle className="mb-auto h-4 w-4" />
                      <span className="line-clamp-2 text-[10px] font-bold leading-tight">{i.error ?? "Failed"}</span>
                    </div>
                  )}
                  {(i.status === "queued" || i.status === "failed") && !running && (
                    <button
                      type="button"
                      onClick={() => removeItem(i.id)}
                      aria-label={`Remove ${i.file.name}`}
                      className="absolute right-1 top-1 rounded-full bg-black/70 p-1 text-white"
                      data-testid={`button-remove-upload-${i.id}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {batchError && (
          <p role="alert" className="text-sm font-medium text-destructive">{batchError}</p>
        )}
        {finalizeError && (
          <div role="alert" className="flex flex-wrap items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
            <span className="flex-1 font-medium text-destructive">
              Your photos uploaded, but we couldn’t finish the submission: {finalizeError}
            </span>
            <Button size="sm" onClick={retryFinalize} disabled={running} data-testid="button-retry-finalize">
              Retry finishing
            </Button>
          </div>
        )}
        {batch.completed && (
          <p className="text-sm font-medium text-emerald-700" role="status" data-testid="text-batch-complete">
            {isAdmin
              ? `${batch.submittedCount ?? doneCount} photos added to the album.`
              : `${batch.submittedCount ?? doneCount} photos submitted for approval.`}
          </p>
        )}

        <div className="flex flex-wrap justify-end gap-2">
          {failedCount > 0 && !running && (
            <Button variant="outline" className="gap-1 font-bold" onClick={retryFailed} data-testid="button-retry-failed">
              <RotateCw className="h-3.5 w-3.5" />
              Retry {failedCount} failed
            </Button>
          )}
          {needsFinalize && !finalizeError && (
            <Button variant="outline" onClick={retryFinalize} className="font-bold">
              Finish submission
            </Button>
          )}
          {batch.completed && failedCount === 0 ? (
            <Button variant="brand" onClick={() => close(false)} data-testid="button-album-done">
              Done
            </Button>
          ) : (
            <Button
              variant="brand"
              onClick={start}
              disabled={running || queuedCount === 0}
              data-testid="button-start-upload"
            >
              {running ? "Uploading…" : `Upload ${queuedCount || ""} photo${queuedCount === 1 ? "" : "s"}`.trim()}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
