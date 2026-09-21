import { useRef, useState } from "react";
import { formatOrgName } from "@/lib/format";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateOrgPost,
  getListOrgPostsQueryKey,
  getListFeedQueryKey,
} from "@workspace/api-client-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { ImagePlus, Video, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  DATA_URL_MAX_LENGTH,
  POST_IMAGES_TOTAL_MAX_LENGTH,
  UnsupportedImageFormatError,
  shrinkImageToDataUrl,
} from "@/lib/shrinkImage";

export function NewOrgPostDialog({
  orgId,
  orgName,
  open,
  onOpenChange,
}: {
  orgId: string;
  orgName: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const createOrgPost = useCreateOrgPost();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [videoUrl, setVideoUrl] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const photosRef = useRef<string[]>([]);
  const photoSelectionQueueRef = useRef(Promise.resolve());

  const reset = () => {
    setTitle("");
    setBody("");
    photosRef.current = [];
    setPhotos([]);
    setVideoUrl("");
  };

  const handleClose = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const onFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    photoSelectionQueueRef.current = photoSelectionQueueRef.current.then(
      async () => {
        const selected = Array.from(files).filter(
          (file) =>
            file.type.startsWith("image/") ||
            /\.(jpe?g|png|webp|gif|heic|heif)$/i.test(file.name),
        );
        if (selected.length === 0) {
          toast({
            title: "Choose an image file",
            description: "Select a JPG, PNG, WebP, or GIF photo.",
            variant: "destructive",
          });
          return;
        }

        const processed = await Promise.all(
          selected.map(async (file) => {
            try {
              return {
                status: "ready" as const,
                dataUrl: await shrinkImageToDataUrl(file),
              };
            } catch (error) {
              return { status: "failed" as const, error };
            }
          }),
        );

        let running = photosRef.current.reduce(
          (sum, photo) => sum + photo.length,
          0,
        );
        const fits: string[] = [];
        let rejectedForSpace = 0;
        let unsupported = 0;
        let unreadable = 0;
        for (const result of processed) {
          if (result.status === "failed") {
            if (
              result.error instanceof UnsupportedImageFormatError ||
              (result.error as { name?: unknown } | null)?.name ===
                "UnsupportedImageFormatError"
            ) {
              unsupported += 1;
            } else {
              unreadable += 1;
            }
            continue;
          }
          if (
            result.dataUrl.length > DATA_URL_MAX_LENGTH ||
            running + result.dataUrl.length > POST_IMAGES_TOTAL_MAX_LENGTH
          ) {
            rejectedForSpace += 1;
            continue;
          }
          running += result.dataUrl.length;
          fits.push(result.dataUrl);
        }

        if (fits.length > 0) {
          const next = [...photosRef.current, ...fits];
          photosRef.current = next;
          setPhotos(next);
        }
        if (unsupported > 0) {
          toast({
            title:
              unsupported === 1
                ? "That photo format isn't supported"
                : `${unsupported} photo formats aren't supported`,
            description:
              "Choose a JPG, PNG, WebP, or GIF. For an iPhone HEIC photo, export or share it as JPG first.",
            variant: "destructive",
          });
        }
        if (unreadable > 0) {
          toast({
            title:
              unreadable === 1
                ? "Couldn't read that photo"
                : `Couldn't read ${unreadable} photos`,
            description: "Try selecting the photo again or choose a different one.",
            variant: "destructive",
          });
        }
        if (rejectedForSpace > 0) {
          toast({
            title:
              rejectedForSpace === 1
                ? "Photo too large to add"
                : `${rejectedForSpace} photos too large to add`,
            description:
              "Kinectem couldn't make these photos small enough for this post. Remove some photos or choose smaller ones.",
            variant: "destructive",
          });
        }
      },
    );
  };

  const removePhoto = (idx: number) => {
    const next = photosRef.current.filter((_, i) => i !== idx);
    photosRef.current = next;
    setPhotos(next);
  };

  const onSubmit = async () => {
    const trimmed = title.trim();
    if (!trimmed) {
      toast({ title: "Title is required", variant: "destructive" });
      return;
    }
    try {
      await createOrgPost.mutateAsync({
        orgId,
        data: {
          title: trimmed,
          body: body.trim(),
          photoUrls: photos,
          videoUrl: videoUrl.trim() || null,
        },
      });
      await Promise.all([
        qc.invalidateQueries({ queryKey: getListOrgPostsQueryKey(orgId) }),
        qc.invalidateQueries({ queryKey: getListFeedQueryKey() }),
      ]);
      toast({ title: "Announcement posted" });
      reset();
      onOpenChange(false);
    } catch {
      toast({ title: "Couldn't publish post", variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-xl rounded-xl">
        <DialogHeader>
          <DialogTitle className="text-2xl font-black tracking-tight">
            New announcement
          </DialogTitle>
          <DialogDescription>
            Share an update with everyone who follows {formatOrgName(orgName)}.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label
              htmlFor="orgPostTitle"
              className="text-xs font-black uppercase tracking-widest text-muted-foreground"
            >
              Title
            </Label>
            <Input
              id="orgPostTitle"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What's the announcement?"
              className="mt-2"
              data-testid="input-org-post-title"
            />
          </div>
          <div>
            <Label
              htmlFor="orgPostBody"
              className="text-xs font-black uppercase tracking-widest text-muted-foreground"
            >
              Message
            </Label>
            <Textarea
              id="orgPostBody"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Share details, links, schedules…"
              className="mt-2 min-h-32"
              data-testid="textarea-org-post-body"
            />
          </div>

          <div className="space-y-3 pt-2 border-t border-border">
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold flex items-center gap-1.5">
                <ImagePlus className="w-4 h-4" /> Photos
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="font-bold rounded-full"
                onClick={() => inputRef.current?.click()}
                data-testid="button-add-org-post-photos"
              >
                <ImagePlus className="w-3.5 h-3.5 mr-1.5" /> Add Photos
              </Button>
              <input
                ref={inputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                data-testid="input-org-post-photos"
                onChange={(e) => {
                  onFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </div>
            {photos.length > 0 && (
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
                      onClick={() => removePhoto(i)}
                      className="absolute top-1 right-1 bg-black/60 hover:bg-black/80 text-white rounded-full p-1"
                      data-testid={`button-remove-org-post-photo-${i}`}
                      aria-label="Remove photo"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Photos are compressed automatically. Use JPG, PNG, WebP, or GIF;
              iPhone HEIC photos must be exported as JPG first.
            </p>
            <div>
              <Label
                htmlFor="orgPostVideoUrl"
                className="text-sm font-bold flex items-center gap-1.5"
              >
                <Video className="w-4 h-4" /> Video link
              </Label>
              <Input
                id="orgPostVideoUrl"
                value={videoUrl}
                onChange={(e) => setVideoUrl(e.target.value)}
                placeholder="Paste a YouTube, Vimeo, or other video link"
                className="mt-2"
                data-testid="input-org-post-video-url"
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleClose(false)}
            disabled={createOrgPost.isPending}
            className="font-bold rounded-full"
          >
            Cancel
          </Button>
          <Button
            variant="brand"
            onClick={onSubmit}
            disabled={createOrgPost.isPending}
            data-testid="button-publish-org-post"
          >
            {createOrgPost.isPending ? "Publishing…" : "Publish"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
