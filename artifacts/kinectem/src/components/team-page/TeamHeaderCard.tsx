import { useRef, useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  customFetch,
  getGetTeamByIdQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AvatarLightbox } from "@/components/AvatarLightbox";
import { TeamPhotoCropDialog } from "@/components/TeamPhotoCropDialog";
import { TeamDescription } from "./TeamDescription";
import { useToast } from "@/hooks/use-toast";
import {
  shrinkImageToDataUrl,
  IMAGE_UPLOAD_MAX_BYTES,
} from "@/lib/shrinkImage";
import {
  Shield,
  Trophy,
  Newspaper,
  Users,
  Pencil,
  Camera,
  Trash2,
} from "lucide-react";

export type TeamPanel = "posts" | "roster" | "admin";

interface Team {
  id: string;
  name: string;
  description?: string | null;
  website?: string | null;
  sport?: string | null;
  level?: string | null;
  gender?: "boys" | "girls" | "coed" | null;
  avatarUrl?: string | null;
  bannerUrl?: string | null;
  isFollowing?: boolean;
  followerCount?: number;
  organization: {
    id: string;
    name: string;
    avatarUrl?: string | null;
  };
  currentSeason?: { id?: string; name?: string } | null;
}

interface TeamHeaderCardProps {
  team: Team;
  isAdmin: boolean;
  expanded: TeamPanel;
  playerCount: number;
  staffCount: number;
  followPending: boolean;
  onSetExpanded: (p: TeamPanel) => void;
  onToggleFollow: () => void;
  onEdit: () => void;
  onOpenFollowers: () => void;
}

export function TeamHeaderCard({
  team,
  isAdmin,
  expanded,
  playerCount,
  staffCount,
  followPending,
  onSetExpanded,
  onToggleFollow,
  onEdit,
  onOpenFollowers,
}: TeamHeaderCardProps) {
  // The foreground square ALWAYS shows the org's logo so every team in
  // the same organization carries identical top-of-page branding. The
  // team's own `bannerUrl` is shown as the hero background instead.
  const orgLogoUrl = team.organization.avatarUrl ?? "";
  const bannerUrl = team.bannerUrl ?? "";

  // Inline photo controls (Task #391). Admins can swap or remove the
  // hero banner without opening EditTeamDialog. We mirror the file →
  // crop → shrink → PATCH pipeline used by EditTeamDialog so the same
  // TeamPhotoCropDialog framing experience is preserved here.
  const qc = useQueryClient();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [cropFileName, setCropFileName] = useState<string>("team-photo");
  const [cropOpen, setCropOpen] = useState(false);

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
      const dataUrl = await shrinkImageToDataUrl(cropped);
      await customFetch(`/api/v1/teams/${team.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bannerUrl: dataUrl }),
      });
      await qc.invalidateQueries({ queryKey: getGetTeamByIdQueryKey(team.id) });
      toast({ title: "Team photo updated" });
      setCropSrc(null);
    } catch (err) {
      toast({ title: "Failed to upload team photo", variant: "destructive" });
      throw err;
    } finally {
      setUploading(false);
    }
  };

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

  return (
    <Card className="rounded-xl border border-border shadow-sm overflow-hidden">
      {/* Hero background: team-specific photo if set, otherwise the
          existing brand gradient as the empty-state. */}
      <div className="relative aspect-[16/5] bg-gradient-to-br from-primary/30 via-primary/10 to-primary/5">
        {bannerUrl && (
          <img
            src={bannerUrl}
            alt={`${team.name} background`}
            className="absolute inset-0 w-full h-full object-cover"
            data-testid="img-team-banner"
          />
        )}
        {team.currentSeason && (
          <Badge
            className="absolute top-3 right-3 bg-background/90 text-primary hover:bg-background border-none font-bold shadow-sm"
            data-testid="badge-current-season"
          >
            {team.currentSeason.name}
          </Badge>
        )}
        {isAdmin && (
          <div
            className={`absolute left-3 ${team.currentSeason ? "top-12" : "top-3"} flex items-center gap-2`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={onPhotoChange}
              data-testid="input-inline-team-photo"
            />
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-3 font-bold rounded-full bg-background/90 hover:bg-background shadow-sm"
              onClick={onPickPhoto}
              disabled={uploading}
              data-testid="btn-inline-change-team-photo"
            >
              <Camera className="w-3.5 h-3.5 mr-1.5" />
              {uploading
                ? "Working..."
                : bannerUrl
                  ? "Change photo"
                  : "Add photo"}
            </Button>
            {bannerUrl && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-3 font-bold rounded-full bg-background/90 hover:bg-background shadow-sm"
                onClick={onRemovePhoto}
                disabled={uploading}
                data-testid="btn-inline-remove-team-photo"
              >
                <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                Remove photo
              </Button>
            )}
          </div>
        )}
      </div>
      <CardContent className="p-6 pt-0">
        {/* Avatar block: org logo, overlapping the bottom of the banner.
            Org name sits directly under the logo as a link to the org.
            The logo column gets its own positioning + z-index so it is
            painted in front of the banner's absolutely-positioned <img>;
            otherwise CSS paints positioned descendants above non-positioned
            siblings in the same stacking context, which would let the
            uploaded team photo cover the logo square. */}
        <div className="relative z-10 flex flex-col sm:flex-row sm:items-end gap-4 sm:gap-6 -mt-16">
          <div className="shrink-0 flex flex-col items-center sm:items-start">
            <AvatarLightbox
              avatarUrl={orgLogoUrl || null}
              displayName={team.organization.name}
              ariaLabel={`View ${team.organization.name}'s logo`}
              triggerClassName="rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              triggerTestId="btn-open-team-logo-lightbox"
              dialogTestId="dialog-team-logo-lightbox"
              imageTestId="img-team-logo-lightbox"
            >
              <div className="w-32 h-32 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 border-4 border-background shadow-md overflow-hidden flex items-center justify-center">
                {orgLogoUrl ? (
                  <img
                    src={orgLogoUrl}
                    alt={team.organization.name}
                    className="w-full h-full object-cover"
                    data-testid="img-team-photo"
                  />
                ) : (
                  <span className="text-4xl font-black text-primary">
                    {team.organization.name.slice(0, 2).toUpperCase()}
                  </span>
                )}
              </div>
            </AvatarLightbox>
            <Link
              href={`/organizations/${team.organization.id}`}
              className="mt-2 font-bold text-sm text-muted-foreground hover:text-primary uppercase tracking-wider text-center sm:text-left max-w-[8rem] block leading-tight cursor-pointer"
              data-testid="link-team-org"
            >
              {team.organization.name}
            </Link>
          </div>
          <div className="flex-1 min-w-0 sm:pb-2">
            <div className="flex items-start gap-3 flex-wrap">
              <h1 className="text-5xl font-black tracking-tight leading-[1.05]">
                {team.name}
              </h1>
              {isAdmin && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-3 font-bold rounded-full mt-2"
                  onClick={onEdit}
                  data-testid="btn-edit-team"
                >
                  <Pencil className="w-3.5 h-3.5 mr-1.5" />
                  Edit
                </Button>
              )}
            </div>
            {team.description && (
              <TeamDescription
                description={team.description}
                teamName={team.name}
              />
            )}
            {team.website && (
              <a
                href={team.website}
                target="_blank"
                rel="noreferrer noopener"
                className="mt-2 inline-block text-sm font-bold text-primary hover:underline break-all"
                data-testid="link-team-website"
              >
                {team.website.replace(/^https?:\/\//, "")}
              </a>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 flex-wrap mt-4">
          {team.sport && (
            <div className="font-bold text-foreground flex items-center gap-1.5 bg-muted px-3 py-1.5 rounded-md text-sm">
              <Trophy className="w-4 h-4 text-amber-500" />
              {team.sport}
            </div>
          )}
          {team.level && (
            <div className="font-bold text-muted-foreground text-sm uppercase tracking-wider">
              {team.level}
            </div>
          )}
          {team.gender && (
            <div
              className="font-bold text-foreground bg-muted px-3 py-1.5 rounded-md text-sm capitalize"
              data-testid="chip-team-gender"
            >
              {team.gender}
            </div>
          )}
          <div className="ml-auto flex items-center gap-2 flex-wrap">
            <Button
              size="sm"
              variant={expanded === "posts" ? "default" : "outline"}
              className="font-bold rounded-full"
              onClick={() => onSetExpanded("posts")}
              data-testid="btn-toggle-posts"
            >
              <Newspaper className="w-3.5 h-3.5 mr-1.5" />
              Recent Posts
            </Button>
            <Button
              size="sm"
              variant={expanded === "roster" ? "default" : "outline"}
              className="font-bold rounded-full"
              onClick={() => onSetExpanded("roster")}
              data-testid="btn-toggle-roster"
            >
              <Users className="w-3.5 h-3.5 mr-1.5" />
              Roster ({playerCount}
              {staffCount > 0 ? ` · ${staffCount}` : ""})
            </Button>
            {isAdmin && (
              <Button
                size="sm"
                variant={expanded === "admin" ? "default" : "outline"}
                className="font-bold rounded-full"
                onClick={() => onSetExpanded("admin")}
                data-testid="btn-toggle-admin"
              >
                <Shield className="w-3.5 h-3.5 mr-1.5" />
                Admin Tools
              </Button>
            )}
            <Button
              variant="brand"
              onClick={onToggleFollow}
              disabled={followPending}
              data-testid="btn-follow-team"
            >
              {team.isFollowing ? "Following" : "Follow"}
            </Button>
            <Button
              variant="outline"
              className="font-bold rounded-full"
              onClick={onOpenFollowers}
              data-testid="btn-view-team-followers"
            >
              <Users className="w-4 h-4 mr-1.5" />
              {team.followerCount} Followers
            </Button>
          </div>
        </div>
      </CardContent>
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
    </Card>
  );
}
