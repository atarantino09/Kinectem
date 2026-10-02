import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { apiErrorMessage } from "@/lib/api-errors";
import { ClippingViewer } from "@/components/historical/ClippingViewer";
import {
  buildPayload,
  checkClipDimensions,
  checkClipFile,
  getHistorical,
  MAX_CLIP_BYTES,
  validateHistorical,
  type HistoricalFormState,
} from "@/lib/historical";

const EMPTY: HistoricalFormState = {
  title: "",
  body: "",
  coverImageUrl: null,
  dateMode: "exact",
  gameDate: "",
  year: "",
  newspaper: "",
  byline: "",
  publicationDate: "",
};

function readDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("Couldn't read the image."));
    r.readAsDataURL(file);
  });
}

function imageSize(dataUrl: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => reject(new Error("Couldn't read the image."));
    img.src = dataUrl;
  });
}

export default function HistoricalRecapPage() {
  const search = useSearch();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const sp = useMemo(() => new URLSearchParams(search ?? ""), [search]);
  const teamId = sp.get("teamId");
  const organizationId = sp.get("organizationId");
  const initialPostId = sp.get("postId");
  type Scope = { teamId: string } | { organizationId: string };
  const queryScope: Scope | null = teamId
    ? { teamId }
    : organizationId
      ? { organizationId }
      : null;
  // Existing posts: scope comes from the server (post.context) only.
  const [scope, setScope] = useState<Scope | null>(
    initialPostId ? null : queryScope,
  );
  const [dest, setDest] = useState<
    | { state: "loading" }
    | { state: "ok"; name: string }
    | { state: "forbidden" }
    | { state: "error"; message: string }
  >({ state: "loading" });
  const [destTick, setDestTick] = useState(0);
  const scopeRef = useRef<Scope | null>(scope);
  scopeRef.current = scope;

  const [postId, setPostId] = useState<string | null>(initialPostId);
  const [form, setForm] = useState<HistoricalFormState>(EMPTY);
  const [rights, setRights] = useState(false);
  const [consent, setConsent] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [loading, setLoading] = useState(!!initialPostId);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [status, setStatus] = useState<"published" | "draft" | "pending_approval" | null>(null);
  const [uploading, setUploading] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saved" | "dirty" | "error">("idle");
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const originalDataUrl = useRef<string | null>(null);
  const hydrated = useRef(!initialPostId);
  const touched = useRef(false);
  const postIdRef = useRef(postId);
  postIdRef.current = postId;
  const inflight = useRef<Promise<string | null> | null>(null);
  const version = useRef(0);
  const savedVersion = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ form, rights, reviewed });
  latest.current = { form, rights, reviewed };

  // Hydrate from the existing post (draft resume / published edit).
  useEffect(() => {
    if (!initialPostId) return;
    let alive = true;
    customFetch<Record<string, unknown>>(`/api/v1/posts/${initialPostId}`).then(
      (p) => {
        if (!alive) return;
        const h = getHistorical(p);
        if (!h) {
          setLoadError("This post is not a historical recap.");
          setLoading(false);
          return;
        }
        const ctx = p.context as { type?: string; id?: string } | undefined;
        if (!ctx?.id) {
          setLoadError("We couldn't determine where this recap belongs.");
          setLoading(false);
          return;
        }
        setScope(
          ctx.type === "organization"
            ? { organizationId: ctx.id }
            : { teamId: ctx.id },
        );
        const assets = (p.assets as Array<{ url?: string | null; fileType?: string }> | undefined) ?? [];
        const img = assets.find((a) => a.fileType?.startsWith("image/"))?.url ?? null;
        setForm({
          title: (p.title as string) ?? "",
          body: (p.body as string) ?? "",
          coverImageUrl: ((p.coverImageUrl as string | undefined) ?? img) || null,
          dateMode: h.gameDate || !h.year ? "exact" : "year",
          gameDate: h.gameDate ?? "",
          year: h.year ? String(h.year) : "",
          newspaper: h.newspaper ?? "",
          byline: h.byline ?? "",
          publicationDate: h.publicationDate ?? "",
        });
        setRights(h.rightsConfirmed);
        setReviewed(h.reviewed);
        setStatus((p.articleStatus as typeof status) ?? null);
        hydrated.current = true;
        setLoading(false);
      },
      (err) => {
        if (!alive) return;
        setLoadError(apiErrorMessage(err) ?? "We couldn't load this recap.");
        setLoading(false);
      },
    );
    return () => {
      alive = false;
    };
  }, [initialPostId]);

  const scopeKey = scope ? JSON.stringify(scope) : null;
  useEffect(() => {
    if (!scopeKey) return;
    const sc = JSON.parse(scopeKey) as Record<string, string>;
    let alive = true;
    setDest({ state: "loading" });
    const qs = new URLSearchParams(sc).toString();
    customFetch<{ name: string }>(
      `/api/v1/historical-recaps/destination?${qs}`,
    ).then(
      (d) => alive && setDest({ state: "ok", name: d.name }),
      (err) => {
        if (!alive) return;
        const status = (err as { status?: number })?.status;
        setDest(
          status === 403 || status === 404
            ? { state: "forbidden" }
            : { state: "error", message: apiErrorMessage(err) ?? "Couldn't verify the destination." },
        );
      },
    );
    return () => {
      alive = false;
    };
  }, [scopeKey, destTick]);

  const writeSnapshot = async (snap: {
    form: HistoricalFormState;
    rights: boolean;
    reviewed: boolean;
  }): Promise<string | null> => {
    const payload = buildPayload(snap.form, snap.rights, snap.reviewed);
    const existing = postIdRef.current;
    if (existing) {
      await customFetch(`/api/v1/historical-recaps/${existing}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      return existing;
    }
    const created = await customFetch<{ id: string }>(
      "/api/v1/historical-recaps",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...scopeRef.current, ...payload }),
      },
    );
    postIdRef.current = created.id;
    setPostId(created.id);
    setStatus("draft");
    return created.id;
  };

  // Serialized save: one write at a time; edits made during an in-flight
  // write are saved by a follow-up write using the latest snapshot.
  // Resolves to the post id once everything up to now is persisted, or
  // null if it could not be persisted.
  const save = useCallback(async (): Promise<string | null> => {
    for (;;) {
      while (inflight.current) {
        await inflight.current.catch(() => null);
      }
      if (savedVersion.current === version.current && postIdRef.current) {
        return postIdRef.current;
      }
      const snap = latest.current;
      if (!snap.form.title.trim() || !scopeRef.current) return null;
      const v = version.current;
      setSaving(true);
      const run = writeSnapshot(snap);
      inflight.current = run;
      try {
        const id = await run;
        savedVersion.current = v;
        setSaveState(v === version.current ? "saved" : "dirty");
        if (v === version.current) return id;
      } catch (err) {
        setSaveState("error");
        toast({
          title: "Couldn't save",
          description: apiErrorMessage(err) ?? "Please try again.",
          variant: "destructive",
        });
        return null;
      } finally {
        inflight.current = null;
        setSaving(false);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast]);

  const markDirty = () => {
    touched.current = true;
    version.current += 1;
    setSaveState("dirty");
  };

  // Autosave: ref-based debounce, only after the user touched something
  // and the existing post has hydrated. Published posts are saved manually.
  useEffect(() => {
    if (!touched.current || !hydrated.current) return;
    if (status === "published" || status === "pending_approval") return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), 1500);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [form, rights, reviewed, save, status]);

  const edit = (patch: Partial<HistoricalFormState>, resetsReview = false) => {
    markDirty();
    setForm((f) => ({ ...f, ...patch }));
    if (resetsReview) setReviewed(false);
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const bad = checkClipFile(file);
    if (bad) {
      toast({ title: "Can't use that image", description: bad, variant: "destructive" });
      return;
    }
    setUploading(true);
    try {
      const dataUrl = await readDataUrl(file);
      const { w, h } = await imageSize(dataUrl);
      const dimBad = checkClipDimensions(w, h);
      if (dimBad) {
        toast({ title: "Can't use that image", description: dimBad, variant: "destructive" });
        return;
      }
      const stored = await customFetch<{ url: string }>(
        "/api/v1/historical-recaps/clipping",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...scopeRef.current, imageDataUrl: dataUrl }),
        },
      );
      originalDataUrl.current = dataUrl;
      edit({ coverImageUrl: stored.url }, true);
    } catch (err) {
      toast({
        title: "Couldn't upload that image",
        description: apiErrorMessage(err) ?? "Check your connection and try again.",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  };

  const runExtract = async () => {
    if (!rights || !consent || uploading || extracting) return;
    setConfirmReplace(false);
    setExtracting(true);
    setExtractError(null);
    try {
      let dataUrl = originalDataUrl.current;
      if (!dataUrl && form.coverImageUrl) {
        const blob = await (await fetch(form.coverImageUrl, { credentials: "include" })).blob();
        const bad = checkClipFile(blob);
        if (bad) throw new Error(bad);
        dataUrl = await readDataUrl(blob);
        const { w, h } = await imageSize(dataUrl);
        const dimBad = checkClipDimensions(w, h);
        if (dimBad) throw new Error(dimBad);
        originalDataUrl.current = dataUrl;
      }
      if (!dataUrl) throw new Error("Add a clipping first.");
      const res = await customFetch<{ text: string }>("/api/v1/ai/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...scopeRef.current,
          imageDataUrl: dataUrl,
          rightsConfirmed: true,
          providerConsent: true,
        }),
      });
      edit({ body: res.text }, true);
    } catch (err) {
      setExtractError(
        `${apiErrorMessage(err) ?? (err instanceof Error ? err.message : "Extraction failed.")} Your image is kept. You can type the text by hand.`,
      );
    } finally {
      setExtracting(false);
    }
  };

  const onExtract = () => {
    if (!rights || !consent || uploading || extracting) return;
    if (form.body.trim()) setConfirmReplace(true);
    else void runExtract();
  };

  const onPublish = async () => {
    setFormError(null);
    const err = validateHistorical(form);
    if (err) return setFormError(err);
    if (!form.coverImageUrl) return setFormError("Add the clipping image.");
    if (!form.body.trim()) return setFormError("Add the transcript text.");
    if (!rights) return setFormError("Confirm you have permission to share this clipping.");
    if (!reviewed) return setFormError("Confirm you reviewed the transcript.");
    setPublishing(true);
    try {
      if (timer.current) clearTimeout(timer.current);
      const id = await save();
      if (!id) return;
      await customFetch(`/api/v1/posts/${id}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ historicalReviewed: true }),
      });
      toast({ title: "Historical recap published" });
      setLocation(`/posts/${id}`);
    } catch (e) {
      toast({
        title: "Couldn't publish",
        description: apiErrorMessage(e) ?? "Please try again.",
        variant: "destructive",
      });
    } finally {
      setPublishing(false);
    }
  };

  if (!queryScope && !initialPostId) {
    return (
      <div className="mx-auto max-w-2xl py-12 text-center" data-testid="historical-no-scope">
        <h1 className="text-2xl font-black">Choose a team or organization</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Start a Historical Recap from a team or organization page.
        </p>
        <Link href="/" className="mt-4 inline-block font-bold underline">
          Back to feed
        </Link>
      </div>
    );
  }
  if (loading) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <Skeleton className="h-10 w-1/2" />
        <Skeleton className="h-64" />
      </div>
    );
  }
  if (loadError) {
    return (
      <div className="mx-auto max-w-2xl py-12 text-center" data-testid="historical-load-error">
        <p className="font-bold">{loadError}</p>
        <Button className="mt-4" variant="outline" onClick={() => window.location.reload()}>
          Retry
        </Button>
      </div>
    );
  }

  if (dest.state === "loading" || !scope) {
    return (
      <div className="mx-auto max-w-3xl space-y-4" data-testid="historical-dest-loading">
        <Skeleton className="h-10 w-1/2" />
        <Skeleton className="h-40" />
      </div>
    );
  }
  if (dest.state === "forbidden") {
    return (
      <div className="mx-auto max-w-2xl py-12 text-center" data-testid="historical-forbidden">
        <h1 className="text-2xl font-black">You can't author here</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          You don't have permission to publish Historical Recaps for this destination.
        </p>
        <Link href="/" className="mt-4 inline-block font-bold underline">Back to feed</Link>
      </div>
    );
  }
  if (dest.state === "error") {
    return (
      <div className="mx-auto max-w-2xl py-12 text-center" data-testid="historical-dest-error">
        <p className="font-bold">{dest.message}</p>
        <Button className="mt-4" variant="outline" onClick={() => setDestTick((t) => t + 1)}>Retry</Button>
      </div>
    );
  }

  const isPublished = status === "published" || status === "pending_approval";
  const field = "space-y-1";
  const lbl = "text-xs font-bold uppercase tracking-wide text-muted-foreground";

  return (
    <div className="mx-auto max-w-3xl space-y-6" data-testid="historical-composer">
      <div>
        <h1 className="text-3xl font-black tracking-tight">Historical Recap</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Share a past game from a newspaper clipping. The transcript stays faithful to the original wording.
        </p>
        <p className="mt-1 text-sm font-bold" data-testid="text-destination">
          Posting to: {dest.name}
        </p>
        <p className="mt-1 text-xs font-semibold text-muted-foreground" data-testid="text-save-state">
          {saving
            ? "Saving..."
            : saveState === "saved"
              ? "Draft saved"
              : saveState === "dirty"
                ? "Unsaved changes"
              : saveState === "error"
                ? "Not saved"
                : isPublished
                  ? "Published"
                  : "Draft"}
        </p>
      </div>

      <div className={field}>
        <label className={lbl} htmlFor="hr-title">Title</label>
        <Input id="hr-title" value={form.title} onChange={(e) => edit({ title: e.target.value })} data-testid="input-historical-title" />
      </div>

      <fieldset className="space-y-2">
        <legend className={lbl}>When was the game played</legend>
        <div className="flex gap-4 text-sm">
          <label className="flex items-center gap-1.5">
            <input type="radio" name="dm" checked={form.dateMode === "exact"} onChange={() => edit({ dateMode: "exact" })} data-testid="radio-date-exact" />
            Exact date
          </label>
          <label className="flex items-center gap-1.5">
            <input type="radio" name="dm" checked={form.dateMode === "year"} onChange={() => edit({ dateMode: "year" })} data-testid="radio-date-year" />
            Year only
          </label>
        </div>
        {form.dateMode === "exact" ? (
          <Input type="date" aria-label="Game date" value={form.gameDate} onChange={(e) => edit({ gameDate: e.target.value })} data-testid="input-historical-game-date" />
        ) : (
          <Input type="number" inputMode="numeric" aria-label="Year" placeholder="e.g. 1974" value={form.year} onChange={(e) => edit({ year: e.target.value })} data-testid="input-historical-year" />
        )}
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className={field}>
          <label className={lbl} htmlFor="hr-paper">Newspaper (optional)</label>
          <Input id="hr-paper" value={form.newspaper} onChange={(e) => edit({ newspaper: e.target.value })} data-testid="input-historical-newspaper" />
        </div>
        <div className={field}>
          <label className={lbl} htmlFor="hr-by">Byline (optional)</label>
          <Input id="hr-by" value={form.byline} onChange={(e) => edit({ byline: e.target.value })} data-testid="input-historical-byline" />
        </div>
        <div className={field}>
          <label className={lbl} htmlFor="hr-pub">Publication date (optional)</label>
          <Input id="hr-pub" type="date" value={form.publicationDate} onChange={(e) => edit({ publicationDate: e.target.value })} data-testid="input-historical-publication-date" />
        </div>
      </div>

      <section className="space-y-3 rounded-lg border p-4">
        <h2 className="font-black">Clipping</h2>
        {form.coverImageUrl && (
          <ClippingViewer src={form.coverImageUrl} alt="Uploaded clipping" postId={postId ?? "new"} />
        )}
        <Input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          disabled={uploading || extracting || publishing}
          aria-label="Upload clipping image"
          onChange={(e) => {
            void onFile(e.target.files?.[0]);
            e.target.value = "";
          }}
          data-testid="input-historical-image"
        />
        <p className="text-xs text-muted-foreground">
          JPEG, PNG, or WebP, up to {MAX_CLIP_BYTES / 1024 / 1024} MB and 8000 pixels per side. PDFs are not supported.
        </p>
        {uploading && <p className="text-sm font-semibold">Uploading...</p>}

        <label className="flex items-start gap-2 text-sm">
          <Checkbox checked={rights} onCheckedChange={(v) => { markDirty(); setRights(v === true); if (v !== true) setReviewed(false); }} data-testid="checkbox-rights" />
          <span>I have permission to share this clipping.</span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <Checkbox checked={consent} onCheckedChange={(v) => setConsent(v === true)} data-testid="checkbox-provider-consent" />
          <span>I understand extracting text sends this image to the configured AI provider.</span>
        </label>
        <Button
          type="button"
          variant="outline"
          disabled={!form.coverImageUrl || !rights || !consent || extracting || uploading}
          onClick={onExtract}
          data-testid="button-extract-text"
        >
          {extracting ? "Extracting..." : "Extract text"}
        </Button>
        {extractError && (
          <div role="alert" className="text-sm text-destructive" data-testid="text-extract-error">
            {extractError}{" "}
            <button type="button" disabled={!rights || !consent || extracting || uploading} className="font-bold underline disabled:opacity-50" onClick={onExtract}>Retry</button>
          </div>
        )}
      </section>

      <div className={field}>
        <label className={lbl} htmlFor="hr-body">Transcript</label>
        <Textarea
          id="hr-body"
          rows={14}
          className="font-serif"
          value={form.body}
          readOnly={extracting}
          onChange={(e) => edit({ body: e.target.value }, true)}
          placeholder="Type or extract the article text. Mark unreadable passages as [unreadable]."
          data-testid="textarea-historical-body"
        />
      </div>

      <label className="flex items-start gap-2 text-sm">
        <Checkbox checked={reviewed} disabled={!form.body.trim() || extracting || uploading || publishing} onCheckedChange={(v) => { markDirty(); setReviewed(v === true); }} data-testid="checkbox-reviewed" />
        <span>I reviewed the transcript against the clipping.</span>
      </label>

      {formError && (
        <p role="alert" className="text-sm font-semibold text-destructive" data-testid="text-form-error">
          {formError}
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        <Button type="button" variant="outline" disabled={saving || !form.title.trim()} onClick={() => void save()} data-testid="button-save-draft">
          {isPublished ? "Save changes" : "Save draft"}
        </Button>
        {!isPublished && (
          <Button type="button" variant="brand" disabled={publishing || extracting || uploading} onClick={onPublish} data-testid="button-publish">
            {publishing ? "Publishing..." : "Publish"}
          </Button>
        )}
        {isPublished && postId && (
          <Link href={`/posts/${postId}`} className="self-center text-sm font-bold underline">
            View post
          </Link>
        )}
      </div>

      <AlertDialog open={confirmReplace} onOpenChange={setConfirmReplace}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace the existing text?</AlertDialogTitle>
            <AlertDialogDescription>
              Extracting will overwrite the transcript you have now.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep my text</AlertDialogCancel>
            <AlertDialogAction onClick={() => void runExtract()} data-testid="button-confirm-replace">
              Replace
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
