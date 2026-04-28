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

type TeamLike = {
  id: string;
  name: string;
  description?: string | null;
  sport?: string | null;
  level?: string | null;
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
  const [sport, setSport] = useState(team.sport ?? "");
  const [level, setLevel] = useState(team.level ?? "");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setName(team.name);
      setDescription(team.description ?? "");
      setSport(team.sport ?? "");
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
    setUploading(true);
    try {
      const dataUrl = await shrinkImageToDataUrl(file);
      await customFetch(`/api/v1/teams/${team.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bannerUrl: dataUrl }),
      });
      await qc.invalidateQueries({ queryKey: getGetTeamByIdQueryKey(team.id) });
      toast({ title: "Team photo updated" });
    } catch {
      toast({ title: "Failed to upload team photo", variant: "destructive" });
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
    setSaving(true);
    try {
      await customFetch(`/api/v1/teams/${team.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description,
          sport,
          level,
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
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="font-bold">Sport</Label>
                <Select value={sport} onValueChange={setSport}>
                  <SelectTrigger data-testid="select-edit-team-sport">
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
  );
}
