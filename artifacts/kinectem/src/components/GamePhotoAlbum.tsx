import { useEffect, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Camera, ImagePlus, Trash2, X } from "lucide-react";
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
import { timeAgo } from "@/lib/format";
import { shrinkImage, IMAGE_UPLOAD_MAX_BYTES } from "@/lib/shrinkImage";

const MAX_BYTES = IMAGE_UPLOAD_MAX_BYTES;

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

async function uploadFanPhoto(blob: Blob, fileName: string): Promise<string> {
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
    throw new Error(`Upload failed (${putResp.status})`);
  }
  await confirmUpload(upload.assetId);
  return upload.assetId;
}

export function GamePhotoAlbum({ postId }: { postId: string }) {
  const { data: me } = useGetLoggedInUser();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data, refetch } = useListAlbumPhotos(postId);
  const photos = data?.data ?? [];

  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [uploaderName, setUploaderName] = useState("");
  const [caption, setCaption] = useState("");
  const [saving, setSaving] = useState(false);
  const [lightbox, setLightbox] = useState<AlbumPhotoResponse | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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
          const assetId = await uploadFanPhoto(blob, `${p.id}.jpg`);
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
      if (!f.type.startsWith("image/")) continue;
      if (f.size > MAX_BYTES) {
        toast({
          title: "Photo too large",
          description: `${f.name} is over 5 MB.`,
          variant: "destructive",
        });
        continue;
      }
      picked.push(f);
    }
    if (picked.length === 0) return;
    try {
      const shrunk = await Promise.all(picked.map((f) => shrinkImage(f)));
      setFiles(shrunk);
      const previewUrls = await Promise.all(
        shrunk.map(
          (f) =>
            new Promise<string>((resolve, reject) => {
              const r = new FileReader();
              r.onload = () => resolve(String(r.result));
              r.onerror = () => reject(r.error ?? new Error("Read failed"));
              r.readAsDataURL(f);
            }),
        ),
      );
      setPreviews(previewUrls);
    } catch {
      toast({ title: "Couldn't read those photos", variant: "destructive" });
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
        title: "Pick at least one photo",
        variant: "destructive",
      });
      return;
    }
    const name = (uploaderName || defaultName || "Anonymous fan").trim();
    setSaving(true);
    try {
      for (const f of files) {
        const assetId = await uploadFanPhoto(f, f.name || "fan-photo.jpg");
        await createAlbumPhoto(postId, {
          assetId,
          uploaderName: name,
          caption: caption.trim(),
        });
      }
      toast({
        title: `Added ${files.length} photo${files.length === 1 ? "" : "s"}`,
        description: "Thanks for sharing.",
      });
      reset();
      setOpen(false);
      await refetch();
    } catch (err) {
      toast({
        title: "Couldn't add those photos",
        description: err instanceof Error ? err.message : "Please try again.",
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
        title: "Couldn't remove that photo",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <section className="space-y-4" data-testid="section-photo-album">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-2xl font-black tracking-tight flex items-center gap-2">
            <Camera className="w-5 h-5 text-primary" />
            Fan Photo Album
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Open album — anyone at the game can add their photos.
          </p>
        </div>

        <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
          <DialogTrigger asChild>
            <Button
              variant="brand"
              size="sm"
              data-testid="button-open-upload"
            >
              <ImagePlus className="w-4 h-4" />
              Add Photos
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle className="font-black tracking-tight">
                Add Photos to the Album
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
                  Photos
                </Label>
                <Input
                  id="album-files"
                  ref={inputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={(e) => onFilesPicked(e.target.files)}
                  data-testid="input-album-files"
                />
                {previews.length > 0 && (
                  <div className="grid grid-cols-3 gap-2 pt-2">
                    {previews.map((src, i) => (
                      <div
                        key={i}
                        className="aspect-square rounded-lg overflow-hidden bg-muted"
                      >
                        <img
                          src={src}
                          alt=""
                          className="w-full h-full object-cover"
                        />
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
                data-testid="button-submit-photos"
              >
                {saving ? "Adding…" : `Add ${files.length || ""} photo${files.length === 1 ? "" : "s"}`.trim()}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {photos.length === 0 ? (
        <Card className="rounded-xl border border-border border-dashed">
          <CardContent className="p-10 text-center space-y-2">
            <Camera className="w-8 h-8 text-muted-foreground mx-auto" />
            <p className="text-sm font-bold">No photos yet</p>
            <p className="text-xs text-muted-foreground">
              Be the first to share a shot from the game.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {photos.map((p) => (
              <button
                key={p.id}
                onClick={() => setLightbox(p)}
                className="group relative aspect-square rounded-lg overflow-hidden bg-muted cursor-pointer"
                data-testid={`album-photo-${p.id}`}
              >
                <img
                  src={p.url}
                  alt={p.caption || "fan photo"}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                />
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <p className="text-[10px] font-bold text-white truncate">
                    {p.uploaderName}
                  </p>
                </div>
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            {photos.length} photo{photos.length === 1 ? "" : "s"} from the community
          </p>
        </>
      )}

      <Dialog open={!!lightbox} onOpenChange={(o) => !o && setLightbox(null)}>
        <DialogContent className="sm:max-w-3xl p-0 overflow-hidden">
          {lightbox && (
            <>
              <button
                onClick={() => setLightbox(null)}
                className="absolute top-3 right-3 z-10 bg-black/60 hover:bg-black/80 rounded-full p-1.5 text-white"
                data-testid="button-close-lightbox"
              >
                <X className="w-4 h-4" />
              </button>
              <img
                src={lightbox.url}
                alt=""
                className="w-full max-h-[70vh] object-contain bg-black"
              />
              <div className="p-4 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-bold text-sm">{lightbox.uploaderName}</p>
                  <p className="text-xs text-muted-foreground">
                    {timeAgo(lightbox.createdAt)}
                    {lightbox.caption && ` • ${lightbox.caption}`}
                  </p>
                </div>
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
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
