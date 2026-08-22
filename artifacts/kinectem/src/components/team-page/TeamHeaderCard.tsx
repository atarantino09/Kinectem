import { useRef, useState } from "react";
import { formatOrgName } from "@/lib/format";
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
import { BlurFillImage } from "@/components/BlurFillImage";
import { FitText } from "@/components/FitText";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { TeamDescription } from "./TeamDescription";
import { readOrgBrandColors, orgStripGradient } from "@/lib/orgBrand";
import { useToast } from "@/hooks/use-toast";
import { PersonaPill } from "@/components/PersonaPill";
import {
  shrinkImageToDataUrl,
  IMAGE_UPLOAD_MAX_BYTES,
  BANNER_SHRINK_MAX_DIMENSION,
  BANNER_SHRINK_OUTPUT_QUALITY,
} from "@/lib/shrinkImage";
import {
  Shield,
  Trophy,
  Newspaper,
  Users,
  Pencil,
  Camera,
  Trash2,
  CalendarDays,
  ChevronDown,
  Compass,
  ExternalLink,
  Megaphone,
} from "lucide-react";

export type TeamPanel = "posts" | "roster" | "schedule" | "admin";

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
  canViewSchedule?: boolean;
  onSetExpanded: (p: TeamPanel) => void;
  onToggleFollow: () => void;
  onEdit: () => void;
  onOpenFollowers: () => void;
  /** When provided (manager), shows the "Claim competition games" pill. */
  onClaimCompetition?: () => void;
  /** When provided (broadcaster), shows the "Message team" pill. */
  onMessageTeam?: () => void;
  /** When provided, shows a contextual page-tour action. */
  onReplayTour?: () => void;
}

export function TeamHeaderCard({
  team,
  isAdmin,
  expanded,
  playerCount,
  staffCount,
  followPending,
  canViewSchedule = false,
  onSetExpanded,
  onToggleFollow,
  onEdit,
  onOpenFollowers,
  onClaimCompetition,
  onMessageTeam,
  onReplayTour,
}: TeamHeaderCardProps) {
  // The foreground square ALWAYS shows the org's logo so every team in
  // the same organization carries identical top-of-page branding. The
  // team's own `bannerUrl` is shown as the hero background instead.
  // Task #628 — solo teams (tournament funnel) have no org; the generated
  // type still types `organization` non-null (openapi.yaml locked), so read
  // it through a narrow cast and fall back to the team's own name/initials.
  const org = (team as { organization?: { id?: string; name?: string; avatarUrl?: string | null } | null }).organization;
  const hasOrg = !!org?.id;
  const logoLabel = org?.name ?? team.name;
  const orgLogoUrl = org?.avatarUrl ?? "";
  const bannerUrl = team.bannerUrl ?? "";

  // Inline photo controls (Task #391). Admins can swap or remove the
  // hero banner without opening EditTeamDialog. Mirrors the file →
  // shrink → PATCH pipeline used by EditTeamDialog (no crop step — the
  // whole photo is kept and fitted by BlurFillImage on display).
  const qc = useQueryClient();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);

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
    // No crop step: the whole photo is uploaded as-is (aspect preserved)
    // and the banner fits it with BlurFillImage, so nothing gets cut off.
    setUploading(true);
    try {
      const dataUrl = await shrinkImageToDataUrl(file, {
        maxDimension: BANNER_SHRINK_MAX_DIMENSION,
        quality: BANNER_SHRINK_OUTPUT_QUALITY,
      });
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

  // Task #733 — parent-org brand colors ride on the org embed as extra
  // fields beyond the locked spec; when set, a thin gradient strip renders
  // at the very top of the card, above the hero photo. Independent teams
  // (no org) never have one.
  const orgBrand = hasOrg ? readOrgBrandColors(org) : null;

  return (
    <Card className="rounded-xl border border-border shadow-sm overflow-hidden">
      {orgBrand && (
        <div
          className="h-2"
          style={{ background: orgStripGradient(orgBrand) }}
          data-testid="strip-org-brand"
        />
      )}
      {/* Hero background: team-specific photo if set, otherwise the
          existing brand gradient as the empty-state. */}
      <div className="relative aspect-[16/5] overflow-hidden bg-gradient-to-br from-primary/30 via-primary/10 to-primary/5">
        {bannerUrl && (
          <BlurFillImage
            src={bannerUrl}
            alt={`${team.name} background`}
            testId="img-team-banner"
          />
        )}
        {team.currentSeason && (
          <Badge
            className="absolute top-3 left-3 bg-background/90 text-primary hover:bg-background border-none font-bold shadow-sm"
            data-testid="badge-current-season"
          >
            {team.currentSeason.name}
          </Badge>
        )}
        <PersonaPill
          persona="team"
          size="sm"
          className="!absolute top-3 right-3 shadow-sm"
        />
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
            {bannerUrl ? (
              // With a photo set, collapse the controls into a single
              // "Edit photo" button that opens a menu of Change / Remove.
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-3 font-bold rounded-full bg-background/90 hover:bg-background shadow-sm"
                    disabled={uploading}
                    data-testid="btn-inline-edit-team-photo"
                  >
                    <Camera className="w-3.5 h-3.5 mr-1.5" />
                    {uploading ? "Working..." : "Edit photo"}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="font-bold">
                  <DropdownMenuItem
                    onSelect={onPickPhoto}
                    data-testid="btn-inline-change-team-photo"
                  >
                    <Camera className="w-3.5 h-3.5 mr-2" />
                    Change photo
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={onRemovePhoto}
                    className="text-destructive focus:text-destructive"
                    data-testid="btn-inline-remove-team-photo"
                  >
                    <Trash2 className="w-3.5 h-3.5 mr-2" />
                    Remove photo
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              // No photo yet: a single action, so go straight to the picker.
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-3 font-bold rounded-full bg-background/90 hover:bg-background shadow-sm"
                onClick={onPickPhoto}
                disabled={uploading}
                data-testid="btn-inline-add-team-photo"
              >
                <Camera className="w-3.5 h-3.5 mr-1.5" />
                {uploading ? "Working..." : "Add photo"}
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
        <div
          className="relative z-10 flex flex-col gap-4 -mt-16 sm:flex-row sm:items-start sm:gap-6"
          data-testid="team-identity-row"
        >
          <div className="shrink-0 flex flex-col items-center sm:items-start">
            <AvatarLightbox
              avatarUrl={orgLogoUrl || null}
              displayName={logoLabel}
              ariaLabel={`View ${logoLabel}'s logo`}
              triggerClassName="rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              triggerTestId="btn-open-team-logo-lightbox"
              dialogTestId="dialog-team-logo-lightbox"
              imageTestId="img-team-logo-lightbox"
            >
              <div className="w-32 h-32 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 border-4 border-background shadow-md overflow-hidden flex items-center justify-center">
                {orgLogoUrl ? (
                  <img
                    src={orgLogoUrl}
                    alt={logoLabel}
                    className="w-full h-full object-contain p-1"
                    data-testid="img-team-photo"
                  />
                ) : (
                  <span className="text-4xl font-black text-primary">
                    {logoLabel.slice(0, 2).toUpperCase()}
                  </span>
                )}
              </div>
            </AvatarLightbox>
            {hasOrg ? (
              <Link
                href={`/organizations/${org!.id}`}
                className="mt-2 font-bold text-sm text-muted-foreground hover:text-primary uppercase tracking-wider text-center sm:text-left max-w-[8rem] leading-tight line-clamp-3 cursor-pointer"
                data-testid="link-team-org"
              >
                {formatOrgName(org!.name ?? "")}
              </Link>
            ) : (
              <span
                className="mt-2 font-bold text-sm text-muted-foreground uppercase tracking-wider text-center sm:text-left max-w-[8rem] block leading-tight"
                data-testid="text-team-solo"
              >
                Independent team
              </span>
            )}
          </div>
          {/* pt-20 > the row's -mt-16 pull, so the name always starts BELOW
              the banner — bottom-aligning it next to the logo let the Edit /
              tour buttons push the name up under the banner and clip it. */}
          <div
            className="flex-1 min-w-0 sm:pt-20 sm:pb-2"
            data-testid="team-identity-details"
          >
            {/* Name gets its own full-width row so long team names use the
                whole hero instead of getting squeezed by contextual tools. */}
            <FitText
              as="h1"
              max={48}
              min={18}
              className="font-black tracking-tight"
            >
              {team.name}
            </FitText>
            {team.description && (
              <TeamDescription
                description={team.description}
                teamName={team.name}
              />
            )}
            {(team.sport || team.level || team.gender) && (
              <div
                className="mt-2 flex min-w-0 flex-wrap items-center gap-2"
                data-testid="team-identity-metadata"
              >
                {team.sport && (
                  <div className="flex items-center gap-1.5 rounded-md bg-muted px-3 py-1.5 text-sm font-bold text-foreground">
                    <Trophy className="w-4 h-4 text-amber-500" />
                    {team.sport}
                  </div>
                )}
                {team.gender && (
                  <div
                    className="rounded-md bg-muted px-3 py-1.5 text-sm font-bold capitalize text-foreground"
                    data-testid="chip-team-gender"
                  >
                    {team.gender}
                  </div>
                )}
                {team.level && (
                  <div
                    className="max-w-full break-words rounded-md bg-muted px-3 py-1.5 text-sm font-bold uppercase tracking-wider text-muted-foreground"
                    data-testid="chip-team-league"
                  >
                    {team.level}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="mt-3 space-y-3">
          <div
            className="rounded-xl border border-border bg-muted/30 p-3"
            data-testid="team-header-action-menus"
          >
            <div
              className="flex flex-col items-end gap-3 sm:flex-row sm:items-center sm:justify-end"
              data-testid="team-header-action-group"
            >
            <div
              className="flex items-center"
              data-testid="team-community-actions"
            >
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="sm"
                    variant="outline"
                    className="brand-community-trigger rounded-full font-bold focus-visible:ring-[var(--k-magenta)]"
                    data-testid="btn-team-community-menu"
                  >
                    <Users className="w-3.5 h-3.5" />
                    Community
                    <ChevronDown className="w-3.5 h-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-56">
                  <DropdownMenuItem
                    onClick={onToggleFollow}
                    disabled={followPending}
                    data-testid="btn-follow-team"
                  >
                    <Users className="w-4 h-4 mr-2" />
                    {team.isFollowing ? "Following" : "Follow"}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={onOpenFollowers}
                    data-testid="btn-view-team-followers"
                  >
                    <Users className="w-4 h-4 mr-2" />
                    View {team.followerCount ?? 0} followers
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {(isAdmin ||
              onClaimCompetition ||
              onMessageTeam ||
              onReplayTour) && (
              <div
                className="flex flex-wrap items-center justify-end gap-2"
                data-testid="team-contextual-tools"
              >
                {(isAdmin || onClaimCompetition || onMessageTeam) && (
                  <div data-testid="team-manage-actions">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          size="sm"
                          variant="outline"
                          className="rounded-full border-purple-200 bg-purple-50 font-bold text-purple-800 hover:bg-purple-100 focus-visible:ring-purple-500 dark:border-purple-800 dark:bg-purple-950/40 dark:text-purple-200 dark:hover:bg-purple-950/70"
                          data-testid="btn-team-manage-menu"
                        >
                          <Shield className="w-3.5 h-3.5" />
                          Manage
                          <ChevronDown className="w-3.5 h-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-56">
                        {isAdmin && (
                          <DropdownMenuItem
                            onClick={onEdit}
                            data-testid="btn-edit-team"
                          >
                            <Pencil className="w-4 h-4 mr-2" />
                            Edit team
                          </DropdownMenuItem>
                        )}
                        {onClaimCompetition && (
                          <DropdownMenuItem
                            onClick={onClaimCompetition}
                            data-testid="btn-claim-competition"
                          >
                            <Trophy className="w-4 h-4 mr-2" />
                            Claim competition games
                          </DropdownMenuItem>
                        )}
                        {onMessageTeam && (
                          <DropdownMenuItem
                            onClick={onMessageTeam}
                            data-testid="btn-team-broadcast"
                          >
                            <Megaphone className="w-4 h-4 mr-2" />
                            Message team
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                )}

                {onReplayTour && (
                  <div data-testid="team-guides-actions">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          size="sm"
                          variant="outline"
                          className="rounded-full border-indigo-200 bg-indigo-50 font-bold text-indigo-800 hover:bg-indigo-100 focus-visible:ring-indigo-500 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-200 dark:hover:bg-indigo-950/70"
                          data-testid="btn-team-guides-menu"
                        >
                          <Compass className="w-3.5 h-3.5" />
                          Guides
                          <ChevronDown className="w-3.5 h-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-56">
                        <DropdownMenuItem
                          onClick={onReplayTour}
                          data-testid="btn-team-replay-tour"
                        >
                          <Compass className="w-4 h-4 mr-2" />
                          Take a page tour
                        </DropdownMenuItem>
                        <DropdownMenuItem asChild>
                          <a
                            href="/getting-started.html"
                            target="_blank"
                            rel="noreferrer"
                            data-testid="link-team-getting-started"
                          >
                            <ExternalLink className="w-4 h-4 mr-2" />
                            Getting started guide
                          </a>
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                )}
              </div>
            )}
            </div>
          </div>

          <div
            className="rounded-xl border border-border bg-muted/30 p-3"
            data-testid="team-section-navigation"
          >
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Explore team
              </span>
              <div className="flex items-center gap-2 flex-wrap">
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
                {canViewSchedule && (
                  <Button
                    size="sm"
                    variant={expanded === "schedule" ? "default" : "outline"}
                    className="font-bold rounded-full"
                    onClick={() => onSetExpanded("schedule")}
                    data-testid="btn-toggle-schedule"
                  >
                    <CalendarDays className="w-3.5 h-3.5 mr-1.5" />
                    Schedule
                  </Button>
                )}
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
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
