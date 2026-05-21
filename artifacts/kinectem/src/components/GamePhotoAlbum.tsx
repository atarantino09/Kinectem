import { useRef, useState } from "react";
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
import { useAlbum, AlbumQuotaError, type AlbumPhoto } from "@/lib/photoAlbum";
import { useGetLoggedInUser } from "@workspace/api-client-react";
import { timeAgo } from "@/lib/format";
import { shrinkImage, IMAGE_UPLOAD_MAX_BYTES } from "@/lib/shrinkImage";

const MAX_BYTES = IMAGE_UPLOAD_MAX_BYTES;

export function GamePhotoAlbum({ postId }: { postId: string }) {
  const { photos, addPhotos, removePhoto } = useAlbum(postId);
  const { data: me } = useGetLoggedInUser();
  const { toast } = useToast();

  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [uploaderName, setUploaderName] = useState("");
  const [caption, setCaption] = useState("");
  const [saving, setSaving] = useState(false);
  const [lightbox, setLightbox] = useState<AlbumPhoto | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const defaultName =
    me && "firstName" in me && "lastName" in me
      ? `${me.firstName} ${me.lastName}`
      : "";

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
      const shrunk = await Promise.all(picked.map(shrinkImage));
      setFiles(shrunk);
      // shrunk files are already small, so a plain FileReader is enough.
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
      addPhotos(
        files.map((_, i) => ({
          dataUrl: previews[i],
          uploaderName: name,
          caption: caption.trim(),
        })),
      );
      toast({
        title: `Added ${files.length} photo${files.length === 1 ? "" : "s"}`,
        description: "Thanks for sharing.",
      });
      reset();
      setOpen(false);
    } catch (err) {
      if (err instanceof AlbumQuotaError) {
        // Leave the dialog open and the picked files intact so the user can
        // remove a few existing album photos and retry without re-picking.
        toast({
          title: "Album storage is full on this device",
          description:
            "Remove some photos from this album before adding more.",
          variant: "destructive",
        });
        return;
      }
      throw err;
    } finally {
      setSaving(false);
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
                  src={p.dataUrl}
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
                src={lightbox.dataUrl}
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
                  onClick={() => {
                    removePhoto(lightbox.id);
                    setLightbox(null);
                  }}
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
