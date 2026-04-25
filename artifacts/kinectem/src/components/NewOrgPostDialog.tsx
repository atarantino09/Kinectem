import { useRef, useState } from "react";
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

  const reset = () => {
    setTitle("");
    setBody("");
    setPhotos([]);
    setVideoUrl("");
  };

  const handleClose = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

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
    setPhotos((prev) => [...prev, ...next]);
  };

  const removePhoto = (idx: number) => {
    setPhotos((prev) => prev.filter((_, i) => i !== idx));
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
            Share an update with everyone who follows {orgName}.
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
            onClick={onSubmit}
            disabled={createOrgPost.isPending}
            className="font-bold rounded-full"
            data-testid="button-publish-org-post"
          >
            {createOrgPost.isPending ? "Publishing…" : "Publish"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
