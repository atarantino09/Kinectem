import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  customFetch,
  useCreatePost,
  useCreatePostTags,
  useDeletePost,
  useGetLoggedInUser,
  getListFeedQueryKey,
  getListOrgPostsQueryKey,
  getListPostTagsQueryKey,
  getListTeamPendingPostsQueryKey,
  getListTeamPostsQueryKey,
  getListUserPostsQueryKey,
  type CreatePostRequest,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { safeInternalPath } from "@/lib/safePath";

type DraftPayload = {
  id: string;
  title?: string | null;
  description?: string | null;
  body?: string | null;
  gameDate?: string | null;
  videoUrl?: string | null;
  photoUrls?: string[] | null;
  // The published `GET /posts/:id` response surfaces photos and the
  // video link via the `assets` array (image/* + video/*) rather than
  // top-level `photoUrls` / `videoUrl`. Keep the optional fields above
  // for forward-compat with any draft endpoint that ships them flat,
  // but the load path below also extracts from `assets` so editing a
  // recap correctly pre-fills every originally attached photo and the
  // existing cover stays in slot 0.
  assets?: Array<{
    id?: string;
    url?: string | null;
    fileType?: string | null;
    displayOrder?: number;
  }> | null;
  // Captured from the loaded payload so the submit handler knows
  // which author + team lists to invalidate after saving — the
  // composer can edit posts authored by someone else (co-authors,
  // org admins) so we can't assume `author.id === me.id`. The
  // editor's Delete flow reuses these same fields to land the
  // user on the right page (team vs. home) and refresh the right
  // per-author / per-team lists.
  author?: { id?: string | null } | null;
  context?: {
    type?: string | null;
    id?: string | null;
    name?: string | null;
    slug?: string | null;
    avatarUrl?: string | null;
    orgId?: string | null;
    orgName?: string | null;
    orgSlug?: string | null;
    orgAvatarUrl?: string | null;
  } | null;
  // Per-viewer flag set by GET /posts/:id — true only when the
  // requester is the original author. Drives the in-editor Delete
  // affordance (co-authors / coaches / org admins do not get it).
  canDelete?: boolean;
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
  initialFrom?: string | null;
}

export function useNewPostForm({
  initialType,
  initialDraftId,
  initialEditId,
  initialTeamId,
  initialFrom = null,
}: UseNewPostFormParams) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const createPost = useCreatePost();
  const createPostTags = useCreatePostTags();
  const deletePost = useDeletePost();
  const { data: me } = useGetLoggedInUser();
  // Author + team captured from the post we loaded (when editing
  // a draft or a published post). Kept separate from `initialTeamId`
  // because edits don't carry a team query param and the post may be
  // authored by someone else (co-author / org-admin edits). Also
  // consumed by the editor's Delete flow to land the user on the
  // right page and refresh the right per-author / per-team lists.
  const [loadedAuthorId, setLoadedAuthorId] = useState<string | null>(null);
  const [loadedTeamId, setLoadedTeamId] = useState<string | null>(null);
  // Owning org id (org_post only) for delete navigation and cache
  // invalidation of the org-page posts list.
  const [loadedOrgId, setLoadedOrgId] = useState<string | null>(null);
  // Display info for the loaded post's team / parent org context.
  // Captured so the editor can render a "Posted in" section linking
  // back to the team and org pages (task #465). Null on the create
  // and draft paths, where there's no published context to link to.
  const [loadedTeamName, setLoadedTeamName] = useState<string | null>(null);
  const [loadedTeamSlug, setLoadedTeamSlug] = useState<string | null>(null);
  const [loadedTeamAvatarUrl, setLoadedTeamAvatarUrl] = useState<
    string | null
  >(null);
  // Parent-org id captured from a team-context post so the editor's
  // "Posted in" section (task #465) can link to the org page even
  // though `loadedOrgId` above is reserved for org-post owning-org
  // tracking (delete navigation + cache invalidation).
  const [loadedParentOrgId, setLoadedParentOrgId] = useState<string | null>(
    null,
  );
  const [loadedOrgName, setLoadedOrgName] = useState<string | null>(null);
  const [loadedOrgSlug, setLoadedOrgSlug] = useState<string | null>(null);
  const [loadedOrgAvatarUrl, setLoadedOrgAvatarUrl] = useState<
    string | null
  >(null);
  // Loaded post kind — drives PATCH body shape and delete navigation.
  // `null` until a post has been loaded into the editor.
  const [loadedKind, setLoadedKind] = useState<
    "article" | "highlight" | "org_post" | null
  >(null);
  // Task #447 — when a non-admin author submits a recap, the server
  // creates it in `pending_approval` status and surfaces that via the
  // POST response's `requiresApproval` flag. We hold off on the
  // post-submit redirect and open a confirmation dialog explaining
  // the recap is awaiting org admin approval; the dialog's dismiss
  // action runs the saved navigation. Admin-authored recaps publish
  // immediately and skip this path entirely (existing toast +
  // redirect).
  const [pendingApprovalOpen, setPendingApprovalOpen] = useState(false);
  const [pendingApprovalNavTo, setPendingApprovalNavTo] = useState<string | null>(
    null,
  );

  // Refresh every list the new or updated post should appear in so
  // the destination page (feed, profile, team page) renders against
  // fresh data on first paint instead of briefly flashing the stale
  // list. Awaited by the submit handler before navigating.
  //
  // `refetchType: "all"` is critical here: by default, invalidate
  // only refetches *active* (mounted) queries. The destination page
  // hasn't mounted yet when we call this, so without it the team-posts
  // / user-posts queries would just be marked stale and the user could
  // still briefly see the cached pre-publish list before the on-mount
  // refetch lands. Forcing inactive refetches and awaiting them means
  // the cache is hot when the new page mounts.
  const invalidateAffectedLists = async (opts: {
    authorId?: string | null;
    teamId?: string | null;
    orgId?: string | null;
  }) => {
    const promises: Promise<unknown>[] = [
      qc.invalidateQueries({
        queryKey: getListFeedQueryKey(),
        refetchType: "all",
      }),
    ];
    if (opts.authorId) {
      promises.push(
        qc.invalidateQueries({
          queryKey: getListUserPostsQueryKey(opts.authorId),
          refetchType: "all",
        }),
      );
    }
    if (opts.teamId) {
      promises.push(
        qc.invalidateQueries({
          queryKey: getListTeamPostsQueryKey(opts.teamId),
          refetchType: "all",
        }),
        qc.invalidateQueries({
          queryKey: getListTeamPendingPostsQueryKey(opts.teamId),
          refetchType: "all",
        }),
      );
    }
    if (opts.orgId) {
      promises.push(
        qc.invalidateQueries({
          queryKey: getListOrgPostsQueryKey(opts.orgId),
          refetchType: "all",
        }),
      );
    }
    await Promise.all(promises);
  };

  const [postType, setPostType] = useState<"short" | "long">(initialType);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [teamId, setTeamId] = useState<string>("");
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
  // Highlight composer (and edit-post path) — list of roster userIds
  // the author hand-picks via the Tag Players dropdown. For new
  // highlights this is submitted as manual tags after the highlight
  // is created (task #313). For edits to a published recap or
  // highlight, this is diffed against `originalTaggedById` on save
  // so newly-checked players get tagged and unchecked players get
  // their existing tag removed (task #322). Reset when the team
  // changes so a stale selection from a previous team can't leak
  // into the new roster.
  const [taggedUserIds, setTaggedUserIds] = useState<string[]>([]);
  useEffect(() => {
    setTaggedUserIds([]);
  }, [initialTeamId]);
  // Edit-post tag diff baseline (task #322): map of currently-tagged
  // userId → tagId on the loaded post. Populated from
  // GET /posts/:postId/tags (user tags only, both approved + pending)
  // so the save handler can issue DELETE /article-tags/:tagId or
  // /highlight-tags/:tagId for any player the author un-checks. Empty
  // for brand-new posts (the create flow uses POST /posts/:postId/tags
  // with the full picker selection — no diff needed).
  const [originalTaggedById, setOriginalTaggedById] = useState<
    Record<string, string>
  >({});
  const [draftId, setDraftId] = useState<string | null>(initialDraftId);
  const editId = initialEditId;
  const isEditingPublished = !!editId;
  const lockedToTeam = !!initialTeamId;
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [saving, setSaving] = useState(false);
  // Per-viewer flag captured from the post we loaded into the editor.
  // True only when the requester is the original author of an
  // already-published article — drives the editor-header Delete
  // affordance. Co-authors / coaches / org admins (who get `canEdit`
  // but not `canDelete`) leave this false.
  const [canDelete, setCanDelete] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

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

  // PATCH /posts/:postId body — kind-aware shapes match each PATCH
  // handler in routes/drafts.ts. `null` means draft article.
  const buildPatchBody = () => {
    if (loadedKind === "highlight") {
      return JSON.stringify({
        title: title.trim() || "Untitled",
        description: body,
        videoUrl: videoUrl || null,
        thumbnailUrl: photos[0] ?? null,
      });
    }
    if (loadedKind === "org_post") {
      return JSON.stringify({
        title: title.trim() || "Untitled",
        body,
        videoUrl: videoUrl || null,
        photoUrls: photos,
        coverImageUrl: photos[0] ?? null,
      });
    }
    return JSON.stringify({
      title: title.trim() || "Untitled",
      body,
      videoUrl: videoUrl || null,
      photoUrls: photos,
      gameDate: gameDateForApi(),
    });
  };

  // Pull the post's current user tags from GET /posts/:postId/tags
  // so the edit-post tag picker can pre-populate its selection and
  // the save handler has a baseline to diff removals against. Both
  // approved AND pending tags are surfaced — pending tags still
  // count as "currently tagged" from the post author's point of
  // view (the consent flow plays out separately for the player).
  // Errors are swallowed so a failed tag-list fetch doesn't block
  // the rest of the editor from loading.
  const refreshLoadedTags = async (postId: string) => {
    try {
      const resp = await customFetch<{
        tags?: Array<{
          id: string;
          taggedEntityType: string;
          taggedEntityId: string;
        }>;
      }>(`/api/v1/posts/${postId}/tags`, { method: "GET" });
      const map: Record<string, string> = {};
      for (const t of resp.tags ?? []) {
        if (t.taggedEntityType !== "user") continue;
        map[t.taggedEntityId] = t.id;
      }
      setOriginalTaggedById(map);
      setTaggedUserIds(Object.keys(map));
    } catch {
      // ignore — picker just starts empty
    }
  };

  // Load existing draft OR existing published post (when editing).
  // Both paths read the same /posts/:id payload — the only divergence
  // is in the submit handler below, which skips /publish for editId.
  useEffect(() => {
    const loadId = initialDraftId ?? initialEditId;
    if (!loadId) return;
    customFetch<DraftPayload>(`/api/v1/posts/${loadId}`, { method: "GET" })
      .then((d) => {
        // Discriminate the loaded post by its prefixed id.
        const kind: "article" | "highlight" | "org_post" =
          d.id.startsWith("highlight-")
            ? "highlight"
            : d.id.startsWith("orgpost-")
              ? "org_post"
              : "article";
        setLoadedKind(kind);
        setTitle(d.title ?? "");
        // Reuse the body input for highlight `description` so the
        // form stays a single text field.
        setBody(
          kind === "highlight"
            ? (d.description ?? "")
            : (d.body ?? ""),
        );
        // Pull photos and the video link from `assets` first — that's
        // what the published-post response actually carries — and fall
        // back to the flat fields if the endpoint ever ships them.
        // Sort by `displayOrder` so the existing cover stays in slot 0
        // and the rest follow the order chosen at upload.
        const sortedAssets = Array.isArray(d.assets)
          ? [...d.assets].sort(
              (a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0),
            )
          : [];
        const imageUrls = sortedAssets
          .filter(
            (a) =>
              typeof a.url === "string" &&
              a.url.length > 0 &&
              (a.fileType ?? "").startsWith("image/"),
          )
          .map((a) => a.url as string);
        const videoAsset = sortedAssets.find((a) =>
          (a.fileType ?? "").startsWith("video/"),
        );
        setVideoUrl(
          d.videoUrl ?? (videoAsset?.url ? String(videoAsset.url) : ""),
        );
        setPhotos(
          Array.isArray(d.photoUrls) && d.photoUrls.length > 0
            ? d.photoUrls
            : imageUrls,
        );
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
        // Sync the post-type toggle to the loaded post.
        setPostType(kind === "highlight" ? "short" : "long");
        // Remember who owns the post and which team or org it
        // belongs to. The submit handler uses these to refresh the
        // right user-posts / team-posts / org-posts lists after
        // saving, and the Delete flow reuses them to invalidate the
        // same lists and pick a sensible post-delete destination.
        setLoadedAuthorId(d.author?.id ?? null);
        setLoadedTeamId(
          d.context?.type === "team" && d.context.id ? d.context.id : null,
        );
        setLoadedOrgId(
          d.context?.type === "organization" && d.context.id
            ? d.context.id
            : null,
        );
        // Capture team/org display info for the "Posted in" section
        // on the edit page (task #465). For team contexts the parent
        // org info also rides along on `context`; for organization
        // contexts the org details live directly on `context`.
        if (d.context?.type === "team") {
          setLoadedTeamName(d.context.name ?? null);
          setLoadedTeamSlug(d.context.slug ?? null);
          setLoadedTeamAvatarUrl(d.context.avatarUrl ?? null);
          setLoadedParentOrgId(d.context.orgId ?? null);
          setLoadedOrgName(d.context.orgName ?? null);
          setLoadedOrgSlug(d.context.orgSlug ?? null);
          setLoadedOrgAvatarUrl(d.context.orgAvatarUrl ?? null);
        } else if (d.context?.type === "organization") {
          setLoadedTeamName(null);
          setLoadedTeamSlug(null);
          setLoadedTeamAvatarUrl(null);
          setLoadedParentOrgId(null);
          setLoadedOrgName(d.context.name ?? null);
          setLoadedOrgSlug(d.context.slug ?? null);
          setLoadedOrgAvatarUrl(d.context.avatarUrl ?? null);
        } else {
          setLoadedTeamName(null);
          setLoadedTeamSlug(null);
          setLoadedTeamAvatarUrl(null);
          setLoadedParentOrgId(null);
          setLoadedOrgName(null);
          setLoadedOrgSlug(null);
          setLoadedOrgAvatarUrl(null);
        }
        // Per-viewer flag from GET /posts/:id — only meaningful on
        // the editId path (already-published article). Drafts won't
        // surface canDelete.
        setCanDelete(!!d.canDelete);
        // Pre-populate the per-player tag picker (task #322). Only
        // meaningful when editing an already-published recap or
        // highlight — drafts use the create flow and brand-new posts
        // have no existing tags. Failures are non-blocking; the
        // picker just starts with an empty selection.
        if (initialEditId && (kind === "article" || kind === "highlight")) {
          void refreshLoadedTags(d.id);
        }
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
      ...(initialTeamId || teamId
        ? ({
            context: {
              type: "team",
              id: (initialTeamId ?? teamId) as string,
            },
          } as object)
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
        // Editing an already-published post: PATCH only — do NOT
        // re-call /publish. For articles the PATCH handler reacts to
        // a gameDate transition (null <-> non-null) by running or
        // unwinding the auto-tag fan-out; highlights and Updates
        // simply mutate their own row in place.
        await patchAt(editId);
        // Apply per-player tag changes after the PATCH so a transient
        // PATCH failure doesn't leave the tag set in an inconsistent
        // state (task #322). Diff the picker's current selection
        // against `originalTaggedById`: newly-checked players go
        // through the existing POST /posts/:postId/tags endpoint
        // (which honors the consent rules), and unchecked players
        // hit DELETE /article-tags/:tagId or /highlight-tags/:tagId
        // by tagId. Tag failures are non-blocking — the post itself
        // already saved, so we surface a soft warning toast and
        // refresh the picker from the server so the UI reflects the
        // actual persisted state instead of a stale optimistic one.
        let tagWarning: string | null = null;
        if (loadedKind === "article" || loadedKind === "highlight") {
          const originalIds = new Set(Object.keys(originalTaggedById));
          const selected = new Set(taggedUserIds);
          const addedIds = taggedUserIds.filter((id) => !originalIds.has(id));
          const removedTagIds: string[] = [];
          for (const [uid, tagId] of Object.entries(originalTaggedById)) {
            if (!selected.has(uid)) removedTagIds.push(tagId);
          }
          let tagFailures = 0;
          if (addedIds.length > 0) {
            try {
              const tagResp = await createPostTags.mutateAsync({
                postId: editId,
                data: {
                  tags: addedIds.map((id) => ({
                    taggedEntityType: "user",
                    taggedEntityId: id,
                    direction: "lateral",
                  })),
                },
              });
              const persisted = tagResp.tags?.length ?? 0;
              // POST silently drops users not on the roster; treat
              // any shortfall the same as a failure for the toast.
              if (persisted < addedIds.length) {
                tagFailures += addedIds.length - persisted;
              }
            } catch {
              tagFailures += addedIds.length;
            }
          }
          // DELETEs are issued one-at-a-time so a single failure
          // doesn't abort the rest of the diff. The endpoint is
          // idempotent (404 ⇒ 204) so re-issuing on stale state is
          // safe.
          const removalKind: "article-tags" | "highlight-tags" =
            loadedKind === "article" ? "article-tags" : "highlight-tags";
          for (const tagId of removedTagIds) {
            try {
              await customFetch(`/api/v1/${removalKind}/${tagId}`, {
                method: "DELETE",
              });
            } catch {
              tagFailures += 1;
            }
          }
          if (tagFailures > 0) {
            tagWarning = "Saved, but couldn't update some tags.";
          }
          if (addedIds.length > 0 || removedTagIds.length > 0) {
            // Refresh the picker baseline so the next save diff is
            // computed against the actual persisted state, and drop
            // the cached post-tags list so the detail page renders
            // the fresh tag set on first paint.
            await refreshLoadedTags(editId);
            await qc.invalidateQueries({
              queryKey: getListPostTagsQueryKey(editId),
              refetchType: "all",
            });
          } else {
            // Even when the picker didn't change, the recap PATCH
            // can fan out (or unwind) tags as a side effect of a
            // gameDate transition or a tagRoster checkbox toggle.
            // Drop the cached tags list so the detail page picks up
            // any server-applied changes on first paint. We don't
            // refresh the in-memory baseline because the user is
            // navigating away.
            await qc.invalidateQueries({
              queryKey: getListPostTagsQueryKey(editId),
              refetchType: "all",
            });
          }
        }
        // Refresh the home feed plus the author's profile posts and
        // (depending on the post's scope) the owning team's or org's
        // posts list, so the destination page renders the updated
        // post on first paint. Awaited before navigating to avoid a
        // stale flash.
        await invalidateAffectedLists({
          authorId: loadedAuthorId,
          teamId: loadedTeamId,
          orgId: loadedOrgId,
        });
        // Drop the cached single-post detail so a navigation back to
        // /posts/:id refetches the freshly-edited title/body/photos.
        qc.removeQueries({ queryKey: ["post", editId] });
        if (tagWarning) {
          toast({
            title: tagWarning,
            description:
              "Open the post to retry — your other changes were saved.",
            variant: "destructive",
          });
        } else {
          toast({ title: "Saved" });
        }
        // Return to wherever the editor was launched from when a
        // safe internal `from` path was supplied (e.g. the feed,
        // a profile, a team page). Fall back to the post detail
        // page when no originating location is available or the
        // value isn't a same-app relative path.
        const back = safeInternalPath(initialFrom);
        setLocation(back ?? `/posts/${editId}`);
      } else if (draftId) {
        await patchAt(draftId);
        await customFetch(`/api/v1/posts/${draftId}/publish`, {
          method: "POST",
        });
        // The just-published post will appear on the home feed, the
        // author's profile, and (when team-scoped) the team page.
        // Prefer ids captured from the loaded draft, then fall back
        // to the current user / form team for drafts that were
        // created in this same session (no initial draft load).
        await invalidateAffectedLists({
          authorId: loadedAuthorId ?? me?.id ?? null,
          teamId: loadedTeamId ?? initialTeamId ?? null,
        });
        toast({ title: "Published!" });
        setLocation(
          initialTeamId ? `/teams/${initialTeamId}` : `/posts/${draftId}`,
        );
      } else {
        const result = await createPost.mutateAsync({ data: buildPayload() });
        // Highlight composer only — submit any roster players the
        // author hand-picked via the Tag Players dropdown so each
        // selected player gets a manual tag (task #313). Run after
        // the post is created so we have a postId; tag failures
        // are non-blocking — the post itself is already live.
        let tagWarning: string | null = null;
        if (isShort && taggedUserIds.length > 0) {
          const requested = taggedUserIds.length;
          try {
            const tagResp = await createPostTags.mutateAsync({
              postId: result.id,
              data: {
                tags: taggedUserIds.map((id) => ({
                  taggedEntityType: "user",
                  taggedEntityId: id,
                  direction: "lateral",
                })),
              },
            });
            const persisted = tagResp.tags?.length ?? 0;
            if (persisted < requested) {
              const missing = requested - persisted;
              tagWarning = `Posted, but couldn't tag ${missing} player${
                missing === 1 ? "" : "s"
              }.`;
            }
            // Drop the cached tags list for this post so the
            // detail page renders the fresh tag set on first
            // paint instead of an empty list.
            await qc.invalidateQueries({
              queryKey: getListPostTagsQueryKey(result.id),
              refetchType: "all",
            });
          } catch {
            tagWarning = "Posted, but tagging players failed.";
          }
        }
        // The create response is a full PostResponse, so we know
        // exactly which author + team lists need to refetch.
        await invalidateAffectedLists({
          authorId: result.author?.id ?? me?.id ?? null,
          teamId:
            result.context?.type === "team" && result.context.id
              ? result.context.id
              : initialTeamId,
          orgId:
            result.context?.type === "organization" && result.context.id
              ? result.context.id
              : null,
        });
        // Task #447 — server marks non-admin recap submissions as
        // `pending_approval` and echoes `requiresApproval: true` on
        // the create response. In that case, replace the "Posted!"
        // toast + immediate redirect with a confirmation dialog so
        // the author understands their recap isn't yet visible on
        // the team page; the dismiss action runs the saved
        // navigation. Highlights and admin-authored recaps publish
        // immediately and keep the existing toast + redirect.
        const navTo = initialTeamId
          ? `/teams/${initialTeamId}`
          : `/posts/${result.id}`;
        const requiresApproval =
          (result as { requiresApproval?: boolean }).requiresApproval === true;
        if (requiresApproval) {
          setPendingApprovalNavTo(navTo);
          setPendingApprovalOpen(true);
          // Tag warnings are highlight-only; pending_approval is
          // article-only — no need to surface tagWarning here.
          return;
        }
        toast({ title: "Posted!" });
        if (tagWarning) {
          toast({
            title: tagWarning,
            description: "You can ask players to tag themselves later.",
            variant: "destructive",
          });
        }
        setLocation(navTo);
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

  // Delete the article currently loaded in the editor. Mirrors the
  // post-page delete flow: same mutation, same query-key invalidations
  // (home feed, original author's profile posts, owning team's posts),
  // same "Post deleted" toast, and lands the user on the team page
  // when the recap belonged to a team or the home feed otherwise.
  // Only callable when `isEditingPublished` is true and the loaded
  // post reported `canDelete` for this viewer — the UI gates this on
  // the same flags so the option never renders for drafts, brand-new
  // posts, highlights, or co-authors / coaches / org admins.
  const onDelete = async () => {
    if (!editId || !canDelete) return;
    try {
      await deletePost.mutateAsync({ postId: editId });
      setConfirmDeleteOpen(false);
      // Same lists the save flow refreshes — feed, the original
      // author's profile-posts, and the owning team's or org's posts
      // (whichever scope the post belonged to) — so the destination
      // page renders without the just-deleted post on first paint.
      await invalidateAffectedLists({
        authorId: loadedAuthorId,
        teamId: loadedTeamId,
        orgId: loadedOrgId,
      });
      qc.removeQueries({ queryKey: ["post", editId] });
      toast({ title: "Post deleted" });
      // Land somewhere sensible: team-scoped highlights / articles
      // bounce back to the team page, org Updates bounce back to
      // the org page, and anything else falls through to the home
      // feed.
      setLocation(
        loadedTeamId
          ? `/teams/${loadedTeamId}`
          : loadedOrgId
            ? `/organizations/${loadedOrgId}`
            : "/",
      );
    } catch {
      toast({
        title: "Couldn't delete post",
        description: "Please try again.",
        variant: "destructive",
      });
    }
  };

  return {
    // state values
    postType,
    title,
    body,
    teamId,
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
    // Highlight composer + edit-post tag picker — exposed so the
    // picker can render the current selection and a setter to update
    // it. Pre-populated from the loaded post's tags when editing
    // a published recap or highlight (task #322).
    taggedUserIds,
    setTaggedUserIds,
    // The team scope the highlight composer fetches its roster
    // against. Falls back to the loaded post's team when editing
    // a published recap or highlight (task #322) so the same picker
    // can run on the edit-post screen even though the editor URL
    // doesn't carry a `teamId` query param.
    highlightTeamId: initialTeamId ?? loadedTeamId,
    // Surfaced so the composer can hide article-only fields
    // (gameDate, tagRoster, the org-on-behalf-of selector, the
    // post-type toggle) when the loaded post is a highlight or a
    // standalone org Update. `null` for brand-new composer sessions.
    loadedKind,
    // Display info for the "Posted in" section on the edit-post
    // page (task #465). All null on draft / brand-new composer
    // sessions, where there's no published context to link to.
    loadedTeamId,
    loadedTeamName,
    loadedTeamSlug,
    loadedTeamAvatarUrl,
    // For the "Posted in" org row: prefer the parent-org id captured
    // from a team-context post, otherwise fall back to the owning org
    // id used by org_post edits. Either way the link target is the
    // same org page, just sourced from different context shapes.
    loadedOrgId: loadedParentOrgId ?? loadedOrgId,
    loadedOrgName,
    loadedOrgSlug,
    loadedOrgAvatarUrl,
    publishing: createPost.isPending,
    // delete-from-editor surface
    canDelete,
    confirmDeleteOpen,
    setConfirmDeleteOpen,
    deleting: deletePost.isPending,
    // setters
    setPostType,
    setTitle,
    setBody,
    setTeamId,
    setPhotos,
    setVideoUrl,
    setGameDate,
    setTagRoster,
    // Task #447 — pending-approval confirmation dialog state. The
    // page renders an AlertDialog bound to `pendingApprovalOpen`;
    // dismissing it runs `onDismissPendingApproval`, which performs
    // the post-submit navigation that was deferred when the recap
    // came back as `pending_approval`.
    pendingApprovalOpen,
    setPendingApprovalOpen,
    onDismissPendingApproval: () => {
      setPendingApprovalOpen(false);
      if (pendingApprovalNavTo) {
        setLocation(pendingApprovalNavTo);
        setPendingApprovalNavTo(null);
      }
    },
    // actions
    onPublish,
    onSaveDraft,
    onDelete,
    cancelTo:
      safeInternalPath(initialFrom) ??
      (initialTeamId ? `/teams/${initialTeamId}` : "/"),
    setLocation,
  };
}
