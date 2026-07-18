import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useRoute } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { BrandColorField } from "@/components/BrandColorField";
import { BrandImageField } from "@/components/BrandImageField";
import { CompetitionAdminsPanel } from "@/components/CompetitionAdminsPanel";
import { CompetitionHowItWorks } from "@/components/CompetitionHowItWorks";
import { OrganizerSidebar } from "@/components/OrganizerSidebar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { buildCompetitionInviteMessage } from "@/lib/competition-invite-message";
import {
  SpotlightTour,
  type TourStep,
} from "@/components/team-page/SpotlightTour";
import {
  Upload,
  Compass,
  ExternalLink,
  Palette,
  Pencil,
  ShieldCheck,
  ArrowLeft,
  Newspaper,
  Star,
  Copy,
  Megaphone,
  Building2,
  CalendarDays,
  CalendarX,
  ChevronDown,
  Plus,
  Trash2,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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

// Competitions §9b — operator console for one competition: branding panel,
// claim-approval queue, and schedule CSV upload. Owner-or-platform-admin only
// (server enforces). customFetch — routes are outside the locked openapi.yaml.

interface CompetitionRow {
  id: string;
  slug: string;
  name: string;
  type: "tournament" | "league";
  startDate: string;
  endDate: string;
  location: string | null;
  organizerId: string | null;
  autoApproveClaims: boolean;
  logoUrl: string | null;
  brandColor: string | null;
  matchCount: number;
  participantCount: number;
  claimedCount: number;
  pendingClaimCount: number;
  accessRole?: "owner" | "admin";
}

interface CompetitionDetail {
  competition: {
    id: string;
    slug: string;
    name: string;
    type: "tournament" | "league";
    startDate: string;
    endDate: string;
    location: string | null;
    description: string | null;
    autoApproveClaims: boolean;
    logoUrl: string | null;
    brandColor: string | null;
    secondaryColor: string | null;
    tertiaryColor: string | null;
    bannerUrl: string | null;
    websiteUrl: string | null;
  };
}

interface PendingClaim {
  participantId: string;
  slotName: string;
  division: string;
  bracket: string;
  pendingTeamId: string | null;
  pendingTeamName: string | null;
  pendingClaimedAt: string | null;
}

const CSV_HEADER =
  "match #,date,start time,age,gender,division,bracket,venue,venue state,field,home team,away team";

const SAMPLE = `${CSV_HEADER}
1,2026-07-11,09:00,U12,boys,Gold,A,Riverside Park,CA,Field 2,Thunder FC,Lightning SC
2,2026-07-11,10:30,U12,boys,Gold,A,Riverside Park,CA,Field 2,Strikers,Comets`;

// Task #768 — import rules, spelled out for organizers. Required columns and
// the alias examples mirror the server's REQUIRED_CSV_COLUMNS +
// CSV_HEADER_ALIASES (display copy only; the post-upload summary below is
// sourced from the server so it can never drift).
const REQUIRED_COLUMNS = ["match #", "date", "home team", "away team"];
const OPTIONAL_COLUMNS = [
  "start time",
  "age",
  "gender",
  "division",
  "bracket",
  "venue",
  "venue state",
  "field",
];
const HEADER_EXAMPLES: { column: string; examples: string }[] = [
  { column: "match #", examples: "Match #, Game #, Match Number, #" },
  { column: "date", examples: "Date, Game Date, Match Date, Day" },
  { column: "start time", examples: "Start Time, Time, Kickoff, Game Time" },
  { column: "age", examples: "Age, Age Group" },
  { column: "gender", examples: "Gender, Boys/Girls" },
  { column: "division", examples: "Division, Div, Flight, Group, Pool" },
  { column: "bracket", examples: "Bracket, Round, Pod" },
  { column: "venue", examples: "Venue, Location, Park, Complex, Site" },
  { column: "venue state", examples: "Venue State, State, ST" },
  { column: "field", examples: "Field, Field #, Pitch, Court, Surface" },
  { column: "home team", examples: "Home Team, Home, Team 1, Team A" },
  { column: "away team", examples: "Away Team, Away, Visitor, Team 2, Team B" },
];

interface ImportColumnSummary {
  matched: { column: string; header: string; required: boolean }[];
  missingOptional: string[];
  ignoredHeaders: string[];
}

interface ImportResult {
  matchesUpserted: number;
  participantCount: number;
  columns?: ImportColumnSummary;
  rowWarnings?: { row: number; reason: string }[];
}

// Task #766 — server dry-run preview: what an upload would add/change/leave
// alone, computed by the exact same parser the real import uses.
interface ImportPreview {
  preview: true;
  added: {
    matchNumber: string;
    matchDate: string | null;
    startTime: string | null;
    homeName: string;
    awayName: string;
  }[];
  changed: {
    matchNumber: string;
    changes: { field: string; before: string; after: string }[];
  }[];
  unchangedCount: number;
  renumberWarnings: {
    fileMatchNumber: string;
    existingMatchNumber: string;
    matchDate: string | null;
    homeName: string;
    awayName: string;
  }[];
  missingFromFile: {
    matchNumber: string;
    matchDate: string | null;
    homeName: string;
    awayName: string;
  }[];
  columns?: ImportColumnSummary;
  rowWarnings?: { row: number; reason: string }[];
}

// Task #772 — reusable collapsible section header, matching the Games
// section's toggle pattern (chevron button in the card title, aria-expanded,
// trailing actions that don't toggle).
function CollapsibleCardHeader({
  icon,
  label,
  open,
  onToggle,
  testId,
  badge,
  actions,
}: {
  icon: ReactNode;
  label: ReactNode;
  open: boolean;
  onToggle: () => void;
  testId: string;
  badge?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <CardHeader>
      <CardTitle className="flex items-center justify-between gap-2 text-base">
        <button
          type="button"
          className="flex items-center gap-2 min-w-0"
          onClick={onToggle}
          aria-expanded={open}
          data-testid={testId}
        >
          {icon}
          {label}
          {badge}
          <ChevronDown
            className={`w-4 h-4 text-muted-foreground transition-transform ${
              open ? "rotate-180" : ""
            }`}
          />
        </button>
        {actions}
      </CardTitle>
    </CardHeader>
  );
}

function DetailsPanel({
  detail,
  competitionId,
}: {
  detail: CompetitionDetail["competition"];
  competitionId: string;
}) {
  const [open, setOpen] = useState(true);
  const qc = useQueryClient();
  const { toast } = useToast();
  const [name, setName] = useState(detail.name);
  const [type, setType] = useState<"tournament" | "league">(detail.type);
  const [startDate, setStartDate] = useState(detail.startDate);
  const [endDate, setEndDate] = useState(detail.endDate);
  const [location, setLocation] = useState(detail.location ?? "");
  const [description, setDescription] = useState(detail.description ?? "");

  useEffect(() => {
    setName(detail.name);
    setType(detail.type);
    setStartDate(detail.startDate);
    setEndDate(detail.endDate);
    setLocation(detail.location ?? "");
    setDescription(detail.description ?? "");
  }, [
    detail.name,
    detail.type,
    detail.startDate,
    detail.endDate,
    detail.location,
    detail.description,
  ]);

  const save = useMutation({
    mutationFn: () =>
      customFetch(`/api/v1/competitions/${competitionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          type,
          startDate,
          endDate,
          location: location.trim() || null,
          description: description.trim() || null,
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["competition"] });
      qc.invalidateQueries({ queryKey: ["my", "competitions"] });
      toast({ title: "Details saved" });
    },
    onError: (err) =>
      toast({
        title: "Couldn't save details",
        description:
          err instanceof Error ? err.message : "Check the values and try again.",
        variant: "destructive",
      }),
  });

  const datesOk = !!startDate && !!endDate && endDate >= startDate;
  const canSave = name.trim().length > 0 && datesOk && !save.isPending;

  return (
    <Card>
      <CollapsibleCardHeader
        icon={<Pencil className="w-4 h-4" />}
        label="Competition details"
        open={open}
        onToggle={() => setOpen((v) => !v)}
        testId="btn-toggle-details"
      />
      {open && (
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="d-name" className="text-xs font-bold">
              Name
            </Label>
            <Input
              id="d-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              data-testid="input-details-name"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-bold">Type</Label>
            <div className="flex gap-2">
              {(["tournament", "league"] as const).map((t) => (
                <Button
                  key={t}
                  type="button"
                  size="sm"
                  variant={type === t ? "brand" : "outline"}
                  className="capitalize font-bold rounded-full"
                  onClick={() => setType(t)}
                  data-testid={`btn-details-type-${t}`}
                >
                  {t}
                </Button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="d-start" className="text-xs font-bold">
              Start date
            </Label>
            <Input
              id="d-start"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              data-testid="input-details-start"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="d-end" className="text-xs font-bold">
              End date
            </Label>
            <Input
              id="d-end"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              data-testid="input-details-end"
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="d-location" className="text-xs font-bold">
              Location <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="d-location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Riverside Sports Complex"
              data-testid="input-details-location"
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="d-description" className="text-xs font-bold">
              Description <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <textarea
              id="d-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="Anything coaches should know about this competition."
              className="w-full rounded-lg border border-border bg-background p-3 text-sm"
              data-testid="input-details-description"
            />
          </div>
        </div>
        {!datesOk && startDate && endDate ? (
          <p className="text-xs text-destructive">
            End date must be on or after the start date.
          </p>
        ) : null}
        <Button
          variant="brand"
          onClick={() => save.mutate()}
          disabled={!canSave}
          data-testid="btn-save-details"
        >
          {save.isPending ? "Saving…" : "Save details"}
        </Button>
      </CardContent>
      )}
    </Card>
  );
}

function BrandingPanel({
  detail,
  competitionId,
}: {
  detail: CompetitionDetail["competition"];
  competitionId: string;
}) {
  const [open, setOpen] = useState(true);
  const qc = useQueryClient();
  const { toast } = useToast();
  const [brandColor, setBrandColor] = useState(detail.brandColor ?? "");
  const [secondaryColor, setSecondaryColor] = useState(
    detail.secondaryColor ?? "",
  );
  const [tertiaryColor, setTertiaryColor] = useState(detail.tertiaryColor ?? "");
  const [logoUrl, setLogoUrl] = useState(detail.logoUrl ?? "");
  const [bannerUrl, setBannerUrl] = useState(detail.bannerUrl ?? "");
  const [websiteUrl, setWebsiteUrl] = useState(detail.websiteUrl ?? "");

  useEffect(() => {
    setBrandColor(detail.brandColor ?? "");
    setSecondaryColor(detail.secondaryColor ?? "");
    setTertiaryColor(detail.tertiaryColor ?? "");
    setLogoUrl(detail.logoUrl ?? "");
    setBannerUrl(detail.bannerUrl ?? "");
    setWebsiteUrl(detail.websiteUrl ?? "");
  }, [
    detail.brandColor,
    detail.secondaryColor,
    detail.tertiaryColor,
    detail.logoUrl,
    detail.bannerUrl,
    detail.websiteUrl,
  ]);

  const save = useMutation({
    mutationFn: () =>
      customFetch(`/api/v1/competitions/${competitionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brandColor: brandColor.trim() || null,
          secondaryColor: secondaryColor.trim() || null,
          tertiaryColor: tertiaryColor.trim() || null,
          logoUrl: logoUrl.trim() || null,
          bannerUrl: bannerUrl.trim() || null,
          websiteUrl: websiteUrl.trim() || null,
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["competition"] });
      qc.invalidateQueries({ queryKey: ["my", "competitions"] });
      toast({ title: "Branding saved" });
    },
    onError: (err) =>
      toast({
        title: "Couldn't save branding",
        description:
          err instanceof Error ? err.message : "Check the values and try again.",
        variant: "destructive",
      }),
  });

  const hexOk = (v: string) =>
    v.trim() === "" || /^#[0-9a-fA-F]{6}$/.test(v.trim());
  const colorOk =
    hexOk(brandColor) && hexOk(secondaryColor) && hexOk(tertiaryColor);

  return (
    <Card>
      <CollapsibleCardHeader
        icon={<Palette className="w-4 h-4" />}
        label="Branding"
        open={open}
        onToggle={() => setOpen((v) => !v)}
        testId="btn-toggle-branding"
      />
      {open && (
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <BrandColorField
            label="Primary color"
            value={brandColor}
            onChange={setBrandColor}
            logoUrl={logoUrl}
            idPrefix="brand"
          />
          <BrandColorField
            label="Secondary color"
            value={secondaryColor}
            onChange={setSecondaryColor}
            logoUrl={logoUrl}
            idPrefix="brand-secondary"
          />
          <BrandColorField
            label="Third color"
            value={tertiaryColor}
            onChange={setTertiaryColor}
            logoUrl={logoUrl}
            idPrefix="brand-tertiary"
          />
          <BrandImageField
            label="Logo"
            value={logoUrl}
            onChange={setLogoUrl}
            kind="logo"
            idPrefix="brand-logo"
          />
          <BrandImageField
            label="Banner"
            value={bannerUrl}
            onChange={setBannerUrl}
            kind="banner"
            idPrefix="brand-banner"
          />
          <div className="space-y-1.5">
            <Label htmlFor="b-site" className="text-xs font-bold">
              Official website
            </Label>
            <Input
              id="b-site"
              value={websiteUrl}
              onChange={(e) => setWebsiteUrl(e.target.value)}
              placeholder="https://mytournament.com"
              data-testid="input-website-url"
            />
          </div>
        </div>
        <Button
          variant="brand"
          onClick={() => save.mutate()}
          disabled={!colorOk || save.isPending}
          data-testid="btn-save-branding"
        >
          {save.isPending ? "Saving…" : "Save branding"}
        </Button>
      </CardContent>
      )}
    </Card>
  );
}

// Task #727 — ready-made copy/paste invite message so the organizer can tell
// participating teams to come claim their slots without writing anything.
function InviteTeamsPanel({
  name,
  type,
  startDate,
  endDate,
  location,
  autoApproveClaims,
  slug,
}: {
  name: string;
  type: "tournament" | "league";
  startDate: string;
  endDate: string;
  location: string | null;
  autoApproveClaims: boolean;
  slug: string;
}) {
  const [open, setOpen] = useState(true);
  const { toast } = useToast();

  // Absolute public link (with the /app prefix) so it works when pasted
  // outside the app — same pattern as the roster invite links.
  const publicUrl = `${window.location.origin}${import.meta.env.BASE_URL}c/${encodeURIComponent(slug)}`;

  const message = buildCompetitionInviteMessage({
    name,
    type,
    startDate,
    endDate,
    location,
    autoApproveClaims,
    url: publicUrl,
  });

  const copyMessage = () =>
    navigator.clipboard
      .writeText(message)
      .then(() => toast({ title: "Message copied" }))
      .catch(() =>
        toast({ title: "Couldn't copy message", variant: "destructive" }),
      );

  return (
    <Card>
      <CollapsibleCardHeader
        icon={<Megaphone className="w-4 h-4" />}
        label="Invite your teams"
        open={open}
        onToggle={() => setOpen((v) => !v)}
        testId="btn-toggle-invite-teams"
      />
      {open && (
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Copy this ready-made message and paste it into an email, group chat,
          or league bulletin — it walks every team through claiming their spot,
          step by step. It always uses your latest name, dates, and public
          link.
        </p>
        <pre
          className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-muted/40 p-3 font-sans text-xs leading-relaxed text-foreground [overflow-wrap:anywhere]"
          data-testid="text-invite-message"
        >
          {message}
        </pre>
        <Button
          variant="brand"
          onClick={copyMessage}
          data-testid="btn-copy-invite-message"
        >
          <Copy className="w-3.5 h-3.5 mr-1.5" />
          Copy message
        </Button>
      </CardContent>
      )}
    </Card>
  );
}

function ClaimsPanel({
  competitionId,
  autoApproveClaims,
}: {
  competitionId: string;
  autoApproveClaims: boolean;
}) {
  const [open, setOpen] = useState(true);
  const qc = useQueryClient();
  const { toast } = useToast();

  const pendingQ = useQuery<{ data: PendingClaim[] }>({
    queryKey: ["competition", competitionId, "pending-claims"],
    queryFn: () =>
      customFetch<{ data: PendingClaim[] }>(
        `/api/v1/competitions/${competitionId}/claims/pending`,
        { method: "GET" },
      ),
  });

  const toggle = useMutation({
    mutationFn: (value: boolean) =>
      customFetch(`/api/v1/competitions/${competitionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autoApproveClaims: value }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my", "competitions"] });
      qc.invalidateQueries({ queryKey: ["competition"] });
    },
    onError: (err) =>
      toast({
        title: "Couldn't update the setting",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      }),
  });

  const decide = useMutation({
    mutationFn: ({ participantId, approve }: { participantId: string; approve: boolean }) =>
      customFetch(
        `/api/v1/competitions/${competitionId}/claims/${participantId}/decide`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ approve }),
        },
      ),
    onSuccess: (_r, vars) => {
      qc.invalidateQueries({
        queryKey: ["competition", competitionId, "pending-claims"],
      });
      qc.invalidateQueries({ queryKey: ["my", "competitions"] });
      toast({ title: vars.approve ? "Claim approved" : "Claim rejected" });
    },
    onError: (err) =>
      toast({
        title: "Couldn't record that decision",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      }),
  });

  const pending = pendingQ.data?.data ?? [];

  return (
    <Card>
      <CollapsibleCardHeader
        icon={<ShieldCheck className="w-4 h-4" />}
        label="Team claims"
        open={open}
        onToggle={() => setOpen((v) => !v)}
        testId="btn-toggle-claims"
      />
      {open && (
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Coaches find their team on your competition page and claim their spot
          — no invites or spreadsheets needed. You decide how hands-on to be
          with the toggle below.
        </p>
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
          <div>
            <p className="text-sm font-bold">Auto-approve claims</p>
            <p className="text-xs text-muted-foreground">
              {autoApproveClaims
                ? "Teams claim their spot instantly — perfect for a hands-off setup."
                : "You personally review and approve every claim before a team is locked in."}
            </p>
          </div>
          <Switch
            checked={autoApproveClaims}
            onCheckedChange={(v) => toggle.mutate(v)}
            disabled={toggle.isPending}
            data-testid="switch-auto-approve"
          />
        </div>

        {pendingQ.isLoading ? (
          <Skeleton className="h-16 rounded-lg" />
        ) : pending.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No claims waiting for review — when approval is required, new
            claims will appear right here for your sign-off.
          </p>
        ) : (
          <div className="space-y-2">
            {pending.map((p) => (
              <div
                key={p.participantId}
                className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 flex-wrap"
                data-testid={`row-pending-${p.participantId}`}
              >
                <div className="min-w-0">
                  <p className="text-sm font-bold truncate">
                    {p.pendingTeamName ?? "New team"}{" "}
                    <span className="font-normal text-muted-foreground">
                      → slot “{p.slotName}”
                    </span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {[p.division, p.bracket].filter(Boolean).join(" · ") || "General"}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    size="sm"
                    variant="brand"
                    disabled={decide.isPending}
                    onClick={() =>
                      decide.mutate({ participantId: p.participantId, approve: true })
                    }
                    data-testid={`btn-approve-${p.participantId}`}
                  >
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="font-bold"
                    disabled={decide.isPending}
                    onClick={() =>
                      decide.mutate({ participantId: p.participantId, approve: false })
                    }
                    data-testid={`btn-reject-${p.participantId}`}
                  >
                    Reject
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
      )}
    </Card>
  );
}

interface CurationRecap {
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
  featured: boolean;
  createdAt: string;
}

function CurationPanel({ competitionId }: { competitionId: string }) {
  const [open, setOpen] = useState(true);
  const qc = useQueryClient();
  const { toast } = useToast();

  // Deep-link target from the public page's "Feature recaps" / "Manage"
  // buttons — scroll this panel into view when arriving via #recaps.
  const anchorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (window.location.hash === "#recaps") {
      anchorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, []);

  const recapsQ = useQuery<{ data: CurationRecap[] }>({
    queryKey: ["competition", competitionId, "recaps"],
    queryFn: () =>
      customFetch<{ data: CurationRecap[] }>(
        `/api/v1/competitions/${competitionId}/recaps`,
        { method: "GET" },
      ),
  });

  const feature = useMutation({
    mutationFn: ({ articleId, featured }: { articleId: string; featured: boolean }) =>
      customFetch(
        `/api/v1/competitions/${competitionId}/recaps/${articleId}/feature`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ featured }),
        },
      ),
    onSuccess: (_r, vars) => {
      qc.invalidateQueries({ queryKey: ["competition", competitionId, "recaps"] });
      qc.invalidateQueries({ queryKey: ["competition"] });
      toast({
        title: vars.featured ? "Featured on your public page" : "Removed from the rail",
      });
    },
    onError: (err) =>
      toast({
        title: "Couldn't update that recap",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      }),
  });

  const recaps = recapsQ.data?.data ?? [];

  return (
    <Card id="recaps" ref={anchorRef} className="scroll-mt-6">
      <CollapsibleCardHeader
        icon={<Newspaper className="w-4 h-4" />}
        label="Game recaps"
        badge={
          recaps.length > 0 ? (
            <Badge variant="secondary" className="ml-1">
              {recaps.length}
            </Badge>
          ) : undefined
        }
        open={open}
        onToggle={() => setOpen((v) => !v)}
        testId="btn-toggle-recaps"
      />
      {open && (
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Recaps written by claimed teams land here. Feature the best ones to
          show them on your public page.
        </p>
        {recapsQ.isLoading ? (
          <Skeleton className="h-16 rounded-lg" />
        ) : recaps.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No game recaps yet — they appear as claimed teams write them.
          </p>
        ) : (
          <div className="space-y-2">
            {recaps.map((r) => (
              <div
                key={r.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 flex-wrap"
                data-testid={`row-recap-${r.id}`}
              >
                <div className="min-w-0">
                  <p className="text-sm font-bold truncate">
                    {r.title}
                    {r.featured && (
                      <Star className="inline w-3.5 h-3.5 ml-1.5 -mt-0.5 fill-amber-400 text-amber-400" />
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {r.teamName}
                    {r.opponentName ? ` vs ${r.opponentName}` : ""}
                    {r.teamScore != null && r.opponentScore != null
                      ? ` · ${r.teamScore}-${r.opponentScore}`
                      : ""}
                    {r.gameDate
                      ? ` · ${new Date(r.gameDate).toLocaleDateString()}`
                      : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <a href={`/app/posts/${r.id}`} target="_blank" rel="noopener noreferrer">
                    <Button size="sm" variant="ghost" className="font-bold text-muted-foreground">
                      View
                    </Button>
                  </a>
                  {r.featured ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="font-bold"
                      disabled={feature.isPending}
                      onClick={() => feature.mutate({ articleId: r.id, featured: false })}
                      data-testid={`btn-unfeature-${r.id}`}
                    >
                      Hide
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="brand"
                      disabled={feature.isPending}
                      onClick={() => feature.mutate({ articleId: r.id, featured: true })}
                      data-testid={`btn-feature-${r.id}`}
                    >
                      <Star className="w-3.5 h-3.5 mr-1" />
                      Feature
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
      )}
    </Card>
  );
}

function SchedulePanel({
  competitionId,
  matchCount,
  isLeague,
}: {
  competitionId: string;
  matchCount: number;
  isLeague: boolean;
}) {
  const [open, setOpen] = useState(true);
  const qc = useQueryClient();
  const { toast } = useToast();
  const [csv, setCsv] = useState("");
  const [pasteOpen, setPasteOpen] = useState(false);
  const [lastResult, setLastResult] = useState<ImportResult | null>(null);
  // Task #766 — two-step import: server dry-run first, organizer confirms.
  // pendingCsv is the exact text the preview was computed from; confirm
  // sends that same text so what you saw is what gets applied.
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [pendingCsv, setPendingCsv] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const previewMut = useMutation({
    mutationFn: (csvText: string) =>
      customFetch<ImportPreview>(
        `/api/v1/competitions/${competitionId}/import`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ csv: csvText, dryRun: true }),
        },
      ),
    onSuccess: (r, csvText) => {
      setPendingCsv(csvText);
      setPreview(r);
    },
    onError: (err) =>
      toast({
        title: "Couldn't read that file",
        description:
          err instanceof Error ? err.message : "Check the CSV format and try again.",
        variant: "destructive",
      }),
  });

  const importMut = useMutation({
    mutationFn: (csvText: string) =>
      customFetch<ImportResult>(
        `/api/v1/competitions/${competitionId}/import`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ csv: csvText }),
        },
      ),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["my", "competitions"] });
      qc.invalidateQueries({ queryKey: ["competition"] });
      setLastResult(r);
      toast({
        title: "Schedule uploaded",
        description: `${r.matchesUpserted} games · ${r.participantCount} teams.`,
      });
      setCsv("");
      setPreview(null);
      setPendingCsv("");
    },
    onError: (err) =>
      toast({
        title: "Upload failed",
        description:
          err instanceof Error ? err.message : "Check the CSV format and try again.",
        variant: "destructive",
      }),
  });

  const downloadSample = () => {
    const blob = new Blob([SAMPLE + "\n"], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "kinectem-schedule-sample.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const cols = lastResult?.columns;
  const warnings = lastResult?.rowWarnings ?? [];

  return (
    <Card>
      <CollapsibleCardHeader
        icon={<Upload className="w-4 h-4" />}
        label={`Schedule (${matchCount} games)`}
        open={open}
        onToggle={() => setOpen((v) => !v)}
        testId="btn-toggle-schedule"
      />
      {open && (
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Upload the CSV your scheduling tool exports — as-is, no cleanup
          needed.
        </p>
        <div
          className="rounded-lg border border-border bg-muted/40 p-3 space-y-2"
          data-testid="text-import-rules"
        >
          <p className="text-xs">
            <span className="font-bold">Only 4 columns are required:</span>{" "}
            {REQUIRED_COLUMNS.join(", ")}.
          </p>
          <p className="text-xs text-muted-foreground">
            <span className="font-bold text-foreground">
              Everything else is optional
            </span>{" "}
            ({OPTIONAL_COLUMNS.join(", ")}) — leave any of them out and those
            details simply stay blank.{" "}
            <span className="font-bold text-foreground">
              Extra columns are ignored
            </span>
            , so you don't need to delete anything from your file.
          </p>
          <p className="text-xs text-muted-foreground">
            <span className="font-bold text-foreground">
              Re-uploading is safe:
            </span>{" "}
            games are matched by their match #, so existing games update in
            place — nothing is duplicated or deleted, and claimed teams keep
            their claims.{" "}
            {isLeague
              ? "Partial files are fine too — uploading just this week's games is the intended weekly workflow."
              : "Partial files are fine — you can upload the rest of the schedule later."}
          </p>
        </div>
        <details className="rounded-lg border border-border p-3">
          <summary
            className="cursor-pointer text-xs font-bold"
            data-testid="toggle-header-reference"
          >
            Column names we recognize (your tool's spelling usually just works)
          </summary>
          <div className="mt-2 space-y-1">
            <p className="text-[11px] text-muted-foreground">
              Capitalization, spaces, dashes, and underscores don't matter.
              A few examples per column:
            </p>
            <table className="w-full text-[11px]">
              <tbody>
                {HEADER_EXAMPLES.map((h) => (
                  <tr key={h.column} className="border-t border-border/60">
                    <td className="py-1 pr-2 font-bold whitespace-nowrap align-top">
                      {h.column}
                      {REQUIRED_COLUMNS.includes(h.column) ? (
                        <span className="ml-1 font-normal text-muted-foreground">
                          (required)
                        </span>
                      ) : null}
                    </td>
                    <td className="py-1 text-muted-foreground">{h.examples}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <code className="block min-w-0 flex-1 rounded-md bg-muted p-2 text-[11px] leading-relaxed break-words">
            {CSV_HEADER}
          </code>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="rounded-full font-bold text-muted-foreground shrink-0"
            onClick={downloadSample}
            data-testid="btn-download-sample"
          >
            Download sample CSV
          </Button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f)
              void f.text().then((text) => {
                setCsv(text);
                previewMut.mutate(text);
              });
            e.target.value = "";
          }}
          data-testid="input-csv-file"
        />
        <Button
          type="button"
          variant="brand"
          size="lg"
          className="w-full font-bold"
          disabled={importMut.isPending || previewMut.isPending}
          onClick={() => fileRef.current?.click()}
          data-testid="btn-csv-choose-file"
        >
          <Upload className="mr-2 h-4 w-4" />
          {previewMut.isPending
            ? "Reading your schedule…"
            : importMut.isPending
              ? "Uploading your schedule…"
              : "Upload schedule file"}
        </Button>
        <p className="text-center text-xs text-muted-foreground">
          Pick the CSV your scheduling tool exported — we'll read it and set up
          the games automatically.
        </p>
        {!pasteOpen ? (
          <div className="flex items-center justify-center gap-3">
            <button
              type="button"
              className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground"
              onClick={() => setPasteOpen(true)}
              data-testid="btn-csv-paste-toggle"
            >
              Or paste the CSV text instead
            </button>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-end">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="rounded-full font-bold text-muted-foreground"
                onClick={() => setCsv(SAMPLE)}
                data-testid="btn-csv-sample"
              >
                Insert sample
              </Button>
            </div>
            <textarea
              value={csv}
              onChange={(e) => setCsv(e.target.value)}
              rows={8}
              spellCheck={false}
              placeholder={CSV_HEADER}
              className="w-full rounded-lg border border-border bg-background p-3 font-mono text-xs"
              data-testid="input-csv"
            />
          </>
        )}
        {pasteOpen ? (
          <Button
            variant="brand"
            onClick={() => previewMut.mutate(csv)}
            disabled={
              !pasteOpen ||
              !csv.trim() ||
              importMut.isPending ||
              previewMut.isPending
            }
            data-testid="btn-upload-schedule"
          >
            <Upload className="w-3.5 h-3.5 mr-1.5" />
            {previewMut.isPending
              ? "Reading…"
              : importMut.isPending
                ? "Uploading…"
                : "Preview pasted CSV"}
          </Button>
        ) : null}
        {lastResult ? (
          <div
            className="rounded-lg border border-border p-3 space-y-2"
            data-testid="panel-import-summary"
          >
            <p className="text-xs font-bold">
              Last upload: {lastResult.matchesUpserted} games ·{" "}
              {lastResult.participantCount} teams
            </p>
            {cols ? (
              <>
                <p className="text-[11px] text-muted-foreground">
                  <span className="font-bold text-foreground">
                    Columns we read:
                  </span>{" "}
                  {cols.matched
                    .map((m) =>
                      m.header.toLowerCase() === m.column.toLowerCase()
                        ? m.column
                        : `${m.column} (from your "${m.header}" column)`,
                    )
                    .join(" · ")}
                </p>
                {cols.missingOptional.length > 0 ? (
                  <p className="text-[11px] text-muted-foreground">
                    <span className="font-bold text-foreground">
                      Not in your file (optional, left blank):
                    </span>{" "}
                    {cols.missingOptional.join(" · ")}
                  </p>
                ) : null}
                {cols.ignoredHeaders.length > 0 ? (
                  <p className="text-[11px] text-muted-foreground">
                    <span className="font-bold text-foreground">
                      Ignored columns:
                    </span>{" "}
                    {cols.ignoredHeaders.map((h) => `"${h}"`).join(" · ")} —
                    if one of these should have been read (say, a team
                    column), rename its header and re-upload.
                  </p>
                ) : null}
              </>
            ) : null}
            {warnings.length > 0 ? (
              <div className="space-y-1" data-testid="list-import-warnings">
                <p className="text-[11px] font-bold text-amber-600 dark:text-amber-500">
                  {warnings.length} row{warnings.length === 1 ? "" : "s"} to
                  double-check:
                </p>
                <ul className="space-y-0.5">
                  {warnings.slice(0, 8).map((w, i) => (
                    <li
                      key={`${w.row}-${i}`}
                      className="text-[11px] text-muted-foreground"
                    >
                      Row {w.row}: {w.reason}
                    </li>
                  ))}
                  {warnings.length > 8 ? (
                    <li className="text-[11px] text-muted-foreground">
                      …and {warnings.length - 8} more.
                    </li>
                  ) : null}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
      </CardContent>
      )}

      {/* Task #766 — preview dialog: what this upload will do, before it does it */}
      <Dialog
        open={preview !== null}
        onOpenChange={(open) => {
          if (!open && !importMut.isPending) {
            setPreview(null);
            setPendingCsv("");
          }
        }}
      >
        <DialogContent
          className="max-h-[85vh] overflow-y-auto sm:max-w-xl"
          data-testid="dialog-import-preview"
        >
          <DialogHeader>
            <DialogTitle>Review before uploading</DialogTitle>
            <DialogDescription>
              Nothing has been changed yet — here's what this file will do.
            </DialogDescription>
          </DialogHeader>
          {preview ? (
            <div className="space-y-3 text-sm">
              <div className="flex gap-2 flex-wrap" data-testid="text-preview-counts">
                <Badge variant="secondary" className="font-bold">
                  {preview.added.length} new
                </Badge>
                <Badge variant="secondary" className="font-bold">
                  {preview.changed.length} changed
                </Badge>
                <Badge variant="secondary" className="font-bold">
                  {preview.unchangedCount} unchanged
                </Badge>
              </div>

              {preview.renumberWarnings.length > 0 ? (
                <div
                  className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 p-3 space-y-1"
                  data-testid="panel-renumber-warning"
                >
                  <p className="text-xs font-bold text-amber-700 dark:text-amber-400">
                    Possible renumbered schedule — double-check before applying
                  </p>
                  <p className="text-[11px] text-amber-700/90 dark:text-amber-400/90">
                    {preview.renumberWarnings.length} "new" game
                    {preview.renumberWarnings.length === 1 ? "" : "s"} in this
                    file look{preview.renumberWarnings.length === 1 ? "s" : ""}{" "}
                    identical to existing games (same date and teams) but under
                    a different match #. If your scheduling tool regenerated
                    match numbers, uploading would create duplicates instead of
                    updating the originals.
                  </p>
                  <ul className="space-y-0.5">
                    {preview.renumberWarnings.slice(0, 6).map((w) => (
                      <li
                        key={`${w.fileMatchNumber}-${w.existingMatchNumber}`}
                        className="text-[11px] text-amber-700/90 dark:text-amber-400/90"
                      >
                        File #{w.fileMatchNumber} ({w.homeName} vs {w.awayName}
                        {w.matchDate ? `, ${w.matchDate}` : ""}) matches
                        existing game #{w.existingMatchNumber}.
                      </li>
                    ))}
                    {preview.renumberWarnings.length > 6 ? (
                      <li className="text-[11px] text-amber-700/90 dark:text-amber-400/90">
                        …and {preview.renumberWarnings.length - 6} more.
                      </li>
                    ) : null}
                  </ul>
                </div>
              ) : null}

              {preview.changed.length > 0 ? (
                <div className="space-y-1" data-testid="list-preview-changed">
                  <p className="text-xs font-bold">
                    Changing ({preview.changed.length})
                  </p>
                  <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
                    {preview.changed.map((c) => (
                      <div
                        key={c.matchNumber}
                        className="rounded-md border border-border px-2.5 py-1.5"
                      >
                        <p className="text-xs font-bold">Game #{c.matchNumber}</p>
                        <ul>
                          {c.changes.map((ch) => (
                            <li
                              key={ch.field}
                              className="text-[11px] text-muted-foreground [overflow-wrap:anywhere]"
                            >
                              {ch.field}:{" "}
                              <span className="line-through">{ch.before}</span>{" "}
                              → <span className="text-foreground">{ch.after}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {preview.added.length > 0 ? (
                <div className="space-y-1" data-testid="list-preview-added">
                  <p className="text-xs font-bold">
                    Adding ({preview.added.length})
                  </p>
                  <ul className="space-y-0.5 max-h-36 overflow-y-auto pr-1">
                    {preview.added.slice(0, 30).map((a) => (
                      <li
                        key={a.matchNumber}
                        className="text-[11px] text-muted-foreground"
                      >
                        #{a.matchNumber} · {a.homeName || "TBD"} vs{" "}
                        {a.awayName || "TBD"}
                        {a.matchDate ? ` · ${a.matchDate}` : ""}
                        {a.startTime ? ` · ${a.startTime}` : ""}
                      </li>
                    ))}
                    {preview.added.length > 30 ? (
                      <li className="text-[11px] text-muted-foreground">
                        …and {preview.added.length - 30} more.
                      </li>
                    ) : null}
                  </ul>
                </div>
              ) : null}

              {preview.missingFromFile.length > 0 ? (
                <p
                  className="text-[11px] text-muted-foreground"
                  data-testid="text-preview-missing"
                >
                  <span className="font-bold text-foreground">
                    Not in this file (left untouched):
                  </span>{" "}
                  {preview.missingFromFile.length} existing game
                  {preview.missingFromFile.length === 1 ? "" : "s"} — imports
                  never delete games.
                </p>
              ) : null}

              {(preview.rowWarnings?.length ?? 0) > 0 ? (
                <div className="space-y-0.5" data-testid="list-preview-warnings">
                  <p className="text-[11px] font-bold text-amber-600 dark:text-amber-500">
                    {preview.rowWarnings!.length} row
                    {preview.rowWarnings!.length === 1 ? "" : "s"} to
                    double-check:
                  </p>
                  <ul className="space-y-0.5 max-h-24 overflow-y-auto pr-1">
                    {preview.rowWarnings!.slice(0, 8).map((w, i) => (
                      <li
                        key={`${w.row}-${i}`}
                        className="text-[11px] text-muted-foreground"
                      >
                        {w.row > 0 ? `Row ${w.row}: ` : ""}
                        {w.reason}
                      </li>
                    ))}
                    {preview.rowWarnings!.length > 8 ? (
                      <li className="text-[11px] text-muted-foreground">
                        …and {preview.rowWarnings!.length - 8} more.
                      </li>
                    ) : null}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={importMut.isPending}
              onClick={() => {
                setPreview(null);
                setPendingCsv("");
              }}
              data-testid="btn-cancel-import"
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="brand"
              className="font-bold"
              disabled={importMut.isPending || !pendingCsv}
              onClick={() => importMut.mutate(pendingCsv)}
              data-testid="btn-confirm-import"
            >
              {importMut.isPending ? "Applying…" : "Apply these changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Task #765 — inline single-game management. Lists the imported schedule and
// lets the organizer edit, add, postpone/cancel (with optional reason), and
// delete individual games without touching the CSV.
// ---------------------------------------------------------------------------

interface ConsoleMatch {
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
  status: "scheduled" | "postponed" | "canceled";
  statusReason: string | null;
}

interface GameFormState {
  matchNumber: string;
  matchDate: string;
  startTime: string;
  division: string;
  bracket: string;
  homeName: string;
  awayName: string;
  venue: string;
  venueState: string;
  field: string;
  age: string;
  gender: string;
}

const EMPTY_GAME_FORM: GameFormState = {
  matchNumber: "",
  matchDate: "",
  startTime: "",
  division: "",
  bracket: "",
  homeName: "",
  awayName: "",
  venue: "",
  venueState: "",
  field: "",
  age: "",
  gender: "",
};

function formFromMatch(m: ConsoleMatch): GameFormState {
  return {
    matchNumber: m.matchNumber,
    matchDate: m.matchDate ?? "",
    startTime: m.startTime ?? "",
    division: m.division,
    bracket: m.bracket,
    homeName: m.homeName ?? "",
    awayName: m.awayName ?? "",
    venue: m.venue ?? "",
    venueState: m.venueState ?? "",
    field: m.field ?? "",
    age: m.age ?? "",
    gender: m.gender ?? "",
  };
}

// Suggest the next match number: one above the current numeric max. Falls
// back to "1" when no games have a numeric match #.
function suggestMatchNumber(matches: ConsoleMatch[]): string {
  let max = 0;
  for (const m of matches) {
    const n = Number(m.matchNumber);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return String(max + 1);
}

const STATUS_BADGE: Record<
  "postponed" | "canceled",
  { label: string; cls: string }
> = {
  postponed: {
    label: "Postponed",
    cls: "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-400",
  },
  canceled: {
    label: "Canceled",
    cls: "border-red-300 bg-red-50 text-red-700 dark:border-red-700 dark:bg-red-950 dark:text-red-400",
  },
};

function GameFormFields({
  form,
  setForm,
}: {
  form: GameFormState;
  setForm: (f: GameFormState) => void;
}) {
  const set = (k: keyof GameFormState) => (v: string) =>
    setForm({ ...form, [k]: v });
  const field = (
    k: keyof GameFormState,
    label: string,
    props?: { placeholder?: string; type?: string; required?: boolean },
  ) => (
    <div className="space-y-1">
      <Label htmlFor={`game-${k}`} className="text-xs">
        {label}
        {props?.required ? " *" : ""}
      </Label>
      <Input
        id={`game-${k}`}
        type={props?.type ?? "text"}
        value={form[k]}
        placeholder={props?.placeholder}
        onChange={(e) => set(k)(e.target.value)}
        data-testid={`input-game-${k}`}
      />
    </div>
  );
  return (
    <div className="grid grid-cols-2 gap-3">
      {field("matchNumber", "Match #", { required: true })}
      {field("matchDate", "Date", { type: "date" })}
      {field("startTime", "Start time", { placeholder: "e.g. 5:30 PM" })}
      {field("field", "Field", { placeholder: "e.g. Field 2" })}
      {field("homeName", "Home team")}
      {field("awayName", "Away team")}
      {field("venue", "Venue")}
      {field("venueState", "Venue state", { placeholder: "e.g. CA" })}
      {field("division", "Division")}
      {field("bracket", "Bracket")}
      {field("age", "Age group", { placeholder: "e.g. U12" })}
      {field("gender", "Gender", { placeholder: "e.g. boys" })}
    </div>
  );
}

function GamesPanel({
  competitionId,
  slug,
}: {
  competitionId: string;
  slug: string;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();

  // Same cache entry the public page + DetailsPanel use, extended with the
  // matches array this panel manages.
  const q = useQuery<{ matches: ConsoleMatch[] }>({
    queryKey: ["competition", slug],
    queryFn: () =>
      customFetch<{ matches: ConsoleMatch[] }>(
        `/api/v1/competitions/${encodeURIComponent(slug)}`,
        { method: "GET" },
      ),
  });
  const matches = q.data?.matches ?? [];

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["competition"] });
    qc.invalidateQueries({ queryKey: ["my", "competitions"] });
  };

  // Dialog state: null = closed; "new" = add game; otherwise the match
  // being edited.
  const [editTarget, setEditTarget] = useState<ConsoleMatch | "new" | null>(
    null,
  );
  const [form, setForm] = useState<GameFormState>(EMPTY_GAME_FORM);
  const [statusTarget, setStatusTarget] = useState<ConsoleMatch | null>(null);
  const [statusChoice, setStatusChoice] = useState<"postponed" | "canceled">(
    "postponed",
  );
  const [statusReason, setStatusReason] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<ConsoleMatch | null>(null);
  // Long schedules (hundreds of games) shouldn't dominate the console —
  // collapsed by default, expand on demand.
  const [listOpen, setListOpen] = useState(false);

  const openAdd = () => {
    setForm({ ...EMPTY_GAME_FORM, matchNumber: suggestMatchNumber(matches) });
    setEditTarget("new");
  };
  const openEdit = (m: ConsoleMatch) => {
    setForm(formFromMatch(m));
    setEditTarget(m);
  };

  const bodyFromForm = () => ({
    matchNumber: form.matchNumber.trim(),
    matchDate: form.matchDate.trim() || null,
    startTime: form.startTime.trim() || null,
    division: form.division.trim(),
    bracket: form.bracket.trim(),
    homeName: form.homeName.trim() || null,
    awayName: form.awayName.trim() || null,
    venue: form.venue.trim() || null,
    venueState: form.venueState.trim() || null,
    field: form.field.trim() || null,
    age: form.age.trim() || null,
    gender: form.gender.trim() || null,
  });

  const saveMut = useMutation({
    mutationFn: () => {
      const body = JSON.stringify(bodyFromForm());
      return editTarget === "new"
        ? customFetch(`/api/v1/competitions/${competitionId}/matches`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body,
          })
        : customFetch(
            `/api/v1/competitions/${competitionId}/matches/${(editTarget as ConsoleMatch).id}`,
            {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body,
            },
          );
    },
    onSuccess: () => {
      invalidate();
      toast({
        title: editTarget === "new" ? "Game added" : "Game updated",
      });
      setEditTarget(null);
    },
    onError: (err) =>
      toast({
        title: "Couldn't save the game",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      }),
  });

  const statusMut = useMutation({
    mutationFn: ({
      matchId,
      status,
      reason,
    }: {
      matchId: string;
      status: "scheduled" | "postponed" | "canceled";
      reason?: string;
    }) =>
      customFetch(
        `/api/v1/competitions/${competitionId}/matches/${matchId}/status`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status, reason: reason || null }),
        },
      ),
    onSuccess: (_r, vars) => {
      invalidate();
      toast({
        title:
          vars.status === "scheduled"
            ? "Game back on the schedule"
            : vars.status === "postponed"
              ? "Game postponed"
              : "Game canceled",
      });
      setStatusTarget(null);
    },
    onError: (err) =>
      toast({
        title: "Couldn't update the game status",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      }),
  });

  const deleteMut = useMutation({
    mutationFn: (matchId: string) =>
      customFetch(
        `/api/v1/competitions/${competitionId}/matches/${matchId}`,
        { method: "DELETE" },
      ),
    onSuccess: () => {
      invalidate();
      toast({ title: "Game deleted" });
      setDeleteTarget(null);
    },
    onError: (err) =>
      toast({
        title: "Couldn't delete the game",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      }),
  });

  return (
    <Card data-testid="panel-games">
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2 text-base">
          <button
            type="button"
            className="flex items-center gap-2 min-w-0"
            onClick={() => setListOpen((v) => !v)}
            aria-expanded={listOpen}
            data-testid="btn-toggle-games-list"
          >
            <CalendarDays className="w-4 h-4" />
            Games ({matches.length})
            <ChevronDown
              className={`w-4 h-4 text-muted-foreground transition-transform ${
                listOpen ? "rotate-180" : ""
              }`}
            />
          </button>
          <Button
            size="sm"
            variant="brand"
            className="font-bold"
            onClick={openAdd}
            data-testid="btn-add-game"
          >
            <Plus className="w-3.5 h-3.5 mr-1" />
            Add game
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Fix a one-off change right here — move a time, swap a venue, postpone
          a rainout.{" "}
          <span className="font-bold text-foreground">
            Heads up: re-uploading your CSV overwrites these edits
          </span>{" "}
          for any game with the same match # (the CSV stays the bulk source of
          truth). Postponed/canceled marks are kept.
        </p>
        {!listOpen ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="font-bold"
            onClick={() => setListOpen(true)}
            data-testid="btn-show-games-list"
          >
            <ChevronDown className="w-3.5 h-3.5 mr-1" />
            Show {matches.length > 0 ? `all ${matches.length} ` : ""}games
          </Button>
        ) : q.isLoading ? (
          <Skeleton className="h-24 rounded-lg" />
        ) : matches.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No games yet — upload a CSV below or add one here.
          </p>
        ) : (
          <div className="space-y-1.5">
            {matches.map((m) => (
              <div
                key={m.id}
                className={`rounded-lg border border-border px-3 py-2 flex items-start justify-between gap-3 flex-wrap ${
                  m.status !== "scheduled" ? "bg-muted/40" : ""
                }`}
                data-testid={`row-game-${m.id}`}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p
                      className={`text-sm font-bold ${
                        m.status === "canceled"
                          ? "line-through text-muted-foreground"
                          : ""
                      }`}
                    >
                      {m.homeName ?? "TBD"}{" "}
                      <span className="font-normal text-muted-foreground">
                        vs
                      </span>{" "}
                      {m.awayName ?? "TBD"}
                    </p>
                    {m.status !== "scheduled" && (
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-wider ${STATUS_BADGE[m.status].cls}`}
                        data-testid={`badge-status-${m.id}`}
                      >
                        {STATUS_BADGE[m.status].label}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    #{m.matchNumber}
                    {m.matchDate ? ` · ${m.matchDate}` : ""}
                    {m.startTime ? ` · ${m.startTime}` : ""}
                    {[m.division, m.bracket].filter(Boolean).length > 0
                      ? ` · ${[m.division, m.bracket].filter(Boolean).join(" / ")}`
                      : ""}
                    {[m.venue, m.field].filter(Boolean).length > 0
                      ? ` · ${[m.venue, m.field].filter(Boolean).join(", ")}`
                      : ""}
                  </p>
                  {m.status !== "scheduled" && m.statusReason ? (
                    <p className="text-xs text-muted-foreground italic mt-0.5">
                      Reason: {m.statusReason}
                    </p>
                  ) : null}
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="font-bold text-muted-foreground"
                    onClick={() => openEdit(m)}
                    data-testid={`btn-edit-game-${m.id}`}
                  >
                    <Pencil className="w-3.5 h-3.5 mr-1" />
                    Edit
                  </Button>
                  {m.status === "scheduled" ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="font-bold text-muted-foreground"
                      onClick={() => {
                        setStatusChoice("postponed");
                        setStatusReason("");
                        setStatusTarget(m);
                      }}
                      data-testid={`btn-status-game-${m.id}`}
                    >
                      <CalendarX className="w-3.5 h-3.5 mr-1" />
                      Postpone / cancel
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      className="font-bold"
                      disabled={statusMut.isPending}
                      onClick={() =>
                        statusMut.mutate({ matchId: m.id, status: "scheduled" })
                      }
                      data-testid={`btn-restore-game-${m.id}`}
                    >
                      Back to scheduled
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="font-bold text-muted-foreground hover:text-destructive"
                    onClick={() => setDeleteTarget(m)}
                    data-testid={`btn-delete-game-${m.id}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      {/* Add / edit game dialog */}
      <Dialog
        open={editTarget !== null}
        onOpenChange={(open) => {
          if (!open) setEditTarget(null);
        }}
      >
        <DialogContent
          className="max-h-[85vh] overflow-y-auto sm:max-w-lg"
          data-testid="dialog-game-form"
        >
          <DialogHeader>
            <DialogTitle>
              {editTarget === "new" ? "Add a game" : "Edit game"}
            </DialogTitle>
            <DialogDescription>
              {editTarget === "new"
                ? "Adds one game to the schedule — no CSV needed. The match # is suggested; change it if your numbering differs."
                : "Changes save to this one game. A later CSV re-upload with the same match # will overwrite them."}
            </DialogDescription>
          </DialogHeader>
          <GameFormFields form={form} setForm={setForm} />
          <DialogFooter>
            <Button
              variant="outline"
              className="font-bold"
              onClick={() => setEditTarget(null)}
              data-testid="btn-cancel-game-form"
            >
              Cancel
            </Button>
            <Button
              variant="brand"
              className="font-bold"
              disabled={!form.matchNumber.trim() || saveMut.isPending}
              onClick={() => saveMut.mutate()}
              data-testid="btn-save-game"
            >
              {saveMut.isPending
                ? "Saving…"
                : editTarget === "new"
                  ? "Add game"
                  : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Postpone / cancel dialog */}
      <Dialog
        open={statusTarget !== null}
        onOpenChange={(open) => {
          if (!open) setStatusTarget(null);
        }}
      >
        <DialogContent data-testid="dialog-game-status">
          <DialogHeader>
            <DialogTitle>
              Postpone or cancel game #{statusTarget?.matchNumber}
            </DialogTitle>
            <DialogDescription>
              The game stays on the public schedule with a clear{" "}
              {statusChoice === "postponed" ? "Postponed" : "Canceled"} label —
              it never silently disappears. You can undo this anytime.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex gap-2">
              <Button
                variant={statusChoice === "postponed" ? "brand" : "outline"}
                className="flex-1 font-bold"
                onClick={() => setStatusChoice("postponed")}
                data-testid="btn-choice-postponed"
              >
                Postponed
              </Button>
              <Button
                variant={statusChoice === "canceled" ? "brand" : "outline"}
                className="flex-1 font-bold"
                onClick={() => setStatusChoice("canceled")}
                data-testid="btn-choice-canceled"
              >
                Canceled
              </Button>
            </div>
            <div className="space-y-1">
              <Label htmlFor="status-reason" className="text-xs">
                Reason (optional, shown publicly)
              </Label>
              <Input
                id="status-reason"
                value={statusReason}
                maxLength={300}
                placeholder="e.g. Rainout — field flooded"
                onChange={(e) => setStatusReason(e.target.value)}
                data-testid="input-status-reason"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              className="font-bold"
              onClick={() => setStatusTarget(null)}
              data-testid="btn-cancel-status"
            >
              Never mind
            </Button>
            <Button
              variant="brand"
              className="font-bold"
              disabled={statusMut.isPending}
              onClick={() => {
                if (statusTarget) {
                  statusMut.mutate({
                    matchId: statusTarget.id,
                    status: statusChoice,
                    reason: statusReason.trim() || undefined,
                  });
                }
              }}
              data-testid="btn-confirm-status"
            >
              {statusMut.isPending
                ? "Saving…"
                : statusChoice === "postponed"
                  ? "Mark postponed"
                  : "Mark canceled"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent data-testid="dialog-delete-game">
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete game #{deleteTarget?.matchNumber}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget
                ? `${deleteTarget.homeName ?? "TBD"} vs ${deleteTarget.awayName ?? "TBD"} will be removed from the schedule for everyone. If the game is just off, mark it postponed or canceled instead — deleting is for games entered in error.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="btn-cancel-delete-game">
              Keep the game
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteTarget) deleteMut.mutate(deleteTarget.id);
              }}
              data-testid="btn-confirm-delete-game"
            >
              Delete game
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

// Task #745 — attach/detach this competition to one of the operator's hubs.
// Re-homed here from the old "My competitions" cards on /app/competitions.
// POST /organizers/:id/competitions { competitionId, attach } — caller must
// manage BOTH sides (server enforces).
interface HubRow {
  id: string;
  name: string;
  slug: string;
}

function HubPanel({
  competitionId,
  organizerId,
}: {
  competitionId: string;
  organizerId: string | null;
}) {
  const [open, setOpen] = useState(true);
  const qc = useQueryClient();
  const { toast } = useToast();
  const organizersQ = useQuery<{ data: HubRow[] }>({
    queryKey: ["my", "organizers"],
    queryFn: () =>
      customFetch<{ data: HubRow[] }>(`/api/v1/my/organizers`, {
        method: "GET",
      }),
  });
  const hubs = organizersQ.data?.data ?? [];
  const currentHub = hubs.find((h) => h.id === organizerId) ?? null;

  const attachMut = useMutation({
    mutationFn: ({ hubId, attach }: { hubId: string; attach: boolean }) =>
      customFetch<{ ok: boolean }>(
        `/api/v1/organizers/${encodeURIComponent(hubId)}/competitions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ competitionId, attach }),
        },
      ),
    onSuccess: (_r, vars) => {
      qc.invalidateQueries({ queryKey: ["my", "competitions"] });
      qc.invalidateQueries({ queryKey: ["my", "organizers"] });
      toast({
        title: vars.attach ? "Attached to hub" : "Detached from hub",
      });
    },
    onError: (err) =>
      toast({
        title: "Couldn't update the hub link",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      }),
  });

  // Nothing to show if the operator has no hubs and this competition is
  // standalone — the sidebar's "New hub" flow covers hub creation.
  if (hubs.length === 0 && !organizerId) return null;

  return (
    <Card data-testid="panel-hub">
      <CollapsibleCardHeader
        icon={<Building2 className="w-4 h-4" />}
        label="Competition hub"
        open={open}
        onToggle={() => setOpen((v) => !v)}
        testId="btn-toggle-hub"
      />
      {open && (
      <CardContent className="space-y-3">
        {currentHub ? (
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-sm">
              Part of{" "}
              <Link href={`/competitions/o/${currentHub.slug}`}>
                <span className="font-bold hover:underline cursor-pointer">
                  {currentHub.name}
                </span>
              </Link>
            </p>
            <Button
              size="sm"
              variant="outline"
              className="font-bold rounded-full"
              disabled={attachMut.isPending}
              onClick={() =>
                attachMut.mutate({ hubId: currentHub.id, attach: false })
              }
              data-testid="btn-detach-hub"
            >
              Detach from hub
            </Button>
          </div>
        ) : organizerId ? (
          <p className="text-sm text-muted-foreground">
            This competition is attached to a hub managed by someone else.
          </p>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Attach this competition to one of your hubs so it shows up on the
              hub's public page.
            </p>
            <div className="flex flex-wrap gap-2">
              {hubs.map((h) => (
                <Button
                  key={h.id}
                  size="sm"
                  variant="outline"
                  className="font-bold rounded-full"
                  disabled={attachMut.isPending}
                  onClick={() => attachMut.mutate({ hubId: h.id, attach: true })}
                  data-testid={`btn-attach-hub-${h.id}`}
                >
                  <Building2 className="w-3.5 h-3.5 mr-1.5" />
                  {h.name}
                </Button>
              ))}
            </div>
          </div>
        )}
      </CardContent>
      )}
    </Card>
  );
}

// First-run "show me around" for the competition console — once per browser,
// the first time an organizer lands here after creating or claiming a
// competition. Same pattern as the org/team tours (localStorage flag; the
// openapi.yaml is locked, so there is no server-side "seen" field).
const COMP_TOUR_KEY = "kinectem:competition-tour-v1";

export default function CompetitionConsolePage() {
  const [, params] = useRoute("/competitions/:id");
  const competitionId = params?.id ?? "";
  const [tourOpen, setTourOpen] = useState(false);

  const tourSteps = useMemo<TourStep[]>(
    () => [
      {
        targetTestId: "link-console-competition-name",
        title: "Your competition console",
        body: (
          <>
            This is where you run everything — details, teams, schedule, and
            branding all live on this page.
          </>
        ),
      },
      {
        targetTestId: "btn-toggle-details",
        title: "Edit the details",
        body: (
          <>
            Update the name, dates, location, and description any time under{" "}
            <strong>Details</strong>.
          </>
        ),
      },
      {
        targetTestId: "btn-toggle-invite-teams",
        title: "Invite teams",
        body: (
          <>
            <strong>Invite teams</strong> gives you a ready-to-send message so
            coaches can claim their spot in your competition.
          </>
        ),
      },
      {
        targetTestId: "btn-toggle-claims",
        title: "Approve team claims",
        body: (
          <>
            When a coach claims a team, the request lands here. Approve it (or
            turn on auto-approve) so their recaps carry your competition's
            badge.
          </>
        ),
      },
      {
        targetTestId: "btn-toggle-schedule",
        title: "Upload your schedule",
        body: (
          <>
            Import your game schedule as a CSV — exports from most scheduling
            tools work as-is. You can also add games one at a time.
          </>
        ),
      },
      {
        targetTestId: "btn-toggle-branding",
        title: "Make it yours",
        body: (
          <>
            Add your logo, banner, and colors under <strong>Branding</strong> —
            they show up on your public page and on every recap.
          </>
        ),
      },
      {
        targetTestId: "btn-view-public",
        title: "See the public page",
        body: (
          <>
            <strong>View public page</strong> shows what families and followers
            see. You can replay this tour any time with{" "}
            <strong>Show me around</strong>.
          </>
        ),
      },
    ],
    [],
  );

  const finishTour = () => {
    try {
      localStorage.setItem(COMP_TOUR_KEY, "1");
    } catch {
      // ignore storage failures (private mode etc.) — tour just won't persist
    }
    setTourOpen(false);
  };

  const listQ = useQuery<{ data: CompetitionRow[] }>({
    queryKey: ["my", "competitions"],
    queryFn: () =>
      customFetch<{ data: CompetitionRow[] }>(`/api/v1/my/competitions`, {
        method: "GET",
      }),
  });

  const row = (listQ.data?.data ?? []).find((c) => c.id === competitionId);

  const detailQ = useQuery<CompetitionDetail>({
    queryKey: ["competition", row?.slug],
    queryFn: () =>
      customFetch<CompetitionDetail>(
        `/api/v1/competitions/${encodeURIComponent(row?.slug ?? "")}`,
        { method: "GET" },
      ),
    enabled: !!row?.slug,
  });

  if (listQ.isLoading) {
    return (
      <div className="max-w-3xl mx-auto space-y-4">
        <Skeleton className="h-24 rounded-xl" />
        <Skeleton className="h-48 rounded-xl" />
      </div>
    );
  }

  if (!row) {
    return (
      <div className="max-w-xl mx-auto">
        <Card>
          <CardContent className="p-8 text-center space-y-3">
            <p className="text-sm text-muted-foreground">
              That competition isn't in your list — it may belong to another
              operator.
            </p>
            <Link href="/competitions">
              <Button variant="outline" className="font-bold rounded-full">
                Back to my competitions
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const detail = detailQ.data?.competition;

  return (
    <ConsoleWithTour
      row={row}
      detail={detail}
      tourOpen={tourOpen}
      setTourOpen={setTourOpen}
      finishTour={finishTour}
      tourSteps={tourSteps}
    />
  );
}

function ConsoleWithTour({
  row,
  detail,
  tourOpen,
  setTourOpen,
  finishTour,
  tourSteps,
}: {
  row: CompetitionRow;
  detail: CompetitionDetail["competition"] | undefined;
  tourOpen: boolean;
  setTourOpen: (v: boolean) => void;
  finishTour: () => void;
  tourSteps: TourStep[];
}) {
  // Open the walkthrough once per browser, the first time the organizer lands
  // on any competition console (only organizers can reach this page — the
  // /my/competitions lookup above already filtered to competitions they run).
  useEffect(() => {
    if (typeof window === "undefined" || !detail) return;
    let alreadySeen = false;
    try {
      alreadySeen = localStorage.getItem(COMP_TOUR_KEY) === "1";
    } catch {
      // storage blocked (private mode etc.) — treat as not seen
    }
    if (!alreadySeen) setTourOpen(true);
  }, [detail, setTourOpen]);

  return (
    <OrganizerSidebar>
      <div className="max-w-3xl mx-auto space-y-6">
      <div className="space-y-2">
        <Link href="/competitions">
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline cursor-pointer">
            <ArrowLeft className="w-3 h-3" /> My competitions
          </span>
        </Link>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Link href={`/competitions/c/${row.slug}`}>
                <h1
                  className="text-2xl font-semibold tracking-tight truncate cursor-pointer hover:underline"
                  data-testid="link-console-competition-name"
                >
                  {row.name}
                </h1>
              </Link>
              <Badge variant="outline" className="capitalize shrink-0">
                {row.type}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              {row.claimedCount}/{row.participantCount} teams claimed ·{" "}
              {row.matchCount} games
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="font-bold rounded-full"
              onClick={() => setTourOpen(true)}
              data-testid="btn-competition-replay-tour"
            >
              <Compass className="w-3.5 h-3.5 mr-1.5" />
              Show me around
            </Button>
            <a
              href={`/app/c/${row.slug}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button
                size="sm"
                variant="outline"
                className="font-bold rounded-full"
                data-testid="btn-view-public"
              >
                <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
                View public page
              </Button>
            </a>
          </div>
        </div>
      </div>

      {/* Compact lifecycle guide right where the organizer does the work —
          collapsed entry point unless nothing has been set up yet. */}
      <CompetitionHowItWorks
        brandColor={detail?.brandColor}
        secondaryColor={detail?.secondaryColor}
        defaultOpen={row.matchCount === 0}
      />

      {detail ? (
        <DetailsPanel detail={detail} competitionId={row.id} />
      ) : (
        <Skeleton className="h-48 rounded-xl" />
      )}
      <InviteTeamsPanel
        name={detail?.name ?? row.name}
        type={detail?.type ?? row.type}
        startDate={detail?.startDate ?? row.startDate}
        endDate={detail?.endDate ?? row.endDate}
        location={detail ? detail.location : row.location}
        autoApproveClaims={detail?.autoApproveClaims ?? row.autoApproveClaims}
        slug={row.slug}
      />
      <ClaimsPanel
        competitionId={row.id}
        autoApproveClaims={detail?.autoApproveClaims ?? row.autoApproveClaims}
      />
      <CurationPanel competitionId={row.id} />
      <GamesPanel competitionId={row.id} slug={row.slug} />
      <SchedulePanel
        competitionId={row.id}
        matchCount={row.matchCount}
        isLeague={row.type === "league"}
      />
      {detail ? (
        <BrandingPanel detail={detail} competitionId={row.id} />
      ) : (
        <Skeleton className="h-48 rounded-xl" />
      )}
      <HubPanel competitionId={row.id} organizerId={row.organizerId} />
      {/* Task #745 — per-competition admin management (any admin can add;
          only the owner can remove). */}
      <CompetitionAdminsPanel kind="competition" targetId={row.id} />
      </div>
      {tourOpen && <SpotlightTour steps={tourSteps} onFinish={finishTour} />}
    </OrganizerSidebar>
  );
}
