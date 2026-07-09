import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Upload, X } from "lucide-react";
import {
  shrinkImageToDataUrl,
  isUnsupportedHeicImage,
  IMAGE_UPLOAD_MAX_BYTES,
  BANNER_SHRINK_MAX_DIMENSION,
  BANNER_SHRINK_OUTPUT_QUALITY,
} from "@/lib/shrinkImage";

// Logo/banner field for competition branding: upload a file (stored inline as
// a base64 data: URL — same pattern as org logos / team banners) or paste an
// http(s) URL. Uploads shrink client-side before send.

export function BrandImageField({
  label,
  value,
  onChange,
  kind,
  idPrefix,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  kind: "logo" | "banner";
  idPrefix: string;
}) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const isDataUrl = value.startsWith("data:");

  const pickFile = async (file: File) => {
    if (isUnsupportedHeicImage(file)) {
      toast({
        title: "That photo format isn't supported",
        description: "Please choose a JPG or PNG version.",
        variant: "destructive",
      });
      return;
    }
    if (file.size > IMAGE_UPLOAD_MAX_BYTES) {
      toast({
        title: "That image is too large",
        description: "Please choose an image under 5 MB.",
        variant: "destructive",
      });
      return;
    }
    setUploading(true);
    try {
      const dataUrl = await shrinkImageToDataUrl(
        file,
        kind === "banner"
          ? {
              maxDimension: BANNER_SHRINK_MAX_DIMENSION,
              quality: BANNER_SHRINK_OUTPUT_QUALITY,
            }
          : undefined,
      );
      onChange(dataUrl);
    } catch {
      toast({
        title: "Couldn't read that image",
        description: "Please try a different file.",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-1.5">
      <Label htmlFor={`${idPrefix}-url`} className="text-xs font-bold">
        {label}
      </Label>
      <div className="flex items-center gap-2">
        {isDataUrl ? (
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-border bg-muted/40 px-2 py-1">
            <img
              src={value}
              alt=""
              className={
                kind === "logo"
                  ? "h-8 w-8 rounded object-contain"
                  : "h-8 w-14 rounded object-cover"
              }
            />
            <span className="truncate text-xs text-muted-foreground">
              Uploaded image
            </span>
            <button
              type="button"
              className="ml-auto text-muted-foreground hover:text-foreground"
              onClick={() => onChange("")}
              title="Remove"
              data-testid={`btn-${idPrefix}-remove`}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <Input
            id={`${idPrefix}-url`}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={
              kind === "logo" ? "https://…/logo.png" : "https://…/banner.jpg"
            }
            data-testid={`input-${idPrefix}-url`}
          />
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void pickFile(f);
            e.target.value = "";
          }}
          data-testid={`input-${idPrefix}-file`}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0 font-bold"
          disabled={uploading}
          onClick={() => fileRef.current?.click()}
          data-testid={`btn-${idPrefix}-upload`}
        >
          <Upload className="mr-1.5 h-3.5 w-3.5" />
          {uploading ? "Uploading…" : "Upload"}
        </Button>
      </div>
    </div>
  );
}
