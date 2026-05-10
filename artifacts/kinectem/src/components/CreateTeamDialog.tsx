import { useRef, useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateTeam,
  getListOrgTeamsQueryKey,
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
import { TeamPhotoCropDialog } from "@/components/TeamPhotoCropDialog";

function slugify(s: string) {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

const SPORTS = [
  "Soccer",
  "Basketball",
  "Baseball",
  "Football",
  "Volleyball",
  "Lacrosse",
  "Hockey",
  "Track & Field",
];

export function CreateTeamDialog({
  orgId,
  open,
  onOpenChange,
}: {
  orgId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugDirty, setSlugDirty] = useState(false);
  const [description, setDescription] = useState("");
  const [sport, setSport] = useState<string>("");
  const [gender, setGender] = useState<"boys" | "girls" | "coed" | "">("");
  const [league, setLeague] = useState<string>("");
  const [seasonName, setSeasonName] = useState("");
  // Pre-shrunk team background photo as a data URL. Stays local until
  // the form is submitted so creation is a single round-trip.
  const [bannerDataUrl, setBannerDataUrl] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // Crop dialog state. We stage the picked file as a data URL and only
  // shrink + persist after the user confirms a crop, matching the
  // EditTeamDialog flow so admins always frame their photo before save.
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [cropFileName, setCropFileName] = useState<string>("team-photo");
  const [cropOpen, setCropOpen] = useState(false);

  const createTeam = useCreateTeam();

  const reset = () => {
    setName("");
    setSlug("");
    setSlugDirty(false);
    setDescription("");
    setSport("");
    setGender("");
    setLeague("");
    setSeasonName("");
    setBannerDataUrl(null);
    // Also clear staged crop state so a reopen of the dialog starts
    // from a fully clean slate (no leftover crop source / filename).
    setCropSrc(null);
    setCropOpen(false);
    setCropFileName("team-photo");
  };

  const onNameChange = (v: string) => {
    setName(v);
    if (!slugDirty) setSlug(slugify(v));
  };

  const onPickPhoto = () => fileInputRef.current?.click();

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
    // shrink + stash happens once the user confirms a crop in
    // onCroppedConfirm, so admins always frame their photo first.
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
    setPhotoBusy(true);
    try {
      // Cropper already constrains the output, but we still run it
      // through shrinkImage for consistent JPEG encoding + the global
      // 1024px longest-edge cap that the rest of the app relies on.
      const dataUrl = await shrinkImageToDataUrl(cropped);
      setBannerDataUrl(dataUrl);
      setCropSrc(null);
    } catch (err) {
      toast({ title: "Failed to read team photo", variant: "destructive" });
      throw err;
    } finally {
      setPhotoBusy(false);
    }
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const finalSlug = slug || slugify(name);
    const finalSeason = seasonName.trim() || `Season ${new Date().getFullYear()}`;
    if (!name.trim() || !finalSlug) {
      toast({ title: "Name is required", variant: "destructive" });
      return;
    }
    try {
      const team = await createTeam.mutateAsync({
        orgId,
        data: {
          name: name.trim(),
          slug: finalSlug,
          description: description.trim() || undefined,
          sport: sport || undefined,
          gender: gender || undefined,
          level: league.trim() || undefined,
          bannerUrl: bannerDataUrl ?? undefined,
          season: { name: finalSeason },
        },
      });
      toast({ title: "Team created!" });
      await qc.invalidateQueries({ queryKey: getListOrgTeamsQueryKey(orgId) });
      reset();
      onOpenChange(false);
      setLocation(`/teams/${team.id}?roster=1`);
    } catch {
      toast({ title: "Failed to create team", variant: "destructive" });
    }
  };

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={onSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle className="font-black tracking-tight">
              New team
            </DialogTitle>
            <DialogDescription>
              Add a team under this organization. You can roster players next.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="team-name" className="font-bold">
                Team name
              </Label>
              <Input
                id="team-name"
                value={name}
                onChange={(e) => onNameChange(e.target.value)}
                placeholder="Westfield U14 Boys"
                autoFocus
                data-testid="input-team-name"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="team-slug" className="font-bold">
                URL handle
              </Label>
              <Input
                id="team-slug"
                value={slug}
                onChange={(e) => {
                  setSlug(slugify(e.target.value));
                  setSlugDirty(true);
                }}
                placeholder="westfield-u14-boys"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label className="font-bold">Sport</Label>
                <Select value={sport} onValueChange={setSport}>
                  <SelectTrigger data-testid="select-team-sport">
                    <SelectValue placeholder="Pick sport" />
                  </SelectTrigger>
                  <SelectContent>
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
                  <SelectTrigger data-testid="select-team-gender">
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
                <Label htmlFor="team-league" className="font-bold">
                  League
                </Label>
                <Input
                  id="team-league"
                  value={league}
                  onChange={(e) => setLeague(e.target.value)}
                  placeholder="e.g. NJYS Premier"
                  data-testid="input-team-league"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="team-season" className="font-bold">
                Season
              </Label>
              <Input
                id="team-season"
                value={seasonName}
                onChange={(e) => setSeasonName(e.target.value)}
                placeholder="Fall 2026"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="team-desc" className="font-bold">
                Description
              </Label>
              <Textarea
                id="team-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="font-bold">Team photo (optional)</Label>
              <p className="text-xs text-muted-foreground">
                Shows behind your org's logo on the team page.
              </p>
              <div className="space-y-2">
                <div className="w-full h-24 bg-muted rounded-xl border border-border overflow-hidden flex items-center justify-center">
                  {bannerDataUrl ? (
                    <img
                      src={bannerDataUrl}
                      alt="Team photo preview"
                      className="w-full h-full object-cover"
                      data-testid="img-create-team-photo-preview"
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
                  data-testid="input-create-team-photo"
                />
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="font-bold rounded-full"
                    onClick={onPickPhoto}
                    disabled={photoBusy}
                    data-testid="btn-upload-create-team-photo"
                  >
                    {photoBusy
                      ? "Working..."
                      : bannerDataUrl
                        ? "Change team photo"
                        : "Upload team photo"}
                  </Button>
                  {bannerDataUrl && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="font-bold rounded-full"
                      onClick={() => setBannerDataUrl(null)}
                      disabled={photoBusy}
                      data-testid="btn-remove-create-team-photo"
                    >
                      Remove
                    </Button>
                  )}
                </div>
              </div>
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
              disabled={createTeam.isPending || photoBusy}
              data-testid="btn-create-team"
            >
              {createTeam.isPending ? "Creating..." : "Create team"}
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
