import { useRoute, Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch, useGetLoggedInUser } from "@workspace/api-client-react";
import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { AvatarLightbox } from "@/components/AvatarLightbox";
import { CompetitionBrandStrip } from "@/components/CompetitionBrandStrip";
import { CompetitionHowItWorks } from "@/components/CompetitionHowItWorks";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown, EyeOff, Pencil, Star } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import {
  CompetitionClaimBanner,
  useClaimTokenParams,
  useCompetitionClaimResolve,
} from "@/components/ClaimTokenBanner";

// Competitions §9a — PUBLIC branded competition page (`/c/<slug>`). Distinct
// from org/team pages on purpose: the hero is themed with the operator's
// brand_color and shows their logo/banner, with Kinectem as a small credit.
// Legacy `/t/<slug>` links redirect here. Hand-written customFetch — these
// endpoints have no openapi.yaml entry (file is locked).

type Participant = {
  id: string;
  name: string;
  division: string;
  bracket: string;
  age: string | null;
  gender: string | null;
  claimed: boolean;
  teamId: string | null;
  // Task #865 — sorting bracket this team belongs to (null = "Other").
  bracketId?: string | null;
  // Operators only — public viewers never receive hidden slots.
  hidden?: boolean;
};

type Match = {
  id: string;
  matchNumber: string;
  matchDate: string | null;
  startTime: string | null;
  age: string | null;
  gender: string | null;
  division: string;
  bracket: string;
  venue: string | null;
  venueState: string | null;
  field: string | null;
  homeName: string | null;
  awayName: string | null;
  homeParticipantId: string | null;
  awayParticipantId: string | null;
  homeTeamId?: string | null;
  awayTeamId?: string | null;
  // Task #765 — postponed/canceled games render with a status badge (+
  // optional reason) instead of silently disappearing.
  status?: "scheduled" | "postponed" | "canceled";
  statusReason?: string | null;
};

export type CompetitionMeta = {
  id: string;
  slug: string;
  name: string;
  type: "tournament" | "league";
  startDate: string;
  endDate: string;
  location: string | null;
  description: string | null;
  isActive: boolean;
  isEnded: boolean;
  autoApproveClaims: boolean;
  logoUrl: string | null;
  brandColor: string | null;
  secondaryColor: string | null;
  tertiaryColor: string | null;
  bannerUrl: string | null;
  websiteUrl: string | null;
  claimedCount: number;
  participantCount: number;
  canManage?: boolean;
  // Viewer follow state (quick-access follows; false when logged out).
  isFollowing?: boolean;
  // Parent-company hub (Task #723) — null when standalone.
  organizer?: {
    id: string;
    slug: string;
    name: string;
    logoUrl: string | null;
  } | null;
};

type FeaturedRecap = {
  id: string;
  title: string;
  summary: string | null;
  coverImageUrl: string | null;
  gameDate: string | null;
  opponentName: string | null;
  teamScore: number | null;
  opponentScore: number | null;
  teamId: string;
  teamName: string;
  publishedAt: string | null;
  // Task #852 — organizer-assigned sorting bracket (null = unbracketed).
  bracketId?: string | null;
};

// Task #852 — bracket labels in the organizer's saved order, driving the
// recap rail's filter chips.
type CompetitionBracketInfo = {
  id: string;
  label: string;
  gender: string | null;
  ageGroup: string | null;
};

type CompetitionResponse = {
  competition: CompetitionMeta;
  participants: Participant[];
  matches: Match[];
  featuredRecaps?: FeaturedRecap[];
  brackets?: CompetitionBracketInfo[];
};

function groupLabel(division: string, bracket: string): string {
  const parts = [division, bracket].filter((p) => p && p.trim() !== "");
  return parts.length ? parts.join(" · ") : "General";
}

// Pick a readable text color for the brand band (simple luminance check).
function contrastText(hex: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "#ffffff";
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 160 ? "#111111" : "#ffffff";
}

const DEFAULT_BRAND = "#1e293b";

export default function CompetitionPage() {
  // Matched both as the standalone public page (`/c/<slug>`) and as the
  // in-app view inside the AppShell (`/competitions/c/<slug>`), so
  // logged-in users can browse a competition without leaving the app.
  const [, publicParams] = useRoute("/c/:slug");
  const [, appParams] = useRoute("/competitions/c/:slug");
  const slug = publicParams?.slug ?? appParams?.slug ?? "";
  const { data: me } = useGetLoggedInUser();
  const [teamsOpen, setTeamsOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  // Task #852 — active bracket filter for the featured-recaps rail
  // ("" = All; unbracketed recaps only ever show under All).
  const [bracketFilter, setBracketFilter] = useState("");
  // Task #854 — optional grouped layout: recaps under bracket headings in
  // the organizer's saved order, unbracketed last under "Other". Grouping
  // supersedes the chip filter, so chips hide while grouped.
  const [groupedView, setGroupedView] = useState(false);

  // Task #851 — a valid, unclaimed claim token means the viewer is the
  // prospective operator: show the "How your competition works" walkthrough
  // even though they can't manage yet, and start it expanded.
  const { token: claimToken } = useClaimTokenParams();
  const claimResolve = useCompetitionClaimResolve(claimToken);
  const isClaimVisitor =
    !!claimResolve.data &&
    claimResolve.data.competition.slug === slug &&
    !claimResolve.data.alreadyClaimed;

  const q = useQuery<CompetitionResponse>({
    queryKey: ["competition", slug],
    queryFn: () =>
      customFetch<CompetitionResponse>(
        `/api/v1/competitions/${encodeURIComponent(slug)}`,
        { method: "GET" },
      ),
    enabled: !!slug,
    retry: false,
  });

  // Follow / unfollow — quick-access only (does NOT change the home feed).
  const qcTop = useQueryClient();
  const { toast } = useToast();
  // Hide / unhide a team slot from the public Teams list (operators only).
  const [pendingHide, setPendingHide] = useState<Participant | null>(null);
  // Task #866 — bulk hide: operators tick checkboxes next to visible teams,
  // then "Hide All (N)" hides the whole selection in one request.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkHideOpen, setBulkHideOpen] = useState(false);
  const toggleSelected = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const bulkHideMutation = useMutation({
    mutationFn: ({
      participantIds,
      competitionId,
    }: {
      participantIds: string[];
      competitionId: string;
    }) =>
      customFetch<{ ok: true; hiddenCount: number }>(
        `/api/v1/competitions/${competitionId}/participants/bulk-hide`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ participantIds }),
        },
      ),
    onSuccess: (r) => {
      setSelectedIds(new Set());
      qcTop.invalidateQueries({ queryKey: ["competition", slug] });
      toast({
        title: r.hiddenCount === 1 ? "1 team hidden" : `${r.hiddenCount} teams hidden`,
        description:
          "They no longer appear in the public Teams list. Only competition admins can see them.",
      });
    },
    onError: (err) =>
      toast({
        title: "Couldn't hide those teams",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      }),
  });
  const hideMutation = useMutation({
    mutationFn: ({
      participantId,
      hide,
      competitionId,
    }: {
      participantId: string;
      hide: boolean;
      competitionId: string;
    }) =>
      customFetch<{ ok: true; hidden: boolean }>(
        `/api/v1/competitions/${competitionId}/participants/${participantId}/hide`,
        { method: hide ? "POST" : "DELETE" },
      ),
    onSuccess: (r) => {
      qcTop.invalidateQueries({ queryKey: ["competition", slug] });
      toast({
        title: r.hidden ? "Team hidden" : "Team visible again",
        description: r.hidden
          ? "It no longer appears in the public Teams list. Only competition admins can see it."
          : "It's back in the public Teams list.",
      });
    },
    onError: (err) =>
      toast({
        title: "Couldn't update that team",
        description:
          err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      }),
  });
  const followMutation = useMutation({
    mutationFn: (follow: boolean) =>
      customFetch<{ ok: true; isFollowing: boolean }>(
        `/api/v1/competitions/${encodeURIComponent(slug)}/follow`,
        { method: follow ? "POST" : "DELETE" },
      ),
    onSuccess: () => {
      qcTop.invalidateQueries({ queryKey: ["competition", slug] });
      qcTop.invalidateQueries({ queryKey: ["my-followed-competitions"] });
    },
  });

  const matchGroups = useMemo(() => {
    const map = new Map<string, Match[]>();
    for (const m of q.data?.matches ?? []) {
      const key = groupLabel(m.division, m.bracket);
      const arr = map.get(key) ?? [];
      arr.push(m);
      map.set(key, arr);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [q.data]);

  if (q.isLoading) {
    return (
      <div className="min-h-screen max-w-4xl mx-auto p-6 space-y-4">
        <Skeleton className="h-48 rounded-xl" />
        <Skeleton className="h-48 rounded-xl" />
      </div>
    );
  }

  if (q.isError || !q.data) {
    const message =
      (q.error as Error | null)?.message ??
      "This competition link is invalid or no longer available.";
    return (
      <div className="min-h-screen max-w-xl mx-auto p-6">
        <Card className="rounded-xl border-border">
          <CardContent className="p-6 text-center space-y-2">
            <h1 className="text-xl font-black tracking-tight">
              Competition unavailable
            </h1>
            <p className="text-sm text-muted-foreground">{message}</p>
            <Link href="/">
              <Button variant="outline" className="font-bold mt-2">
                Go home
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { competition: c, participants } = q.data;
  // Task #865 — Teams grouped under the organizer's brackets, mirroring the
  // recap grouped view: saved bracket order, alphabetical inside a group
  // (the API already sorts by name), unmatched teams last under "Other".
  const bracketList = q.data.brackets ?? [];
  const teamsByBracket = new Map<string, Participant[]>();
  const ungroupedTeams: Participant[] = [];
  for (const p of participants) {
    if (p.bracketId && bracketList.some((b) => b.id === p.bracketId)) {
      teamsByBracket.set(p.bracketId, [
        ...(teamsByBracket.get(p.bracketId) ?? []),
        p,
      ]);
    } else {
      ungroupedTeams.push(p);
    }
  }
  const teamSections: { key: string; title: string; teams: Participant[] }[] =
    bracketList
      .filter((b) => (teamsByBracket.get(b.id) ?? []).length > 0)
      .map((b) => ({
        key: b.id,
        title: [
          b.label,
          // Append gender/age only when they aren't already in the label
          // ("Boys U12 Gold" shouldn't become "Boys U12 Gold · Boys · U12").
          ...[b.gender, b.ageGroup].filter(
            (v): v is string =>
              !!v && !b.label.toLowerCase().includes(v.toLowerCase()),
          ),
        ].join(" · "),
        teams: teamsByBracket.get(b.id)!,
      }));
  if (ungroupedTeams.length > 0) {
    teamSections.push({
      key: "__other__",
      // With no brackets at all there's nothing to group by — skip the
      // "Other" heading and show the plain list.
      title: teamSections.length > 0 ? "Other" : "",
      teams: ungroupedTeams,
    });
  }
  const brand = c.brandColor ?? DEFAULT_BRAND;
  const heroText = contrastText(brand);
  // Secondary tints the hero as a subtle gradient; tertiary accents the
  // status badge. Both degrade to primary-only when unset.
  const heroBackground = c.secondaryColor
    ? `linear-gradient(135deg, ${brand} 0%, ${brand} 55%, ${c.secondaryColor} 100%)`
    : brand;
  const accent = c.tertiaryColor ?? null;
  const dateRange =
    c.startDate === c.endDate ? c.startDate : `${c.startDate} – ${c.endDate}`;
  const typeLabel = c.type === "league" ? "League" : "Tournament";
  const statusLabel =
    c.type === "league"
      ? c.isEnded
        ? "Season ended"
        : "Season"
      : c.isActive
        ? "Live"
        : c.isEnded
          ? "Ended"
          : "Upcoming";

  const signupHref = me
    ? `/c/${encodeURIComponent(slug)}/signup`
    : `/login?signup=1&returnTo=${encodeURIComponent(`/c/${slug}/signup`)}`;

  return (
    <div className="min-h-screen">
      {/* Task #850 — red claim CTA when a valid ?claimToken= is present. */}
      <div className="max-w-4xl mx-auto px-6 pt-4 empty:hidden">
        <CompetitionClaimBanner slug={slug} />
      </div>
      {/* Branded hero (§9a/§10) — brand_color band, logo-forward */}
      <div
        style={{ background: heroBackground, color: heroText }}
        data-testid="hero-competition"
      >
        {/* Banner ≈2/3 of the hero, branded strip ≈1/3 — strip content is
            compacted (smaller logo/title, tighter spacing) so nothing gets
            cut off. */}
        {c.bannerUrl ? (
          <div className="h-64 sm:h-96 w-full overflow-hidden">
            <img
              src={c.bannerUrl}
              alt=""
              className="h-full w-full object-cover"
            />
          </div>
        ) : null}
        <div className="max-w-4xl mx-auto px-6 py-5 space-y-2.5">
          <div className="flex items-start gap-4">
            {c.logoUrl ? (
              <AvatarLightbox
                avatarUrl={c.logoUrl}
                displayName={c.name}
                ariaLabel={`View ${c.name} logo`}
                triggerClassName="rounded-xl shrink-0 cursor-zoom-in focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                triggerTestId="btn-competition-logo"
                dialogTestId="dialog-competition-logo"
                imageTestId="img-competition-logo-expanded"
              >
                <img
                  src={c.logoUrl}
                  alt={`${c.name} logo`}
                  className="h-12 w-12 sm:h-16 sm:w-16 rounded-xl object-contain bg-white/90 p-1.5"
                  data-testid="img-competition-logo"
                />
              </AvatarLightbox>
            ) : null}
            <div className="min-w-0 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className="rounded-full border px-2 py-0.5 text-[11px] font-black uppercase tracking-widest"
                  style={{ borderColor: heroText, opacity: 0.9 }}
                  data-testid="badge-competition-type"
                >
                  {typeLabel}
                </span>
                <span
                  className="rounded-full px-2 py-0.5 text-[11px] font-black uppercase tracking-widest"
                  style={
                    accent
                      ? {
                          backgroundColor: accent,
                          color: contrastText(accent),
                        }
                      : undefined
                  }
                  data-testid="badge-competition-status"
                >
                  {statusLabel}
                </span>
                <span className="text-xs opacity-80">{dateRange}</span>
              </div>
              {c.organizer ? (
                <Link
                  href={
                    appParams
                      ? `/competitions/o/${c.organizer.slug}`
                      : `/organizers/${c.organizer.slug}`
                  }
                >
                  <span
                    className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-black uppercase tracking-widest cursor-pointer hover:opacity-100"
                    style={{ borderColor: heroText, opacity: 0.9 }}
                    data-testid="chip-presented-by"
                  >
                    {c.organizer.logoUrl ? (
                      <img
                        src={c.organizer.logoUrl}
                        alt=""
                        className="h-4 w-4 rounded object-contain bg-white/90"
                      />
                    ) : null}
                    Presented by {c.organizer.name}
                  </span>
                </Link>
              ) : null}
              <h1
                className="text-2xl sm:text-3xl font-black tracking-tight"
                data-testid="text-competition-name"
              >
                {c.name}
              </h1>
              {c.location ? (
                <p className="text-sm opacity-85">{c.location}</p>
              ) : null}
            </div>
          </div>
          {c.description ? (
            <p className="text-sm max-w-2xl opacity-90">{c.description}</p>
          ) : null}
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Link href={signupHref}>
              <Button
                className="font-bold bg-white text-black hover:bg-white/90"
                data-testid="btn-signup-team"
              >
                Sign up your team
              </Button>
            </Link>
            {me ? (
              <Button
                variant="outline"
                className="font-bold border-white/70 bg-transparent hover:bg-white/10"
                style={{ color: heroText }}
                disabled={followMutation.isPending}
                onClick={() => followMutation.mutate(!c.isFollowing)}
                data-testid="btn-follow-competition"
              >
                <Star
                  className={`w-4 h-4 mr-1.5 ${c.isFollowing ? "fill-current" : ""}`}
                />
                {c.isFollowing ? "Following" : "Follow"}
              </Button>
            ) : null}
            {c.canManage || isClaimVisitor ? (
              <Link
                href={`/competitions/${c.id}${
                  isClaimVisitor && claimToken
                    ? `?claimToken=${encodeURIComponent(claimToken)}`
                    : ""
                }`}
              >
                <Button
                  variant="outline"
                  className="font-bold border-white/70 bg-transparent hover:bg-white/10"
                  style={{ color: heroText }}
                  data-testid="btn-edit-competition"
                >
                  <Pencil className="w-4 h-4 mr-1.5" />
                  Edit competition
                </Button>
              </Link>
            ) : null}
            <span className="text-xs font-bold opacity-90">
              {c.claimedCount} / {c.participantCount} teams telling their story
            </span>
            {c.websiteUrl ? (
              <a
                href={c.websiteUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs underline opacity-85"
                data-testid="link-competition-website"
              >
                Official website
              </a>
            ) : null}
          </div>
          <p className="text-[11px] opacity-70 pt-2">Powered by Kinectem</p>
        </div>
      </div>

      <div className="max-w-4xl mx-auto p-6 space-y-6">
        {/* Organizer-only lifecycle explainer — starts collapsed (like the
            Teams and Schedule sections below); the organizer expands it via
            the chevron when they want the walkthrough. */}
        {c.canManage || isClaimVisitor ? (
          <CompetitionHowItWorks
            brandColor={c.brandColor}
            secondaryColor={c.secondaryColor}
            defaultOpen={isClaimVisitor}
          />
        ) : null}

        {/* Featured game recaps rail (§7) — the visual centerpiece; hidden
            entirely until the operator features at least one recap. Each
            card carries the authoring team's identity inside the
            competition-branded page. */}
        {(q.data.featuredRecaps?.length ?? 0) > 0 && (() => {
          const allRecaps = q.data.featuredRecaps!;
          const brackets = q.data.brackets ?? [];
          // Only offer chips for brackets that actually have a featured
          // recap; "All" always includes unbracketed recaps.
          const usedBrackets = brackets.filter((b) =>
            allRecaps.some((r) => r.bracketId === b.id),
          );
          const shownRecaps = bracketFilter
            ? allRecaps.filter((r) => r.bracketId === bracketFilter)
            : allRecaps;
          // Task #854 — grouped sections: brackets in the organizer's saved
          // order (only those with recaps), then unbracketed under "Other".
          const bracketIds = new Set(brackets.map((b) => b.id));
          const groupedSections: { key: string; label: string; recaps: FeaturedRecap[] }[] =
            usedBrackets.map((b) => ({
              key: b.id,
              label: b.label,
              recaps: allRecaps.filter((r) => r.bracketId === b.id),
            }));
          const otherRecaps = allRecaps.filter(
            (r) => !r.bracketId || !bracketIds.has(r.bracketId),
          );
          if (otherRecaps.length > 0) {
            groupedSections.push({
              key: "__other__",
              label: "Other",
              recaps: otherRecaps,
            });
          }
          const renderRecapCard = (r: FeaturedRecap) => (
            <Link key={r.id} href={`/posts/${r.id}`}>
              <Card
                className="rounded-xl border-border overflow-hidden cursor-pointer transition-shadow hover:shadow-md h-full"
                data-testid={`card-featured-recap-${r.id}`}
              >
                <CompetitionBrandStrip
                  name={c.name}
                  logoUrl={c.logoUrl}
                  brandColor={c.brandColor}
                  secondaryColor={c.secondaryColor}
                />
                {r.coverImageUrl ? (
                  <div className="h-32 w-full overflow-hidden">
                    <img
                      src={r.coverImageUrl}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  </div>
                ) : null}
                <CardContent className="p-4 space-y-1.5">
                  <p className="text-xs font-bold text-muted-foreground truncate">
                    {r.teamName}
                    {r.opponentName ? ` vs ${r.opponentName}` : ""}
                    {r.teamScore != null && r.opponentScore != null
                      ? ` · ${r.teamScore}-${r.opponentScore}`
                      : ""}
                  </p>
                  <p className="text-sm font-black tracking-tight line-clamp-2">
                    {r.title}
                  </p>
                  {r.summary ? (
                    <p className="text-xs text-muted-foreground line-clamp-2">
                      {r.summary}
                    </p>
                  ) : null}
                </CardContent>
              </Card>
            </Link>
          );
          return (
          <section className="space-y-3" data-testid="rail-featured-recaps">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <h2 className="text-lg font-black tracking-tight">
                Featured game recaps
              </h2>
              <div className="flex items-center gap-3">
                <span
                  className="text-[11px] font-black uppercase tracking-widest"
                  style={{ color: brand }}
                >
                  Curated by {c.name}
                </span>
                {c.canManage ? (
                  <Link href={`/competitions/${c.id}#recaps`}>
                    <Button
                      size="sm"
                      variant="outline"
                      className="font-bold"
                      data-testid="btn-manage-featured-recaps"
                    >
                      <Star className="w-3.5 h-3.5 mr-1.5" />
                      Manage
                    </Button>
                  </Link>
                ) : null}
              </div>
            </div>
            {/* Task #852 — bracket filter chips (organizer order + All).
                Unbracketed recaps only show under All.
                Task #854 — a "Group by bracket" toggle swaps chips for
                grouped sections with one heading per bracket. */}
            {usedBrackets.length > 0 && (
              <div
                className="flex items-center gap-2 flex-wrap"
                data-testid="filter-bracket-chips"
              >
                {!groupedView && (
                  <>
                    <Button
                      size="sm"
                      variant={bracketFilter === "" ? "default" : "outline"}
                      className="h-7 rounded-full font-bold text-xs"
                      onClick={() => setBracketFilter("")}
                      data-testid="chip-bracket-all"
                    >
                      All
                    </Button>
                    {usedBrackets.map((b) => (
                      <Button
                        key={b.id}
                        size="sm"
                        variant={bracketFilter === b.id ? "default" : "outline"}
                        className="h-7 rounded-full font-bold text-xs"
                        onClick={() => setBracketFilter(b.id)}
                        data-testid={`chip-bracket-${b.id}`}
                      >
                        {b.label}
                      </Button>
                    ))}
                  </>
                )}
                <Button
                  size="sm"
                  variant={groupedView ? "default" : "outline"}
                  className="h-7 rounded-full font-bold text-xs ml-auto"
                  onClick={() => setGroupedView((v) => !v)}
                  data-testid="btn-toggle-grouped-view"
                >
                  Group by bracket
                </Button>
              </div>
            )}
            {groupedView && usedBrackets.length > 0 ? (
              <div className="space-y-5" data-testid="rail-grouped-sections">
                {groupedSections.map((s) => (
                  <div
                    key={s.key}
                    className="space-y-2"
                    data-testid={`section-bracket-${s.key}`}
                  >
                    <h3 className="text-sm font-black uppercase tracking-widest text-muted-foreground">
                      {s.label}{" "}
                      <span className="font-bold normal-case tracking-normal">
                        ({s.recaps.length})
                      </span>
                    </h3>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {s.recaps.map(renderRecapCard)}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {shownRecaps.map(renderRecapCard)}
              </div>
            )}
          </section>
          );
        })()}

        {/* Organizer-only empty state — a clear path to the curation panel
            even before anything has been featured. Hidden from the public. */}
        {(q.data.featuredRecaps?.length ?? 0) === 0 && c.canManage ? (
          <Card
            className="rounded-xl border-dashed border-border"
            data-testid="card-featured-recaps-empty"
          >
            <CardContent className="p-5 flex items-center justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <h2 className="text-base font-black tracking-tight">
                  Featured game recaps
                </h2>
                <p className="text-sm text-muted-foreground">
                  Nothing featured yet — review recaps from claimed teams and
                  feature the best ones here on your public page. Only you can
                  see this.
                </p>
              </div>
              <Link href={`/competitions/${c.id}#recaps`}>
                <Button
                  variant="outline"
                  className="font-bold shrink-0"
                  data-testid="btn-feature-recaps"
                >
                  <Star className="w-4 h-4 mr-1.5" />
                  View &amp; feature recaps
                </Button>
              </Link>
            </CardContent>
          </Card>
        ) : null}

        {/* Teams / claim list — collapsible, one team per line so the full
            name is readable and nobody claims the wrong slot. */}
        <Card className="rounded-xl border-border" data-testid="card-participants">
          <CardContent className="p-6">
            <Collapsible
              open={teamsOpen}
              onOpenChange={setTeamsOpen}
              className="space-y-3"
            >
              <CollapsibleTrigger
                className="flex w-full items-center justify-between gap-2 text-left"
                data-testid="btn-toggle-participants"
              >
                <h2 className="text-lg font-black tracking-tight">
                  Teams{" "}
                  <span className="text-sm font-bold text-muted-foreground">
                    ({participants.length})
                  </span>
                </h2>
                <ChevronDown
                  className={`h-5 w-5 shrink-0 text-muted-foreground transition-transform ${
                    teamsOpen ? "rotate-180" : ""
                  }`}
                />
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  Spot your team below? Claim it yourself — no invite needed.
                  Sign up, claim your name, and start telling your team&apos;s
                  story with game recaps.
                </p>
                <div
                  className="rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground space-y-1"
                  data-testid="text-claim-explainer"
                >
                  <p>
                    <span className="font-bold text-foreground">
                      Claiming a team claims its schedule.
                    </span>{" "}
                    Your {typeLabel.toLowerCase()} games are added to your
                    Kinectem team page, where you can edit all of your team&apos;s
                    info.
                  </p>
                  <p>
                    Already have a team on Kinectem? Claiming won&apos;t change
                    your existing team page — these games are simply added to
                    your schedule under this competition, and your game recaps
                    may be shared and featured on this competition page.
                  </p>
                  <p data-testid="text-claim-approval-mode">
                    {c.autoApproveClaims ? (
                      <>
                        <span className="font-bold text-foreground">
                          Claims are instant
                        </span>{" "}
                        — click Claim and your spot is locked in right away.
                      </>
                    ) : (
                      <>
                        <span className="font-bold text-foreground">
                          Claims are reviewed
                        </span>{" "}
                        — the organizer approves each claim before your spot is
                        locked in.
                      </>
                    )}
                  </p>
                </div>
                {c.canManage && selectedIds.size > 0 ? (
                  <div
                    className="sticky top-0 z-10 flex items-center justify-between gap-2 rounded-lg border border-border bg-background/95 px-3 py-2 shadow-sm"
                    data-testid="bar-bulk-hide"
                  >
                    <p className="text-sm font-bold">
                      {selectedIds.size} team{selectedIds.size === 1 ? "" : "s"}{" "}
                      selected
                    </p>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="font-bold text-muted-foreground"
                        onClick={() => setSelectedIds(new Set())}
                        data-testid="btn-clear-selection"
                      >
                        Clear
                      </Button>
                      <Button
                        size="sm"
                        className="font-bold"
                        disabled={bulkHideMutation.isPending}
                        onClick={() => setBulkHideOpen(true)}
                        data-testid="btn-bulk-hide"
                      >
                        <EyeOff className="h-3.5 w-3.5 mr-1" />
                        Hide All ({selectedIds.size})
                      </Button>
                    </div>
                  </div>
                ) : null}
                <div className="flex flex-col gap-3">
                  {teamSections.map((section) => (
                    <div key={section.key} className="space-y-2">
                      {section.title ? (
                        <p
                          className="text-xs font-black uppercase tracking-widest text-muted-foreground pt-1"
                          data-testid={`heading-team-group-${section.key}`}
                        >
                          {section.title}{" "}
                          <span className="font-bold normal-case tracking-normal">
                            ({section.teams.length})
                          </span>
                        </p>
                      ) : null}
                  {section.teams.map((p) => (
                    <div
                      key={p.id}
                      className={`flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 ${
                        p.hidden ? "opacity-60 bg-muted/40" : ""
                      }`}
                      data-testid={`row-participant-${p.id}`}
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-bold break-words">{p.name}</p>
                        <p className="text-xs text-muted-foreground break-words">
                          {groupLabel(p.division, p.bracket)}
                        </p>
                        {p.hidden ? (
                          <p
                            className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground"
                            data-testid={`text-hidden-participant-${p.id}`}
                          >
                            <EyeOff className="h-3 w-3 shrink-0" />
                            Hidden — only competition admins can see this team
                          </p>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {c.canManage && !p.hidden ? (
                          <Checkbox
                            checked={selectedIds.has(p.id)}
                            onCheckedChange={() => toggleSelected(p.id)}
                            aria-label={`Select ${p.name} to hide`}
                            data-testid={`checkbox-select-participant-${p.id}`}
                          />
                        ) : null}
                        {c.canManage ? (
                          p.hidden ? (
                            <Button
                              size="sm"
                              variant="outline"
                              className="font-bold"
                              disabled={hideMutation.isPending}
                              onClick={() =>
                                hideMutation.mutate({
                                  participantId: p.id,
                                  hide: false,
                                  competitionId: c.id,
                                })
                              }
                              data-testid={`btn-unhide-participant-${p.id}`}
                            >
                              Unhide
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="font-bold text-muted-foreground"
                              disabled={hideMutation.isPending}
                              onClick={() => setPendingHide(p)}
                              data-testid={`btn-hide-participant-${p.id}`}
                            >
                              <EyeOff className="h-3.5 w-3.5 mr-1" />
                              Hide
                            </Button>
                          )
                        ) : null}
                        {p.claimed ? (
                          <Badge variant="secondary" className="shrink-0">
                            Taken
                          </Badge>
                        ) : p.hidden ? null : (
                          <Link
                            href={
                              me
                                ? `/c/${encodeURIComponent(slug)}/signup?participant=${p.id}`
                                : `/login?signup=1&returnTo=${encodeURIComponent(`/c/${slug}/signup?participant=${p.id}`)}`
                            }
                          >
                            <Button
                              size="sm"
                              variant="outline"
                              className="font-bold shrink-0"
                              data-testid={`btn-claim-${p.id}`}
                            >
                              Claim
                            </Button>
                          </Link>
                        )}
                      </div>
                    </div>
                  ))}
                    </div>
                  ))}
                  {participants.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No teams have been added to this {typeLabel.toLowerCase()}{" "}
                      yet.
                    </p>
                  ) : null}
                </div>
              </CollapsibleContent>
            </Collapsible>
          </CardContent>
        </Card>

        {/* Schedule */}
        <Card className="rounded-xl border-border" data-testid="card-schedule">
          <CardContent className="p-6">
            <Collapsible
              open={scheduleOpen}
              onOpenChange={setScheduleOpen}
              className="space-y-4"
            >
              <CollapsibleTrigger
                className="flex w-full items-center justify-between gap-2 text-left"
                data-testid="btn-toggle-schedule"
              >
                <h2 className="text-lg font-black tracking-tight">Schedule</h2>
                <ChevronDown
                  className={`h-5 w-5 shrink-0 text-muted-foreground transition-transform ${
                    scheduleOpen ? "rotate-180" : ""
                  }`}
                />
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-4">
            {matchGroups.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No games have been scheduled yet.
              </p>
            ) : (
              matchGroups.map(([label, matches]) => (
                <div key={label} className="space-y-2">
                  <h3 className="text-sm font-black uppercase tracking-wide text-muted-foreground">
                    {label}
                  </h3>
                  <div className="space-y-1">
                    {matches.map((m) => (
                      <div
                        key={m.id}
                        className={`flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm ${
                          m.status === "postponed" || m.status === "canceled"
                            ? "bg-muted/40"
                            : ""
                        }`}
                        data-testid={`row-match-${m.id}`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <span>#{m.matchNumber}</span>
                            {m.matchDate ? <span>{m.matchDate}</span> : null}
                            {m.startTime ? <span>{m.startTime}</span> : null}
                            {m.field ? <span>{m.field}</span> : null}
                          </div>
                          <div
                            className={`truncate font-medium ${
                              m.status === "canceled"
                                ? "line-through text-muted-foreground"
                                : ""
                            }`}
                          >
                            {m.homeName ?? "TBD"}{" "}
                            <span className="text-muted-foreground">vs</span>{" "}
                            {m.awayName ?? "TBD"}
                          </div>
                          {(m.status === "postponed" ||
                            m.status === "canceled") &&
                          m.statusReason ? (
                            <p className="text-xs text-muted-foreground italic mt-0.5 truncate">
                              {m.statusReason}
                            </p>
                          ) : null}
                        </div>
                        {m.status === "postponed" ||
                        m.status === "canceled" ? (
                          <span
                            className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-wider ${
                              m.status === "postponed"
                                ? "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-400"
                                : "border-red-300 bg-red-50 text-red-700 dark:border-red-700 dark:bg-red-950 dark:text-red-400"
                            }`}
                            data-testid={`badge-match-status-${m.id}`}
                          >
                            {m.status === "postponed" ? "Postponed" : "Canceled"}
                          </span>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
              </CollapsibleContent>
            </Collapsible>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground pb-4">
          Powered by <span className="font-bold">Kinectem</span>
        </p>
      </div>

      {/* Hide-team confirmation (operators only). */}
      <AlertDialog
        open={pendingHide != null}
        onOpenChange={(open) => {
          if (!open) setPendingHide(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hide this team?</AlertDialogTitle>
            <AlertDialogDescription>
              "{pendingHide?.name}" will no longer appear in the public Teams
              list, and it can't be claimed while hidden. Its scheduled games
              stay on the schedule. You can unhide it anytime.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="btn-cancel-hide-participant">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              data-testid="btn-confirm-hide-participant"
              onClick={() => {
                if (pendingHide) {
                  hideMutation.mutate({
                    participantId: pendingHide.id,
                    hide: true,
                    competitionId: c.id,
                  });
                }
                setPendingHide(null);
              }}
            >
              Hide team
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Task #866 — bulk hide confirmation (operators only). */}
      <AlertDialog open={bulkHideOpen} onOpenChange={setBulkHideOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Hide {selectedIds.size} team{selectedIds.size === 1 ? "" : "s"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              The selected teams will no longer appear in the public Teams
              list, and they can't be claimed while hidden. Their scheduled
              games stay on the schedule. You can unhide any of them anytime.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="btn-cancel-bulk-hide">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              data-testid="btn-confirm-bulk-hide"
              onClick={() => {
                // Guard against a stale selection (a refetch may have removed
                // or already hidden a team since it was ticked).
                const ids = Array.from(selectedIds).filter((id) =>
                  participants.some((p) => p.id === id && !p.hidden),
                );
                if (ids.length > 0) {
                  bulkHideMutation.mutate({
                    participantIds: ids,
                    competitionId: c.id,
                  });
                } else {
                  setSelectedIds(new Set());
                }
                setBulkHideOpen(false);
              }}
            >
              Hide teams
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
