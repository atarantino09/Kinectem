import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  customFetch,
  useCreatePost,
  getListFeedQueryKey,
  type CreatePostRequest,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";

type DraftPayload = {
  id: string;
  title?: string | null;
  description?: string | null;
  body?: string | null;
  gameDate?: string | null;
  videoUrl?: string | null;
  photoUrls?: string[] | null;
};

// Today's local calendar date in YYYY-MM-DD form, the shape an
// <input type="date"> control accepts.
function todayLocalIso(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

interface UseNewPostFormParams {
  initialType: "short" | "long";
  initialDraftId: string | null;
  initialEditId: string | null;
  initialTeamId: string | null;
}

export function useNewPostForm({
  initialType,
  initialDraftId,
  initialEditId,
  initialTeamId,
}: UseNewPostFormParams) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const createPost = useCreatePost();
  const invalidateFeed = () =>
    qc.invalidateQueries({ queryKey: getListFeedQueryKey() });

  const [postType, setPostType] = useState<"short" | "long">(initialType);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [orgId, setOrgId] = useState<string>("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [videoUrl, setVideoUrl] = useState("");
  // YYYY-MM-DD value bound to the date input. Pre-filled with today
  // so coaches who don't touch the picker still publish a recap
  // dated today (the backend uses this date to drive the auto-tag
  // fan-out, gated by the `tagRoster` checkbox below).
  const [gameDate, setGameDate] = useState<string>(todayLocalIso());
  // Defaults to true so a recap published without touching the form
  // still tags every rostered player. Unchecking sends `gameDate:
  // null` and skips the fan-out.
  const [tagRoster, setTagRoster] = useState<boolean>(true);
  const [draftId, setDraftId] = useState<string | null>(initialDraftId);
  const editId = initialEditId;
  const isEditingPublished = !!editId;
  const lockedToTeam = !!initialTeamId;
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [saving, setSaving] = useState(false);

  // Build the ISO datetime sent to the API. Noon UTC keeps the
  // calendar date stable across timezones. Returning null when the
  // tag-roster checkbox is off skips the auto-tag fan-out.
  const gameDateForApi = (): string | null => {
    if (!tagRoster) return null;
    const value = gameDate || todayLocalIso();
    const iso = `${value}T12:00:00.000Z`;
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  };

  const buildPatchBody = () =>
    JSON.stringify({
      title: title.trim() || "Untitled",
      body,
      videoUrl: videoUrl || null,
      photoUrls: photos,
      gameDate: gameDateForApi(),
    });

  // Load existing draft OR existing published post (when editing).
  // Both paths read the same /posts/:id payload — the only divergence
  // is in the submit handler below, which skips /publish for editId.
  useEffect(() => {
    const loadId = initialDraftId ?? initialEditId;
    if (!loadId) return;
    customFetch<DraftPayload>(`/api/v1/posts/${loadId}`, { method: "GET" })
      .then((d) => {
        setTitle(d.title ?? "");
        setBody(d.body ?? "");
        setVideoUrl(d.videoUrl ?? "");
        setPhotos(Array.isArray(d.photoUrls) ? d.photoUrls : []);
        // Pre-fill the date input. Trim ISO datetime down to
        // YYYY-MM-DD; if the post has no gameDate, fall back to
        // today so the date input has something visible. The
        // checkbox below decides whether the date is actually sent
        // (and the auto-tag fan-out fires).
        const hasDate =
          typeof d.gameDate === "string" && d.gameDate.length >= 10;
        setGameDate(hasDate ? d.gameDate!.slice(0, 10) : todayLocalIso());
        // Reflect the post's actual tagging state. A published recap
        // with no game date should leave the checkbox UNchecked so
        // the coach has to explicitly opt back in (otherwise auto-
        // saving / re-submitting would silently fan out tags).
        setTagRoster(hasDate);
        setPostType("long");
      })
      .catch(() => {
        toast({
          title: initialEditId ? "Couldn't load post" : "Couldn't load draft",
          variant: "destructive",
        });
      });
  }, [initialDraftId, initialEditId, toast]);

  // Auto-save (debounced) when we already have a draft id. Skip
  // auto-save entirely when editing an already-published post —
  // those changes only land when the coach hits Save explicitly,
  // so a stray keystroke doesn't silently mutate a live post.
  const debouncedRef = useRef<number | null>(null);
  useEffect(() => {
    if (!draftId || isEditingPublished) return;
    if (debouncedRef.current) window.clearTimeout(debouncedRef.current);
    debouncedRef.current = window.setTimeout(async () => {
      try {
        setSaving(true);
        await customFetch(`/api/v1/posts/${draftId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: buildPatchBody(),
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    title,
    body,
    videoUrl,
    photos,
    gameDate,
    tagRoster,
    draftId,
    isEditingPublished,
  ]);

  const isShort = postType === "short";

  const buildPayload = (status?: "draft"): CreatePostRequest => {
    const recapDate = !isShort ? gameDateForApi() : null;
    return {
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
      ...(recapDate ? ({ gameDate: recapDate } as object) : {}),
      ...(status ? ({ status } as object) : {}),
    };
  };

  const patchAt = async (id: string) =>
    customFetch(`/api/v1/posts/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: buildPatchBody(),
    });

  const onPublish = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      toast({ title: "Add a title", variant: "destructive" });
      return;
    }
    try {
      if (isEditingPublished && editId) {
        // Editing an already-published recap: PATCH only — do NOT
        // re-call /publish. The PATCH handler reacts to a gameDate
        // transition (null <-> non-null) by running or unwinding
        // the auto-tag fan-out, which is the whole reason this
        // path exists.
        await patchAt(editId);
        invalidateFeed();
        toast({ title: "Saved" });
        setLocation(`/posts/${editId}`);
      } else if (draftId) {
        await patchAt(draftId);
        await customFetch(`/api/v1/posts/${draftId}/publish`, {
          method: "POST",
        });
        invalidateFeed();
        toast({ title: "Published!" });
        setLocation(
          initialTeamId ? `/teams/${initialTeamId}` : `/posts/${draftId}`,
        );
      } else {
        const result = await createPost.mutateAsync({ data: buildPayload() });
        invalidateFeed();
        toast({ title: "Posted!" });
        setLocation(
          initialTeamId ? `/teams/${initialTeamId}` : `/posts/${result.id}`,
        );
      }
    } catch {
      toast({ title: "Failed to post", variant: "destructive" });
    }
  };

  const onSaveDraft = async () => {
    if (
      !title.trim() &&
      !body.trim() &&
      photos.length === 0 &&
      !videoUrl.trim()
    ) {
      toast({ title: "Nothing to save yet", variant: "destructive" });
      return;
    }
    try {
      setSaving(true);
      if (draftId) {
        await patchAt(draftId);
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

  return {
    // state values
    postType,
    title,
    body,
    orgId,
    photos,
    videoUrl,
    gameDate,
    tagRoster,
    draftId,
    editId,
    isEditingPublished,
    lockedToTeam,
    savedAt,
    saving,
    isShort,
    publishing: createPost.isPending,
    // setters
    setPostType,
    setTitle,
    setBody,
    setOrgId,
    setPhotos,
    setVideoUrl,
    setGameDate,
    setTagRoster,
    // actions
    onPublish,
    onSaveDraft,
    cancelTo: initialTeamId ? `/teams/${initialTeamId}` : "/",
    setLocation,
  };
}
