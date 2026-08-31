import { useEffect, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Camera, ImagePlus, PlayCircle, Trash2, X } from "lucide-react";
import {
  useGetLoggedInUser,
  useListAlbumPhotos,
  createAlbumPhoto,
  deleteAlbumPhoto,
  requestUpload,
  confirmUpload,
  getListAlbumPhotosQueryKey,
  type AlbumPhotoResponse,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useSearch } from "wouter";
import { timeAgo } from "@/lib/format";
import { shrinkImage } from "@/lib/shrinkImage";
import { apiErrorMessage } from "@/lib/api-errors";

export const ALBUM_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_MEDIA_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "video/mp4",
  "video/quicktime",
]);
const FILE_ACCEPT =
  "image/jpeg,image/png,image/gif,image/webp,video/mp4,video/quicktime";

type PreviewItem = {
  src: string;
  kind: "image" | "video";
  name: string;
  objectUrl: boolean;
};

function normalizeMediaType(type: string): string {
  const normalized = type.split(";")[0].trim().toLowerCase();
  return normalized === "image/jpg" ? "image/jpeg" : normalized;
}

function errorCode(err: unknown): string | null {
  if (!err || typeof err !== "object") return null;
  const data = (err as { data?: unknown; body?: unknown }).data ??
    (err as { body?: unknown }).body;
  if (!data || typeof data !== "object") return null;
  return typeof (data as { code?: unknown }).code === "string"
    ? String((data as { code: string }).code)
    : null;
}

function friendlyUploadError(err: unknown): string {
  switch (errorCode(err)) {
    case "ALBUM_FILE_TOO_LARGE":
    case "PAYLOAD_TOO_LARGE":
      return "That file is over 10 MB. Choose a shorter clip or trim it in your phone’s Photos/Gallery app.";
    case "ALBUM_UNSUPPORTED_FORMAT":
    case "ALBUM_ASSET_MISMATCH":
      return "Choose the original JPEG/PNG photo or an MP4/MOV video and try again.";
    case "MINOR_BLOCKED":
      return "Under-13 accounts can only upload JPEG or PNG photos.";
    case "ALBUM_MEMBERS_ONLY":
    case "FORBIDDEN":
      return "This account isn’t allowed to add media to this team album.";
    default:
      return apiErrorMessage(err) ?? "The upload failed. Check your connection and try again.";
  }
}

// Task #535 — one-time migration of any photos still sitting in
// `kinectem.photoAlbums.v1` from the localStorage prototype. On first
// mount for a post that has legacy data, we upload each photo to the
// server and clear the bucket for this post. Best-effort: partial
// failures simply leave the remaining entries in localStorage so a
// later mount can retry.
const LEGACY_STORAGE_KEY = "kinectem.photoAlbums.v1";
const MIGRATION_DONE_KEY = (postId: string) => `kinectem.albumMigrated.${postId}`;

type LegacyPhoto = {
  id: string;
  postId: string;
  dataUrl: string;
  uploaderName: string;
  caption: string;
  createdAt: string;
};

function dataUrlToBlob(dataUrl: string): Blob | null {
  const match = /^data:([^;,]+)(;base64)?,(.*)$/.exec(dataUrl);
  if (!match) return null;
  const mime = match[1] || "application/octet-stream";
  const isBase64 = !!match[2];
  const payload = match[3];
  try {
    if (isBase64) {
      const bin = atob(payload);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      return new Blob([arr], { type: mime });
    }
    return new Blob([decodeURIComponent(payload)], { type: mime });
  } catch {
    return null;
  }
}

async function uploadAlbumMedia(blob: Blob, fileName: string): Promise<string> {
  const upload = await requestUpload({
    fileName,
    fileType: blob.type || "image/jpeg",
    fileSize: blob.size,
  });
  const putResp = await fetch(upload.uploadUrl, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": blob.type || "image/jpeg" },
    body: blob,
  });
  if (!putResp.ok) {
    let body: unknown;
    try {
      body = await putResp.json();
    } catch {
      body = null;
    }
    const message =
      body && typeof body === "object" &&
      typeof (body as { error?: unknown }).error === "string"
        ? String((body as { error: string }).error)
        : `Upload failed (${putResp.status})`;
    throw Object.assign(new Error(message), { data: body });
  }
  await confirmUpload(upload.assetId);
  return upload.assetId;
}

// Task #660 — the album list response carries viewer capabilities beyond the
// generated spec types (openapi.yaml is locked): `canUpload` marks team
// members (roster, parents of active members, org managers) who may add
// media, and each item's `canDelete` marks the uploader / post author /
// team managers / platform admins.
type AlbumPhotoWithCaps = AlbumPhotoResponse & { canDelete?: boolean };
type AlbumListWithCaps = { data?: AlbumPhotoWithCaps[]; canUpload?: boolean };

export function GamePhotoAlbum({ postId }: { postId: string }) {
  const { data: me } = useGetLoggedInUser();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data, refetch } = useListAlbumPhotos(postId);
  const album = data as AlbumListWithCaps | undefined;
  const media: AlbumPhotoWithCaps[] = album?.data ?? [];
  const canUpload = album?.canUpload === true;

  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<PreviewItem[]>([]);
  const [uploaderName, setUploaderName] = useState("");
  const [caption, setCaption] = useState("");
  const [saving, setSaving] = useState(false);
  const [lightbox, setLightbox] = useState<AlbumPhotoWithCaps | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    return () => {
      for (const preview of previews) {
        if (preview.objectUrl) URL.revokeObjectURL(preview.src);
      }
    };
  }, [previews]);

  // The feed card's media button links here with `?album=1` — scroll
  // the album into view and, if the viewer can upload, open the Add
  // Photos dialog right away. Runs once per mount after the list loads
  // (we need `canUpload` from the response before deciding to open).
  const search = useSearch();
  const wantsAlbum = new URLSearchParams(search).get("album") === "1";
  const autoOpenedRef = useRef(false);
  useEffect(() => {
    if (!wantsAlbum || autoOpenedRef.current) return;
    if (!album) return;
    autoOpenedRef.current = true;
    sectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    if (album.canUpload === true) setOpen(true);
  }, [wantsAlbum, album]);

  const defaultName =
    me && "firstName" in me && "lastName" in me
      ? `${me.firstName} ${me.lastName}`
      : "";

  // Best-effort one-time migration from the old localStorage prototype.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!me || !("id" in me)) return;
    if (localStorage.getItem(MIGRATION_DONE_KEY(postId)) === "1") return;
    let raw: string | null;
    try {
      raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    } catch {
      return;
    }
    if (!raw) {
      localStorage.setItem(MIGRATION_DONE_KEY(postId), "1");
      return;
    }
    let store: Record<string, LegacyPhoto[]> = {};
    try {
      store = JSON.parse(raw) as Record<string, LegacyPhoto[]>;
    } catch {
      localStorage.setItem(MIGRATION_DONE_KEY(postId), "1");
      return;
    }
    const legacy = store[postId] ?? [];
    if (legacy.length === 0) {
      localStorage.setItem(MIGRATION_DONE_KEY(postId), "1");
      return;
    }

    let cancelled = false;
    (async () => {
      let uploaded = 0;
      const remaining: LegacyPhoto[] = [];
      for (const p of legacy) {
        const blob = dataUrlToBlob(p.dataUrl);
        if (!blob) {
          // Unparseable legacy entry — preserve it so a future code
          // path (or manual recovery) can still see the raw payload.
          // Dropping silently would lose user data.
          remaining.push(p);
          continue;
        }
        try {
          const assetId = await uploadAlbumMedia(blob, `${p.id}.jpg`);
          await createAlbumPhoto(postId, {
            assetId,
            uploaderName: p.uploaderName || "Anonymous fan",
            caption: p.caption || "",
          });
          uploaded += 1;
        } catch {
          remaining.push(p);
        }
        if (cancelled) return;
      }
      // Persist whatever didn't make it so a later mount can retry.
      try {
        const next = { ...store, [postId]: remaining };
        if (remaining.length === 0) delete next[postId];
        localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // localStorage may be full / disabled — best effort only.
      }
      if (remaining.length === 0) {
        localStorage.setItem(MIGRATION_DONE_KEY(postId), "1");
      }
      if (uploaded > 0) {
        toast({
          title: `Restored ${uploaded} photo${uploaded === 1 ? "" : "s"} to the album`,
          description: "We moved your local photos to the server.",
        });
        await queryClient.invalidateQueries({
          queryKey: getListAlbumPhotosQueryKey(postId),
        });
      }
    })();
    return () => {
      cancelled = true;
    };
    // We intentionally key only on postId + identity of `me`. The toast /
    // queryClient closures are stable for the duration of this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postId, me && "id" in me ? me.id : null]);

  const onFilesPicked = async (fileList: FileList | null) => {
    if (!fileList) return;
    const picked: File[] = [];
    for (const f of Array.from(fileList)) {
      const fileType = normalizeMediaType(f.type);
      if (!ALLOWED_MEDIA_TYPES.has(fileType)) {
        toast({
          title: "That file format isn’t supported",
          description: `${f.name}: choose a JPEG/PNG photo or an MP4/MOV video.`,
          variant: "destructive",
        });
        continue;
      }
      if (f.size > ALBUM_UPLOAD_MAX_BYTES) {
        const isVideo = fileType.startsWith("video/");
        toast({
          title: `${isVideo ? "Video" : "Photo"} too large`,
          description: isVideo
            ? `${f.name} is over 10 MB. Choose a shorter clip or trim it in your phone’s Photos/Gallery app.`
            : `${f.name} is over 10 MB. Choose a smaller photo.`,
          variant: "destructive",
        });
        continue;
      }
      picked.push(f);
    }
    if (picked.length === 0) return;
    const createdObjectUrls: string[] = [];
    try {
      const prepared = await Promise.all(
        picked.map((f) =>
          normalizeMediaType(f.type).startsWith("image/")
            ? shrinkImage(f)
            : Promise.resolve(f),
        ),
      );
      const previewItems = await Promise.all(
        prepared.map(
          (f): Promise<PreviewItem> => {
            if (normalizeMediaType(f.type).startsWith("video/")) {
              const src = URL.createObjectURL(f);
              createdObjectUrls.push(src);
              return Promise.resolve({
                src,
                kind: "video",
                name: f.name,
                objectUrl: true,
              });
            }
            return new Promise<PreviewItem>((resolve, reject) => {
              const r = new FileReader();
              r.onload = () =>
                resolve({
                  src: String(r.result),
                  kind: "image",
                  name: f.name,
                  objectUrl: false,
                });
              r.onerror = () => reject(r.error ?? new Error("Read failed"));
              r.readAsDataURL(f);
            });
          },
        ),
      );
      setFiles(prepared);
      setPreviews(previewItems);
    } catch {
      createdObjectUrls.forEach((src) => URL.revokeObjectURL(src));
      toast({
        title: "Couldn’t read those files",
        description: "Choose the original photo or video and try again.",
        variant: "destructive",
      });
    }
  };

  const reset = () => {
    setFiles([]);
    setPreviews([]);
    setCaption("");
    if (inputRef.current) inputRef.current.value = "";
  };

  const onSubmit = async () => {
    if (files.length === 0) {
      toast({
        title: "Pick at least one photo or video",
        variant: "destructive",
      });
      return;
    }
    const name = (uploaderName || defaultName || "Anonymous fan").trim();
    setSaving(true);
    try {
      for (const f of files) {
        const assetId = await uploadAlbumMedia(f, f.name || "game-media");
        await createAlbumPhoto(postId, {
          assetId,
          uploaderName: name,
          caption: caption.trim(),
        });
      }
      toast({
        title: `Added ${files.length} media item${files.length === 1 ? "" : "s"}`,
        description: "Thanks for sharing.",
      });
      reset();
      setOpen(false);
      await refetch();
    } catch (err) {
      toast({
        title: "Couldn’t add that media",
        description: friendlyUploadError(err),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const onRemove = async (photoId: string) => {
    try {
      await deleteAlbumPhoto(postId, photoId);
      setLightbox(null);
      await refetch();
    } catch (err) {
      toast({
        title: "Couldn’t remove that media",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <section ref={sectionRef} className="space-y-4 scroll-mt-20" data-testid="section-photo-album">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-2xl font-black tracking-tight flex items-center gap-2">
            <Camera className="w-5 h-5 text-primary" />
            Photo &amp; Video Album
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            {canUpload
              ? "Team members can add photos and short videos from the game."
              : "Photos and videos from the team community."}
          </p>
        </div>

        {canUpload && (
        <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
          <DialogTrigger asChild>
            <Button
              variant="brand"
              size="sm"
              data-testid="button-open-upload"
            >
              <ImagePlus className="w-4 h-4" />
              Add Media
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle className="font-black tracking-tight">
                Add Photos or Videos
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label htmlFor="uploader-name" className="text-xs font-bold">
                  Your name
                </Label>
                <Input
                  id="uploader-name"
                  value={uploaderName}
                  placeholder={defaultName || "Anonymous fan"}
                  onChange={(e) => setUploaderName(e.target.value)}
                  data-testid="input-uploader-name"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="album-files" className="text-xs font-bold">
                  Photos and videos
                </Label>
                <div className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground space-y-1">
                  <p>
                    <strong className="text-foreground">iPhone:</strong> tap Add
                    Video, choose Photos, then select your clip (.MOV is okay).
                  </p>
                  <p>
                    <strong className="text-foreground">Android:</strong> choose
                    Gallery/Google Photos, then select an MP4 clip.
                  </p>
                  <p>
                    10 MB per photo or video. If a clip is too large, choose a
                    shorter clip or trim it in your phone’s Photos/Gallery app.
                  </p>
                  {me && "isMinor" in me && me.isMinor && (
                    <p className="font-medium text-foreground">
                      Under-13 accounts can only upload JPEG or PNG photos.
                    </p>
                  )}
                </div>
                <Input
                  id="album-files"
                  ref={inputRef}
                  type="file"
                  accept={FILE_ACCEPT}
                  multiple
                  onChange={(e) => onFilesPicked(e.target.files)}
                  data-testid="input-album-files"
                />
                {previews.length > 0 && (
                  <div className="grid grid-cols-3 gap-2 pt-2">
                    {previews.map((preview, i) => (
                      <div
                        key={`${preview.name}-${i}`}
                        className="relative aspect-square rounded-lg overflow-hidden bg-black"
                      >
                        {preview.kind === "video" ? (
                          <>
                            <video
                              src={preview.src}
                              className="w-full h-full object-cover"
                              muted
                              playsInline
                              preload="metadata"
                              aria-label={`Video preview: ${preview.name}`}
                            />
                            <PlayCircle className="absolute inset-0 m-auto h-8 w-8 text-white drop-shadow" />
                            <span className="absolute bottom-1 left-1 rounded bg-black/70 px-1.5 py-0.5 text-[9px] font-bold text-white">
                              VIDEO
                            </span>
                          </>
                        ) : (
                          <img
                            src={preview.src}
                            alt={`Photo preview: ${preview.name}`}
                            className="w-full h-full object-cover"
                          />
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="album-caption" className="text-xs font-bold">
                  Caption (optional)
                </Label>
                <Input
                  id="album-caption"
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  placeholder="3rd quarter touchdown"
                  data-testid="input-album-caption"
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => { reset(); setOpen(false); }}
                className="font-bold"
              >
                Cancel
              </Button>
              <Button
                variant="brand"
                onClick={onSubmit}
                disabled={saving || files.length === 0}
                data-testid="button-submit-media"
              >
                {saving
                  ? "Adding…"
                  : `Add ${files.length || ""} item${files.length === 1 ? "" : "s"}`.trim()}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        )}
      </div>

      {media.length === 0 ? (
        <Card className="rounded-xl border border-border border-dashed">
          <CardContent className="p-10 text-center space-y-2">
            <Camera className="w-8 h-8 text-muted-foreground mx-auto" />
            <p className="text-sm font-bold">No photos or videos yet</p>
            <p className="text-xs text-muted-foreground">
              {canUpload
                ? "Be the first to share a moment from the game."
                : "Team members haven’t added any media yet."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {media.map((p) => {
              const isVideo = p.fileType.startsWith("video/");
              return (
              <button
                key={p.id}
                onClick={() => setLightbox(p)}
                className="group relative aspect-square rounded-lg overflow-hidden bg-muted cursor-pointer"
                data-testid={`album-photo-${p.id}`}
                aria-label={`Open ${isVideo ? "video" : "photo"} from ${p.uploaderName}`}
              >
                {isVideo ? (
                  <>
                    <video
                      src={p.url}
                      className="w-full h-full object-cover"
                      muted
                      playsInline
                      preload="metadata"
                    />
                    <PlayCircle className="absolute inset-0 m-auto h-10 w-10 text-white drop-shadow-lg" />
                    <span className="absolute left-2 top-2 rounded bg-black/70 px-2 py-1 text-[10px] font-black text-white">
                      VIDEO
                    </span>
                  </>
                ) : (
                  <img
                    src={p.url}
                    alt={p.caption || "fan photo"}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                  />
                )}
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-2 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                  <p className="text-[10px] font-bold text-white truncate">
                    {p.uploaderName}
                  </p>
                </div>
              </button>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground">
            {media.length} media item{media.length === 1 ? "" : "s"} from the team
          </p>
        </>
      )}

      <Dialog open={!!lightbox} onOpenChange={(o) => !o && setLightbox(null)}>
        <DialogContent
          className="sm:max-w-3xl p-0 overflow-hidden"
        >
          <DialogTitle className="sr-only">Album media details</DialogTitle>
          <DialogDescription className="sr-only">
            View the selected album photo or video, its caption and uploader,
            and remove it when permitted.
          </DialogDescription>
          {lightbox && (
            <>
              <button
                onClick={() => setLightbox(null)}
                className="absolute top-3 right-3 z-10 bg-black/60 hover:bg-black/80 rounded-full p-1.5 text-white"
                data-testid="button-close-lightbox"
              >
                <X className="w-4 h-4" />
              </button>
              {lightbox.fileType.startsWith("video/") ? (
                <video
                  className="w-full max-h-[70vh] bg-black"
                  controls
                  playsInline
                  preload="metadata"
                  data-testid={`album-video-player-${lightbox.id}`}
                >
                  <source src={lightbox.url} type={lightbox.fileType} />
                  Your browser can’t play this video. Download it or try another
                  browser.
                </video>
              ) : (
                <img
                  src={lightbox.url}
                  alt={lightbox.caption || "Album photo"}
                  className="w-full max-h-[70vh] object-contain bg-black"
                />
              )}
              <div className="p-4 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-bold text-sm">{lightbox.uploaderName}</p>
                  <p className="text-xs text-muted-foreground">
                    {timeAgo(lightbox.createdAt)}
                    {lightbox.caption && ` • ${lightbox.caption}`}
                  </p>
                </div>
                {lightbox.canDelete && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="font-bold gap-1 text-destructive hover:text-destructive"
                    onClick={() => onRemove(lightbox.id)}
                    data-testid={`button-remove-photo-${lightbox.id}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Remove
                  </Button>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
