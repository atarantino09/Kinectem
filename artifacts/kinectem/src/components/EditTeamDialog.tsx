import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  customFetch,
  getGetTeamByIdQueryKey,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  shrinkImageToDataUrl,
  IMAGE_UPLOAD_MAX_BYTES,
} from "@/lib/shrinkImage";
import { normalizeWebsite } from "@/lib/normalizeWebsite";
import { TeamPhotoCropDialog } from "@/components/TeamPhotoCropDialog";
import { SPORTS } from "@/lib/sports";

type TeamLike = {
  id: string;
  name: string;
  description?: string | null;
  website?: string | null;
  sport?: string | null;
  level?: string | null;
  gender?: "boys" | "girls" | "coed" | null;
  bannerUrl?: string | null;
};

export function EditTeamDialog({
  team,
  canManagePhoto = false,
  open,
  onOpenChange,
}: {
  team: TeamLike;
  /** Same admin gate that previously controlled "Manage logo". */
  canManagePhoto?: boolean;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [name, setName] = useState(team.name);
  const [description, setDescription] = useState(team.description ?? "");
  const [website, setWebsite] = useState(team.website ?? "");
  const [websiteError, setWebsiteError] = useState<string | undefined>(
    undefined,
  );
  const [sport, setSport] = useState(team.sport ?? "");
  const [gender, setGender] = useState<"boys" | "girls" | "coed" | "">(
    team.gender ?? "",
  );
  const [level, setLevel] = useState(team.level ?? "");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // Crop dialog state. We hold the picked file's data URL + filename so
  // the user can drag/zoom into the team-page banner shape *before* we
  // hand the cropped result to the existing shrink + PATCH pipeline.
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [cropFileName, setCropFileName] = useState<string>("team-photo");
  const [cropOpen, setCropOpen] = useState(false);

  useEffect(() => {
    if (open) {
      setName(team.name);
      setDescription(team.description ?? "");
      setWebsite(team.website ?? "");
      setWebsiteError(undefined);
      setSport(team.sport ?? "");
      setGender(team.gender ?? "");
      setLevel(team.level ?? "");
    }
    // Only re-seed the form when the dialog transitions to open, or when
    // a different team is being edited. Refetches caused by in-dialog
    // photo changes must not wipe the user's unsaved text edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, team.id]);

  const onPickPhoto = () => fileInputRef.current?.click();

  const onRemovePhoto = async () => {
    setUploading(true);
    try {
      await customFetch(`/api/v1/teams/${team.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bannerUrl: null }),
      });
      await qc.invalidateQueries({ queryKey: getGetTeamByIdQueryKey(team.id) });
      toast({ title: "Team photo removed" });
    } catch {
      toast({ title: "Failed to remove team photo", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const onPhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast({ title: "Please pick an image file", variant: "destructive" });
      return;
    }
    if (file.size > IMAGE_UPLOAD_MAX_BYTES) {
      toast({ title: "Image must be under 5 MB", variant: "destructive" });
      return;
    }
    // Open the crop dialog with this file as a data URL. The actual
    // upload happens once the user confirms a crop in onCroppedConfirm.
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () =>
          reject(reader.error ?? new Error("Could not read file"));
        reader.readAsDataURL(file);
      });
      setCropSrc(dataUrl);
      setCropFileName(file.name);
      setCropOpen(true);
    } catch {
      toast({ title: "Couldn't read that photo", variant: "destructive" });
    }
  };

  const onCroppedConfirm = async (cropped: File) => {
    setUploading(true);
    try {
      // The cropped output is already constrained in size by the cropper,
      // but we still run it through shrinkImage for consistent JPEG
      // encoding + the global 1024px longest-edge cap.
      const dataUrl = await shrinkImageToDataUrl(cropped);
      await customFetch(`/api/v1/teams/${team.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bannerUrl: dataUrl }),
      });
      await qc.invalidateQueries({ queryKey: getGetTeamByIdQueryKey(team.id) });
      toast({ title: "Team photo updated" });
      // Only clear the staged crop source on success. On failure we
      // re-throw below so the crop dialog stays open and the user can
      // adjust + retry without re-picking the file.
      setCropSrc(null);
    } catch (err) {
      toast({ title: "Failed to upload team photo", variant: "destructive" });
      throw err;
    } finally {
      setUploading(false);
    }
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast({ title: "Name is required", variant: "destructive" });
      return;
    }
    // Task #293 — Normalize the website client-side using the same helper
    // the org form uses. Bare domains become `https://example.com`; obvious
    // garbage is surfaced inline instead of going to the server.
    const websiteResult = normalizeWebsite(website);
    if (!websiteResult.ok) {
      setWebsiteError(websiteResult.error);
      toast({ title: websiteResult.error, variant: "destructive" });
      return;
    }
    setWebsiteError(undefined);
    setSaving(true);
    try {
      await customFetch(`/api/v1/teams/${team.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description,
          // Always include website so a user can clear a previously-set
          // value by emptying the input. Empty string clears it server-side.
          website: websiteResult.value,
          sport,
          level,
          gender: gender || null,
        }),
      });
      await qc.invalidateQueries({ queryKey: getGetTeamByIdQueryKey(team.id) });
      toast({ title: "Team updated" });
      onOpenChange(false);
    } catch {
      toast({ title: "Failed to update team", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={onSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle className="font-black tracking-tight">
              Edit team
            </DialogTitle>
            <DialogDescription>
              Update your team's name, sport, league, description, and
              background photo.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {canManagePhoto && (
              <div className="space-y-1.5">
                <Label className="font-bold">Team photo</Label>
                <p className="text-xs text-muted-foreground">
                  Shows behind the org logo on this team's page. The logo
                  itself always comes from your organization.
                </p>
                <div className="space-y-2">
                  <div className="w-full h-28 bg-muted rounded-xl border border-border overflow-hidden flex items-center justify-center">
                    {team.bannerUrl ? (
                      <img
                        src={team.bannerUrl}
                        alt={`${team.name} background`}
                        className="w-full h-full object-cover"
                        data-testid="img-team-photo-preview"
                      />
                    ) : (
                      <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                        No team photo yet
                      </span>
                    )}
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={onPhotoChange}
                    data-testid="input-team-photo"
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="font-bold rounded-full"
                      onClick={onPickPhoto}
                      disabled={uploading}
                      data-testid="btn-upload-team-photo"
                    >
                      {uploading
                        ? "Working..."
                        : team.bannerUrl
                          ? "Change team photo"
                          : "Upload team photo"}
                    </Button>
                    {team.bannerUrl && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="font-bold rounded-full"
                        onClick={onRemovePhoto}
                        disabled={uploading}
                        data-testid="btn-remove-team-photo"
                      >
                        Remove team photo
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="edit-team-name" className="font-bold">
                Team name
              </Label>
              <Input
                id="edit-team-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
                data-testid="input-edit-team-name"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label className="font-bold">Sport</Label>
                <Select value={sport} onValueChange={setSport}>
                  <SelectTrigger data-testid="select-edit-team-sport">
                    <SelectValue placeholder="Pick sport" />
                  </SelectTrigger>
                  {/* position="popper" makes Radix honor the
                      --radix-select-content-available-height var that
                      shadcn's SelectContent caps at, so the full ~41-
                      entry SPORTS list scrolls inside the viewport on
                      both desktop and mobile instead of overflowing. */}
                  <SelectContent position="popper" className="max-h-[min(60vh,24rem)]">
                    {sport && !SPORTS.includes(sport) && (
                      <SelectItem key={sport} value={sport}>
                        {sport}
                      </SelectItem>
                    )}
                    {SPORTS.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="font-bold">Gender</Label>
                <Select
                  value={gender || "none"}
                  onValueChange={(v) =>
                    setGender(
                      v === "none" ? "" : (v as "boys" | "girls" | "coed"),
                    )
                  }
                >
                  <SelectTrigger data-testid="select-edit-team-gender">
                    <SelectValue placeholder="Pick gender" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    <SelectItem value="boys">Boys</SelectItem>
                    <SelectItem value="girls">Girls</SelectItem>
                    <SelectItem value="coed">Coed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-team-level" className="font-bold">
                  League
                </Label>
                <Input
                  id="edit-team-level"
                  value={level}
                  onChange={(e) => setLevel(e.target.value)}
                  placeholder="e.g. NJYS Premier"
                  data-testid="input-edit-team-level"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-team-desc" className="font-bold">
                Description
              </Label>
              <Textarea
                id="edit-team-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                data-testid="input-edit-team-description"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-team-website" className="font-bold">
                Website
              </Label>
              <Input
                id="edit-team-website"
                type="text"
                inputMode="url"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                placeholder="example.com"
                data-testid="input-edit-team-website"
              />
              {websiteError && (
                <p
                  className="text-xs font-medium text-destructive"
                  data-testid="error-edit-team-website"
                >
                  {websiteError}
                </p>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="brand"
              disabled={saving || uploading}
              data-testid="btn-save-edit-team"
            >
              {saving ? "Saving..." : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
    <TeamPhotoCropDialog
      src={cropSrc}
      fileName={cropFileName}
      open={cropOpen && !!cropSrc}
      onOpenChange={(v) => {
        setCropOpen(v);
        if (!v) setCropSrc(null);
      }}
      onConfirm={onCroppedConfirm}
    />
    </>
  );
}
