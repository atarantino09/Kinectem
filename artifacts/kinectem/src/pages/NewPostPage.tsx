import { useState, useEffect, useRef } from "react";
import { useLocation, useSearch } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  customFetch,
  useCreatePost,
  useGetLoggedInUser,
  useListUserOrganizations,
  getListFeedQueryKey,
  type CreatePostRequest,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ArrowLeft,
  FileText,
  Play,
  Save,
  Check,
  ImagePlus,
  X,
  Video,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type DraftPayload = {
  id: string;
  title?: string | null;
  description?: string | null;
  body?: string | null;
};

export default function NewPostPage() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const initialType = params.get("type") === "short" ? "short" : "long";
  const initialDraftId = params.get("draftId");
  const initialTeamId = params.get("teamId");
  const { toast } = useToast();

  const [postType, setPostType] = useState<"short" | "long">(initialType);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [orgId, setOrgId] = useState<string>("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [videoUrl, setVideoUrl] = useState("");
  const [draftId, setDraftId] = useState<string | null>(initialDraftId);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [saving, setSaving] = useState(false);

  const { data: me } = useGetLoggedInUser();
  const { data: myOrgs } = useListUserOrganizations(me?.id ?? "", undefined, {
    query: { enabled: !!me?.id && !initialTeamId } as never,
  });
  const createPost = useCreatePost();
  const qc = useQueryClient();
  const invalidateFeed = () =>
    qc.invalidateQueries({ queryKey: getListFeedQueryKey() });
  const lockedToTeam = !!initialTeamId;

  // Load existing draft
  useEffect(() => {
    if (!initialDraftId) return;
    customFetch<
      DraftPayload & { videoUrl?: string | null; photoUrls?: string[] | null }
    >(`/posts/${initialDraftId}`, { method: "GET" })
      .then((d) => {
        setTitle(d.title ?? "");
        setBody(d.body ?? "");
        setVideoUrl(d.videoUrl ?? "");
        setPhotos(Array.isArray(d.photoUrls) ? d.photoUrls : []);
        setPostType("long");
      })
      .catch(() => {
        toast({ title: "Couldn't load draft", variant: "destructive" });
      });
  }, [initialDraftId, toast]);

  // Auto-save (debounced) when we already have a draft id
  const debouncedRef = useRef<number | null>(null);
  useEffect(() => {
    if (!draftId) return;
    if (debouncedRef.current) window.clearTimeout(debouncedRef.current);
    debouncedRef.current = window.setTimeout(async () => {
      try {
        setSaving(true);
        await customFetch(`/posts/${draftId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: title || "Untitled",
            body,
            videoUrl: videoUrl || null,
            photoUrls: photos,
          }),
        });
        setSavedAt(new Date());
      } catch {
        // ignore
      } finally {
        setSaving(false);
      }
    }, 1200);
    return () => {
      if (debouncedRef.current) window.clearTimeout(debouncedRef.current);
    };
  }, [title, body, videoUrl, photos, draftId]);

  const isShort = postType === "short";
  const heading = isShort ? "New Highlight" : "New Game Recap";
  const Icon = isShort ? Play : FileText;

  const buildPayload = (status?: "draft"): CreatePostRequest => ({
    postType,
    title: title.trim() || undefined,
    body: !isShort && body.trim() ? body.trim() : undefined,
    organizationId: orgId || undefined,
    ...(initialTeamId
      ? ({ context: { type: "team", id: initialTeamId } } as object)
      : {}),
    ...(photos.length > 0
      ? ({ photoUrls: photos, coverImageUrl: photos[0] } as object)
      : {}),
    ...(videoUrl.trim() ? ({ videoUrl: videoUrl.trim() } as object) : {}),
    ...(status ? ({ status } as object) : {}),
  });

  const onPublish = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      toast({ title: "Add a title", variant: "destructive" });
      return;
    }
    try {
      if (draftId) {
        await customFetch(`/posts/${draftId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: title.trim() || "Untitled",
            body,
            videoUrl: videoUrl || null,
            photoUrls: photos,
          }),
        });
        await customFetch(`/posts/${draftId}/publish`, { method: "POST" });
        invalidateFeed();
        toast({ title: "Published!" });
        setLocation(initialTeamId ? `/teams/${initialTeamId}` : `/posts/${draftId}`);
      } else {
        const result = await createPost.mutateAsync({ data: buildPayload() });
        invalidateFeed();
        toast({ title: "Posted!" });
        setLocation(initialTeamId ? `/teams/${initialTeamId}` : `/posts/${result.id}`);
      }
    } catch {
      toast({ title: "Failed to post", variant: "destructive" });
    }
  };

  const onSaveDraft = async () => {
    if (!title.trim() && !body.trim() && photos.length === 0 && !videoUrl.trim()) {
      toast({ title: "Nothing to save yet", variant: "destructive" });
      return;
    }
    try {
      setSaving(true);
      if (draftId) {
        await customFetch(`/posts/${draftId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: title.trim() || "Untitled",
            body,
            videoUrl: videoUrl || null,
            photoUrls: photos,
          }),
        });
      } else {
        const result = await createPost.mutateAsync({
          data: buildPayload("draft"),
        });
        setDraftId(result.id);
      }
      setSavedAt(new Date());
      toast({ title: "Draft saved" });
    } catch {
      toast({ title: "Couldn't save draft", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center justify-between gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setLocation(initialTeamId ? `/teams/${initialTeamId}` : "/");
            }}
            className="font-bold"
          >
            <ArrowLeft className="w-4 h-4 mr-2" /> Cancel
          </Button>
          <div className="flex items-center gap-2 text-sm font-bold">
            <Icon className="w-4 h-4" />
            {draftId ? "Editing Draft" : heading}
          </div>
          <div className="flex items-center gap-2">
            {!isShort && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onSaveDraft}
                disabled={saving}
                className="font-bold rounded-full"
                data-testid="button-save-draft"
              >
                <Save className="w-3.5 h-3.5 mr-1.5" />
                {saving ? "Saving…" : "Save Draft"}
              </Button>
            )}
            <Button
              type="submit"
              form="new-post-form"
              disabled={createPost.isPending}
              className="font-bold rounded-full"
              data-testid="button-publish"
            >
              {createPost.isPending
                ? "Posting…"
                : draftId
                  ? "Publish"
                  : "Post"}
            </Button>
          </div>
        </div>
        {draftId && savedAt && (
          <div className="max-w-3xl mx-auto px-4 pb-2 text-[11px] text-muted-foreground flex items-center gap-1.5 font-semibold">
            <Check className="w-3 h-3 text-emerald-600" />
            Saved {savedAt.toLocaleTimeString()}
          </div>
        )}
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8">
        <Card className="rounded-xl border border-border shadow-sm">
          <CardContent className="p-6">
            <form id="new-post-form" onSubmit={onPublish} className="space-y-5">
              {!draftId && !lockedToTeam && (
                <div>
                  <Label className="text-xs font-black uppercase tracking-widest text-muted-foreground">
                    Post Type
                  </Label>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setPostType("long")}
                      className={`px-4 py-3 rounded-lg border-2 text-sm font-bold flex items-center justify-center gap-2 ${
                        postType === "long"
                          ? "border-primary bg-primary/5 text-primary"
                          : "border-border text-muted-foreground"
                      }`}
                    >
                      <FileText className="w-4 h-4" /> Game Recap
                    </button>
                    <button
                      type="button"
                      onClick={() => setPostType("short")}
                      className={`px-4 py-3 rounded-lg border-2 text-sm font-bold flex items-center justify-center gap-2 ${
                        postType === "short"
                          ? "border-primary bg-primary/5 text-primary"
                          : "border-border text-muted-foreground"
                      }`}
                    >
                      <Play className="w-4 h-4" /> Highlight
                    </button>
                  </div>
                </div>
              )}

              <div>
                <Label
                  htmlFor="title"
                  className="text-xs font-black uppercase tracking-widest text-muted-foreground"
                >
                  Title
                </Label>
                <Input
                  id="title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={
                    isShort
                      ? "Game-winning save vs. Crosstown"
                      : "Comeback win in OT"
                  }
                  className="mt-2 text-lg font-bold"
                  maxLength={200}
                  data-testid="input-title"
                />
              </div>

              {!isShort && (
                <div>
                  <Label
                    htmlFor="body"
                    className="text-xs font-black uppercase tracking-widest text-muted-foreground"
                  >
                    Recap
                  </Label>
                  <Textarea
                    id="body"
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    placeholder="Tell the story of the game..."
                    className="mt-2 min-h-[260px]"
                    data-testid="input-body"
                  />
                </div>
              )}

              <MediaSection
                photos={photos}
                onPhotosChange={setPhotos}
                videoUrl={videoUrl}
                onVideoUrlChange={setVideoUrl}
              />

              {!draftId && !lockedToTeam && myOrgs && myOrgs.data.length > 0 && (
                <div>
                  <Label className="text-xs font-black uppercase tracking-widest text-muted-foreground">
                    Post On Behalf Of
                  </Label>
                  <Select value={orgId} onValueChange={setOrgId}>
                    <SelectTrigger className="mt-2">
                      <SelectValue placeholder="My profile" />
                    </SelectTrigger>
                    <SelectContent>
                      {myOrgs.data.map((org) => (
                        <SelectItem key={org.id} value={org.id}>
                          {org.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="pt-4 border-t border-border flex items-center justify-end gap-2">
                {!isShort && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={onSaveDraft}
                    disabled={saving}
                    className="font-bold rounded-full"
                    data-testid="button-save-draft-bottom"
                  >
                    <Save className="w-4 h-4 mr-1.5" />
                    {saving ? "Saving…" : "Save Draft"}
                  </Button>
                )}
                <Button
                  type="submit"
                  disabled={createPost.isPending}
                  className="font-bold rounded-full"
                  data-testid="button-publish-bottom"
                >
                  {createPost.isPending
                    ? "Posting…"
                    : draftId
                      ? "Publish"
                      : "Post"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        {draftId && (
          <CoAuthorsSection postId={draftId} myId={me?.id ?? ""} />
        )}
      </main>
    </div>
  );
}

function CoAuthorsSection({ postId, myId }: { postId: string; myId: string }) {
  const { toast } = useToast();
  const [coAuthors, setCoAuthors] = useState<
    { id: string; firstName: string; lastName: string }[]
  >([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<
    { id: string; displayName: string }[]
  >([]);

  const refresh = () =>
    customFetch<{ data: typeof coAuthors }>(`/posts/${postId}/co-authors`, {
      method: "GET",
    }).then((res) => setCoAuthors(res.data ?? []));

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postId]);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    const t = window.setTimeout(() => {
      customFetch<{ data: typeof results }>(
        `/users?q=${encodeURIComponent(query.trim())}`,
        { method: "GET" },
      )
        .then((res) => setResults(res.data ?? []))
        .catch(() => setResults([]));
    }, 250);
    return () => window.clearTimeout(t);
  }, [query]);

  const add = async (userId: string) => {
    try {
      await customFetch(`/posts/${postId}/co-authors`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      setQuery("");
      setResults([]);
      await refresh();
      toast({ title: "Co-author added" });
    } catch {
      toast({ title: "Couldn't add co-author", variant: "destructive" });
    }
  };

  const remove = async (userId: string) => {
    try {
      await customFetch(`/posts/${postId}/co-authors/${userId}`, {
        method: "DELETE",
      });
      await refresh();
    } catch {
      toast({ title: "Couldn't remove", variant: "destructive" });
    }
  };

  return (
    <Card className="mt-6 rounded-xl border border-border shadow-sm">
      <CardContent className="p-6">
        <h3 className="text-xs font-black uppercase tracking-widest text-muted-foreground mb-3">
          Co-authors
        </h3>
        {coAuthors.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">
            No co-authors yet.
          </p>
        ) : (
          <div className="space-y-2 mb-3">
            {coAuthors.map((u) => (
              <div
                key={u.id}
                className="flex items-center justify-between gap-2 p-2 rounded-md border border-border bg-muted/30"
              >
                <span className="text-sm font-bold">
                  {u.firstName} {u.lastName}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => remove(u.id)}
                  className="h-7 px-2 text-xs"
                  data-testid={`button-remove-coauthor-${u.id}`}
                >
                  Remove
                </Button>
              </div>
            ))}
          </div>
        )}
        <div className="relative">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search teammates to add as co-author..."
            data-testid="input-search-coauthor"
          />
          {results.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-card border border-border rounded-md shadow-md z-10 max-h-56 overflow-y-auto">
              {results
                .filter((u) => u.id !== myId && !coAuthors.some((c) => c.id === u.id))
                .map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => add(u.id)}
                    className="w-full text-left p-2 hover:bg-muted text-sm font-semibold"
                    data-testid={`button-add-coauthor-${u.id}`}
                  >
                    {u.displayName}
                  </button>
                ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function MediaSection({
  photos,
  onPhotosChange,
  videoUrl,
  onVideoUrlChange,
}: {
  photos: string[];
  onPhotosChange: (next: string[]) => void;
  videoUrl: string;
  onVideoUrlChange: (next: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  const onFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const readers = Array.from(files)
      .filter((f) => f.type.startsWith("image/"))
      .map(
        (f) =>
          new Promise<string>((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve(String(r.result));
            r.onerror = reject;
            r.readAsDataURL(f);
          }),
      );
    const next = await Promise.all(readers);
    onPhotosChange([...photos, ...next]);
  };

  const removeAt = (idx: number) => {
    onPhotosChange(photos.filter((_, i) => i !== idx));
  };

  return (
    <div className="space-y-4 pt-2 border-t border-border">
      <Label className="text-xs font-black uppercase tracking-widest text-muted-foreground">
        Media
      </Label>

      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-bold flex items-center gap-1.5">
            <ImagePlus className="w-4 h-4" /> Photos
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="font-bold rounded-full"
            onClick={() => inputRef.current?.click()}
            data-testid="button-add-photos"
          >
            <ImagePlus className="w-3.5 h-3.5 mr-1.5" /> Add Photos
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              onFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>
        {photos.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">
            No photos yet. The first photo becomes the cover image.
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {photos.map((src, i) => (
              <div
                key={i}
                className="relative rounded-lg overflow-hidden border border-border aspect-square bg-muted"
              >
                <img
                  src={src}
                  alt={`Photo ${i + 1}`}
                  className="w-full h-full object-cover"
                />
                {i === 0 && (
                  <span className="absolute top-1 left-1 bg-primary text-primary-foreground text-[10px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded">
                    Cover
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => removeAt(i)}
                  className="absolute top-1 right-1 bg-black/60 hover:bg-black/80 text-white rounded-full p-1"
                  data-testid={`button-remove-photo-${i}`}
                  aria-label="Remove photo"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <Label
          htmlFor="videoUrl"
          className="text-sm font-bold flex items-center gap-1.5"
        >
          <Video className="w-4 h-4" /> Video Highlight Link
        </Label>
        <Input
          id="videoUrl"
          value={videoUrl}
          onChange={(e) => onVideoUrlChange(e.target.value)}
          placeholder="Paste a YouTube, Vimeo, or other video link"
          className="mt-2"
          data-testid="input-video-url"
        />
      </div>
    </div>
  );
}
