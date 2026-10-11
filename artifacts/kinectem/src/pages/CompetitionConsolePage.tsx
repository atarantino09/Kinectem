import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CompetitionAlbumConsolePanel } from "@/components/competition-album/CompetitionAlbumConsolePanel";
import { Link, useLocation, useRoute, useSearch } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { BrandColorField } from "@/components/BrandColorField";
import { BrandColorSwapButton } from "@/components/BrandColorSwapButton";
import { BrandImageField } from "@/components/BrandImageField";
import { CompetitionAdminsPanel } from "@/components/CompetitionAdminsPanel";
import { CompetitionPartnerPagesPanel } from "@/components/CompetitionPartnerPagesPanel";
import { CompetitionHowItWorks } from "@/components/CompetitionHowItWorks";
import { CompetitionReferralReport } from "@/components/CompetitionReferralReport";
import { readCompetitionScheduleFile } from "@/lib/competition-schedule-file";
import {
  CompetitionClaimBanner,
  useClaimTokenParams,
  useCompetitionClaimResolve,
} from "@/components/ClaimTokenBanner";
import { OrganizerSidebar } from "@/components/OrganizerSidebar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import {
  buildCompetitionInviteMessage,
  resolveEffectivePromoCode,
} from "@/lib/competition-invite-message";
import { PLANS } from "@/lib/plans";
import {
  SpotlightTour,
  type TourStep,
} from "@/components/team-page/SpotlightTour";
import {
  competitionWeekForDate,
  formatCompetitionWeek,
  type CompetitionWeek,
} from "@/lib/competition-weeks";
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
  Gift,
  Megaphone,
  Building2,
  CalendarDays,
  CalendarX,
  ChevronDown,
  Plus,
  Trash2,
  ListOrdered,
} from "lucide-react";
import {
  compareBracketsByGenderAge,
  genderInfo,
  ageGroupInfo,
  teamNameCollator,
} from "./CompetitionPage";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
// claim-approval queue, and schedule CSV upload. Owners, competition/hub
// admins, and platform admins can operate it (server enforces). customFetch —
// these routes are outside the locked openapi.yaml.

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
    // Task #818 — admin-only fields (server includes them only for managers).
    promoCode?: string | null;
    organizer?: { promoCode?: string | null } | null;
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
// Task #865 — division (group) is now required: every game row must carry a
// group value so the Teams page is organized from the first upload. A file
// whose only group column is named "bracket"/"round"/"pod" also counts.
const REQUIRED_COLUMNS = [
  "match #",
  "date",
  "home team",
  "away team",
  "division",
];
const OPTIONAL_COLUMNS = [
  "start time",
  "age",
  "gender",
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
  addedCount?: number;
  changedCount?: number;
  renumberWarningCount?: number;
  missingFromFileCount?: number;
  rowWarningCount?: number;
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

// Task #780 — shared type-to-confirm dialog for the destructive "clear all"
// actions. The organizer must type the competition's exact name (server
// re-checks, so this is UX guardrail + API contract in one).
function ClearAllDialog({
  open,
  onOpenChange,
  title,
  description,
  competitionName,
  confirmLabel,
  pending,
  onConfirm,
  testId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description: ReactNode;
  competitionName: string;
  confirmLabel: string;
  pending: boolean;
  onConfirm: (confirm: string) => void;
  testId: string;
}) {
  const [confirm, setConfirm] = useState("");
  useEffect(() => {
    if (!open) setConfirm("");
  }, [open]);
  const matches =
    confirm.trim().replace(/\s+/g, " ").toLowerCase() ===
    competitionName.trim().replace(/\s+/g, " ").toLowerCase();
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent data-testid={testId}>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">{description}</div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor={`${testId}-confirm`} className="text-xs font-bold">
            Type the competition name to confirm
          </Label>
          <Input
            id={`${testId}-confirm`}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder={competitionName}
            data-testid={`${testId}-input`}
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid={`${testId}-cancel`}>
            Never mind
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={!matches || pending}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={(e) => {
              e.preventDefault();
              onConfirm(confirm);
            }}
            data-testid={`${testId}-confirm-btn`}
          >
            {pending ? "Clearing…" : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// Task #846 — danger zone: delete the whole competition. Reuses the
// type-to-confirm ClearAllDialog contract; the server (operator-gated)
// cascades matches/teams/followers/invites and unlinks recaps (kept).
function DangerZonePanel({
  competitionId,
  competitionName,
}: {
  competitionId: string;
  competitionName: string;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();

  const del = useMutation({
    mutationFn: (confirm: string) =>
      customFetch<{
        ok: true;
        gamesDeleted: number;
        teamsRemoved: number;
        recapsUnlinked: number;
      }>(`/api/v1/competitions/${competitionId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm }),
      }),
    onSuccess: (r) => {
      setConfirmOpen(false);
      qc.invalidateQueries({ queryKey: ["my", "competitions"] });
      qc.invalidateQueries({ queryKey: ["my", "organizers"] });
      qc.invalidateQueries({ queryKey: ["competition"] });
      toast({
        title: "Competition deleted",
        description: `${r.gamesDeleted} game${r.gamesDeleted === 1 ? "" : "s"} and ${r.teamsRemoved} team slot${r.teamsRemoved === 1 ? "" : "s"} removed · ${r.recapsUnlinked} recap${r.recapsUnlinked === 1 ? "" : "s"} kept (unlinked).`,
      });
      navigate("/competitions");
    },
    onError: (err) =>
      toast({
        title: "Couldn't delete the competition",
        description:
          err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      }),
  });

  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base text-destructive">
          <Trash2 className="w-4 h-4" />
          Danger zone
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col sm:flex-row sm:items-center gap-3">
        <p className="text-sm text-muted-foreground flex-1">
          Delete this competition permanently — its schedule, team slots,
          followers, and invites are removed. Published recaps are kept; they
          just lose their link to this competition.
        </p>
        <Button
          variant="outline"
          className="font-bold border-destructive/50 text-destructive hover:bg-destructive hover:text-destructive-foreground shrink-0"
          onClick={() => setConfirmOpen(true)}
          data-testid="btn-delete-competition"
        >
          <Trash2 className="w-3.5 h-3.5 mr-1.5" />
          Delete competition
        </Button>
      </CardContent>
      <ClearAllDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Delete "${competitionName}"?`}
        description={
          <>
            <p>
              This permanently removes the competition and everything attached
              to it:{" "}
              <span className="font-bold text-foreground">
                all games, team slots, followers, and pending invites
              </span>
              . This can't be undone.
            </p>
            <p>
              <span className="font-bold text-foreground">
                Game recaps are NOT deleted
              </span>{" "}
              — they stay on their team pages, but their link to this
              competition is cleared.
            </p>
          </>
        }
        competitionName={competitionName}
        confirmLabel="Delete forever"
        pending={del.isPending}
        onConfirm={(confirm) => del.mutate(confirm)}
        testId="dialog-delete-competition"
      />
    </Card>
  );
}

function DetailsPanel({
  detail,
  competitionId,
  preview = false,
}: {
  detail: CompetitionDetail["competition"];
  competitionId: string;
  preview?: boolean;
}) {
  const [open, setOpen] = useState(preview);
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
  preview = false,
}: {
  detail: CompetitionDetail["competition"];
  competitionId: string;
  preview?: boolean;
}) {
  const [open, setOpen] = useState(preview);
  const qc = useQueryClient();
  const { toast } = useToast();
  const [brandColor, setBrandColor] = useState(detail.brandColor ?? "");
  const [secondaryColor, setSecondaryColor] = useState(
    detail.secondaryColor ?? "",
  );
  const [tertiaryColor, setTertiaryColor] = useState(detail.tertiaryColor ?? "");
  const [logoUrl, setLogoUrl] = useState(detail.logoUrl ?? "");
  const [websiteUrl, setWebsiteUrl] = useState(detail.websiteUrl ?? "");

  useEffect(() => {
    setBrandColor(detail.brandColor ?? "");
    setSecondaryColor(detail.secondaryColor ?? "");
    setTertiaryColor(detail.tertiaryColor ?? "");
    setLogoUrl(detail.logoUrl ?? "");
    setWebsiteUrl(detail.websiteUrl ?? "");
  }, [
    detail.brandColor,
    detail.secondaryColor,
    detail.tertiaryColor,
    detail.logoUrl,
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
          <div className="flex items-end">
            <BrandColorSwapButton
              testId="btn-swap-console-brand-colors"
              onSwap={() => {
                const currentPrimary = brandColor;
                setBrandColor(secondaryColor);
                setSecondaryColor(currentPrimary);
              }}
            />
          </div>
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
  promoCode,
  preview = false,
}: {
  name: string;
  type: "tournament" | "league";
  startDate: string;
  endDate: string;
  location: string | null;
  autoApproveClaims: boolean;
  slug: string;
  promoCode: string | null;
  preview?: boolean;
}) {
  const [open, setOpen] = useState(preview);
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
    promoCode,
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
        <p
          className="rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground"
          data-testid="text-invite-timing-tip"
        >
          <span className="font-bold text-foreground">
            Best time to send:
          </span>{" "}
          right after you upload your schedule. Coaches can claim their teams
          in about two minutes and see their games instantly — one quick send
          and you're done.
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

// Task #788 — promo referral program: informational only (no tracking or
// automated sends). Pricing figures are derived from the shared PLANS
// catalog so they can never drift from the pricing page.
const REFERRAL_DISCOUNT = 0.25; // new orgs get 25% off
const REFERRAL_COMMISSION = 0.15; // competition earns 15% of what they pay
// 10-org example mix used in the earnings illustration.
const REFERRAL_EXAMPLE_MIX: Record<string, number> = {
  starter: 3,
  pro: 4,
  elite: 3,
};

// Prices in this section can have cents (e.g. $112.50), unlike the
// whole-dollar plan catalog, so format with cents only when needed.
function formatUsdExact(amount: number): string {
  const hasCents = Math.round(amount * 100) % 100 !== 0;
  return `$${amount.toLocaleString("en-US", {
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: 2,
  })}`;
}

function buildPromoReferralMessage(
  competitionName: string,
  promoCode: string | null,
): string {
  const cheapest = PLANS.reduce((a, b) =>
    b.priceYearly < a.priceYearly ? b : a,
  );
  const discounted = cheapest.priceYearly * (1 - REFERRAL_DISCOUNT);
  // Build an absolute deep link that opens signup and, on completion, lands
  // the new user in the org-creation wizard — matches the pattern used by
  // other invite/share links throughout the app.
  const base = (typeof window !== "undefined" ? window.location.origin : "") +
    import.meta.env.BASE_URL.replace(/\/$/, "");
  const returnTo = encodeURIComponent("/organizations/mine?new=1");
  const signupLink = `${base}/login?signup=1&returnTo=${returnTo}`;
  return `Subject: Get your club on Kinectem before ${competitionName}

Hi coaches and club directors,

${competitionName} is on Kinectem — and we'd love to have your teams join us there too.

In case you haven't heard of Kinectem: it's the youth-sports platform where the story of your season comes to life. Your club gets its own team pages — schedules, photo albums, and written game recaps that capture the moments families don't want to miss — all built around safe, COPPA-compliant profiles for players and parents.

Here's the part that matters most. Every game recap your coaches write automatically tags all rostered players, so the story doesn't just sit on the team page — it lands on every player's page too. And because your coaches are the ones telling it, a game recap captures the things a final score leaves out: the hustle play nobody in the stands noticed, the defensive stop that swung the game, the player who came off the bench and changed the energy, the kid who shook off a mistake and kept going. Not just the same few players who fill up the stat sheet every week. Season after season, that collection grows into the complete story of your teams and every athlete on them — their whole journey, in your club's own words.

The lift is lighter than you'd expect. Upload your rosters once, then coaches use AI Assist inside the game recap composer to turn a few quick notes into a polished game story in a couple of minutes.

You don't have to wait on us to get started. When we publish the ${competitionName} schedule on Kinectem, your games with us land directly on your team pages. But if your club isn't on Kinectem yet, you can get set up today and start using it right away for whatever your next games are — so by the time our schedule goes live, your pages are already filling up and your season carries straight through without a break in the story.

Pricing is simple: one flat annual price for your whole club, set by how many teams you have. Never per player. Parents and players are always free — no family ever gets a bill. Plans start at ${formatUsdExact(cheapest.priceYearly)}/year.

And as a club playing with us, you get both:

• 90 days free — your card isn't charged until day 90, and you can cancel anytime before then at no cost.
• 25% off your first year with our promo code. On the ${formatUsdExact(cheapest.priceYearly)} plan, that's ${formatUsdExact(discounted)} for the year, charged when your free period ends.

Here's how to claim it:
1. Create your organization here — ${signupLink} — your 90 free days start right away.
2. Pick the plan that fits your club's size.
3. Enter promo code ${promoCode ?? "[YOUR PROMO CODE]"} at checkout. The 25% comes off automatically.

Questions? Reach out to competitions@kinectem.com — they're happy to walk you through it.

Thanks,
The ${competitionName} team`;
}

function PromoReferralPanel({
  competitionId,
  competitionName,
  promoCode,
  hubPromoCode,
  preview = false,
}: {
  competitionId: string;
  competitionName: string;
  promoCode: string | null;
  hubPromoCode: string | null;
  preview?: boolean;
}) {
  const [open, setOpen] = useState(preview);
  const qc = useQueryClient();
  const { toast } = useToast();

  // Task #818 — per-competition code override; blank falls back to the hub's.
  const [codeInput, setCodeInput] = useState(promoCode ?? "");
  useEffect(() => setCodeInput(promoCode ?? ""), [promoCode]);
  const effectiveCode = resolveEffectivePromoCode(promoCode, hubPromoCode);

  const saveCode = useMutation({
    mutationFn: () =>
      customFetch(`/api/v1/competitions/${competitionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ promoCode: codeInput.trim() || null }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["competition"] });
      toast({ title: "Promo code saved" });
    },
    onError: (err) =>
      toast({
        title: "Couldn't save the promo code",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      }),
  });

  const rows = PLANS.map((plan) => {
    const discounted = plan.priceYearly * (1 - REFERRAL_DISCOUNT);
    const commission = discounted * REFERRAL_COMMISSION;
    return { plan, discounted, commission };
  });
  const exampleTotal = rows.reduce(
    (sum, r) => sum + r.commission * (REFERRAL_EXAMPLE_MIX[r.plan.id] ?? 0),
    0,
  );
  const exampleCount = Object.values(REFERRAL_EXAMPLE_MIX).reduce(
    (a, b) => a + b,
    0,
  );
  const exampleMixLabel = rows
    .map((r) => `${REFERRAL_EXAMPLE_MIX[r.plan.id] ?? 0} ${r.plan.name}`)
    .join(" + ");

  const message = buildPromoReferralMessage(competitionName, effectiveCode);

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
        icon={<Gift className="w-4 h-4" />}
        label="FREE2027 referrals & commissions"
        open={open}
        onToggle={() => setOpen((v) => !v)}
        testId="btn-toggle-promo-referral"
      />
      {open && (
      <CardContent className="space-y-4">
        <CompetitionReferralReport competitionId={competitionId} preview={preview} />
        <details className="rounded-lg border p-3">
          <summary className="cursor-pointer text-sm font-semibold">Other promo codes — separate 25% discount offer</summary>
          <div className="space-y-4 mt-4">
        <p className="text-sm text-muted-foreground">
          Share your competition's promo code with the teams and clubs in your
          event. New organizations that sign up with your code get{" "}
          <span className="font-bold text-foreground">
            25% off their first year on Kinectem
          </span>{" "}
          (renewals bill at full price), and your competition earns a{" "}
          <span className="font-bold text-foreground">15% commission</span> on
          what those new clubs pay.
        </p>
        <p
          className="rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground"
          data-testid="text-promo-timing-tip"
        >
          <span className="font-bold text-foreground">
            Best time to send:
          </span>{" "}
          at least 7 days before your event starts. That gives clubs plenty of
          time to sign up with your code before game day — one quick message
          now and the commissions take care of themselves.
        </p>

        <div className="overflow-x-auto">
          <table
            className="w-full text-sm"
            data-testid="table-promo-earnings"
          >
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="py-2 pr-3 font-bold">Plan</th>
                <th className="py-2 pr-3 font-bold">List price</th>
                <th className="py-2 pr-3 font-bold">
                  Year 1 price (25% off)
                </th>
                <th className="py-2 font-bold">You earn (15%)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ plan, discounted, commission }) => (
                <tr
                  key={plan.id}
                  className="border-b border-border/60"
                  data-testid={`row-promo-earnings-${plan.id}`}
                >
                  <td className="py-2 pr-3 font-bold">{plan.name}</td>
                  <td className="py-2 pr-3">
                    {formatUsdExact(plan.priceYearly)}/yr
                  </td>
                  <td className="py-2 pr-3">{formatUsdExact(discounted)}</td>
                  <td className="py-2 font-bold">
                    {formatUsdExact(commission)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div
          className="rounded-lg border border-border bg-muted/40 p-3 text-sm"
          data-testid="text-promo-example"
        >
          <span className="font-bold">Example:</span> bring {exampleCount} new
          organizations onto Kinectem ({exampleMixLabel}) and your competition
          earns{" "}
          <span className="font-bold">{formatUsdExact(exampleTotal)}</span>.
        </div>

        {/* Task #818 — save a per-competition code; blank uses the hub's. */}
        <div className="space-y-1.5">
          <Label htmlFor="promo-code" className="text-xs font-bold">
            Your promo code{" "}
            <span className="font-normal text-muted-foreground">
              (if you have one)
            </span>
          </Label>
          <div className="flex gap-2">
            <Input
              id="promo-code"
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value)}
              maxLength={64}
              placeholder={
                hubPromoCode
                  ? `Uses your hub's code (${hubPromoCode}) when empty`
                  : "e.g. SUMMERCUP25"
              }
              data-testid="input-competition-promo-code"
            />
            <Button
              variant="brand"
              onClick={() => saveCode.mutate()}
              disabled={saveCode.isPending || codeInput.trim() === (promoCode ?? "")}
              data-testid="btn-save-competition-promo-code"
            >
              {saveCode.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
          {hubPromoCode ? (
            <p className="text-xs text-muted-foreground">
              Leave this blank to use your hub's code ({hubPromoCode}).
            </p>
          ) : null}
        </div>

        {!effectiveCode ? (
          <p
            className="rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground"
            data-testid="text-promo-add-code-prompt"
          >
            <span className="font-bold text-foreground">
              No promo code saved yet.
            </span>{" "}
            Add your code above (or on your hub page) and it will be filled
            into the message below automatically.
          </p>
        ) : null}

        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            {effectiveCode ? (
              <>
                Copy this ready-made message — your promo code (
                <span className="font-bold text-foreground">
                  {effectiveCode}
                </span>
                ) is already filled in — and send it to the teams and clubs in
                your competition.
              </>
            ) : (
              <>
                Copy this ready-made message, swap in your promo code, and send
                it to the teams and clubs in your competition.
              </>
            )}
          </p>
          <pre
            className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-muted/40 p-3 font-sans text-xs leading-relaxed text-foreground [overflow-wrap:anywhere]"
            data-testid="text-promo-message"
          >
            {message}
          </pre>
          <Button
            variant="brand"
            onClick={copyMessage}
            data-testid="btn-copy-promo-message"
          >
            <Copy className="w-3.5 h-3.5 mr-1.5" />
            Copy message
          </Button>
        </div>

        <p
          className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm"
          data-testid="text-promo-no-code"
        >
          <span className="font-bold">Don't have a promo code yet?</span> Email{" "}
          <a
            href="mailto:competitions@kinectem.com"
            className="font-bold text-primary underline underline-offset-2"
            data-testid="link-promo-email"
          >
            competitions@kinectem.com
          </a>{" "}
          and we'll create a custom code for your competition.
        </p>
          </div>
        </details>
      </CardContent>
      )}
    </Card>
  );
}

function ClaimsPanel({
  competitionId,
  autoApproveClaims,
  competitionName,
  participantCount,
  claimedCount,
  preview = false,
}: {
  competitionId: string;
  autoApproveClaims: boolean;
  competitionName: string;
  participantCount: number;
  claimedCount: number;
  preview?: boolean;
}) {
  const [open, setOpen] = useState(preview);
  const [clearOpen, setClearOpen] = useState(false);
  const qc = useQueryClient();
  const { toast } = useToast();

  // Task #780 — wipe every team slot (claimed teams are unlinked, never
  // deleted) plus any games that reference them.
  const clearTeams = useMutation({
    mutationFn: (confirm: string) =>
      customFetch<{
        teamsRemoved: number;
        claimedUnlinked: number;
        gamesDeleted: number;
      }>(`/api/v1/competitions/${competitionId}/clear-teams`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm }),
      }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["competition"] });
      qc.invalidateQueries({ queryKey: ["my", "competitions"] });
      qc.invalidateQueries({
        queryKey: ["competition", competitionId, "pending-claims"],
      });
      setClearOpen(false);
      toast({
        title: `Removed ${r.teamsRemoved} team${r.teamsRemoved === 1 ? "" : "s"}`,
        description: `${r.claimedUnlinked} claimed team${r.claimedUnlinked === 1 ? " was" : "s were"} unlinked (not deleted) · ${r.gamesDeleted} game${r.gamesDeleted === 1 ? "" : "s"} referencing them removed.`,
      });
    },
    onError: (err) =>
      toast({
        title: "Couldn't clear the teams",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      }),
  });

  const pendingQ = useQuery<{ data: PendingClaim[] }>({
    queryKey: ["competition", competitionId, "pending-claims"],
    queryFn: () =>
      customFetch<{ data: PendingClaim[] }>(
        `/api/v1/competitions/${competitionId}/claims/pending`,
        { method: "GET" },
      ),
    // Owner-only endpoint — skip it in claim preview (would 401).
    enabled: !preview,
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
        actions={
          participantCount > 0 ? (
            <Button
              size="sm"
              variant="ghost"
              className="font-bold text-muted-foreground hover:text-destructive"
              onClick={() => setClearOpen(true)}
              data-testid="btn-clear-all-teams"
            >
              <Trash2 className="w-3.5 h-3.5 mr-1" />
              Clear all teams
            </Button>
          ) : undefined
        }
      />
      <ClearAllDialog
        open={clearOpen}
        onOpenChange={setClearOpen}
        title={`Clear all ${participantCount} teams?`}
        description={
          <>
            <p>
              Every team slot in this competition will be removed — and because
              games reference those slots,{" "}
              <span className="font-bold text-foreground">
                every game with a team on it is removed too
              </span>
              . This can't be undone; you'll start over with a fresh CSV
              import.
            </p>
            {claimedCount > 0 ? (
              <p>
                <span className="font-bold text-foreground">
                  {claimedCount} slot{claimedCount === 1 ? " is" : "s are"}{" "}
                  claimed by real teams.
                </span>{" "}
                Those teams are never deleted — they're just unlinked from this
                competition and would need to claim their spot again.
              </p>
            ) : null}
            <p>Recap posts survive with their competition badge intact.</p>
          </>
        }
        competitionName={competitionName}
        confirmLabel="Clear all teams"
        pending={clearTeams.isPending}
        onConfirm={(c) => clearTeams.mutate(c)}
        testId="dialog-clear-all-teams"
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

// ---------------------------------------------------------------------------
// Task #852 — Brackets panel: organizer-defined labels for sorting recaps.
// Auto-seeded from the schedule import's division/bracket column (the GET
// below also lazily backfills from an already-imported schedule); fully
// editable, deletable, and drag-reorderable. The saved order is canonical
// everywhere (composer dropdown, curation dropdown, public filter).
// ---------------------------------------------------------------------------

export interface CompetitionBracket {
  id: string;
  label: string;
  gender: string | null;
  ageGroup: string | null;
  sortOrder: number;
}

const BRACKET_GENDERS = ["Boys", "Girls", "Coed"] as const;

// hint: Logic changed on both sides. Requires understanding intent of each change.
function BracketsPanel({
  competitionId,
  preview = false,
}: {
  competitionId: string;
  preview?: boolean;
}) {
  const [open, setOpen] = useState(preview);
  const qc = useQueryClient();
  const { toast } = useToast();

  interface UnassignedGroup {
    age: string | null;
    gender: string | null;
    count: number;
  }
  const bracketsQ = useQuery<{
    data: CompetitionBracket[];
    unassignedGroups: UnassignedGroup[];
  }>({
    queryKey: ["competition", competitionId, "brackets"],
    queryFn: () =>
      customFetch<{ data: CompetitionBracket[]; unassignedGroups: UnassignedGroup[] }>(
        `/api/v1/competitions/${competitionId}/brackets`,
        { method: "GET" },
      ),
    enabled: !preview,
  });
  const brackets = bracketsQ.data?.data ?? [];
  const unassignedGroups = bracketsQ.data?.unassignedGroups ?? [];

  const sortedBrackets = [...brackets].sort((a, b) =>
    compareBracketsByGenderAge(
      { gender: genderInfo(a.gender), age: ageGroupInfo(a.ageGroup) },
      { gender: genderInfo(b.gender), age: ageGroupInfo(b.ageGroup) },
    ) || teamNameCollator.compare(a.label, b.label),
  );

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["competition", competitionId, "brackets"] });
    qc.invalidateQueries({ queryKey: ["competition"] });
  };
  const onError = (title: string) => (err: unknown) =>
    toast({
      title,
      description: err instanceof Error ? err.message : undefined,
      variant: "destructive",
    });

  // Add form
  const [newLabel, setNewLabel] = useState("");
  const [newGender, setNewGender] = useState("");
  const [newAge, setNewAge] = useState("");
  const create = useMutation({
    mutationFn: () =>
      customFetch(`/api/v1/competitions/${competitionId}/brackets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: newLabel.trim(),
          gender: newGender || null,
          ageGroup: newAge.trim() || null,
        }),
      }),
    onSuccess: () => {
      setNewLabel("");
      setNewGender("");
      setNewAge("");
      invalidate();
    },
    onError: onError("Couldn't add that bracket"),
  });

  // "Name this group" — for participant groups pulled from the schedule that
  // have no division/bracket string (the admin sees them on the public page
  // but couldn't rename them from here before). The POST endpoint links all
  // matching participants by exact raw age+gender when the bracket is created.
  //
  // We keep the original raw age/gender from the DB separate from the
  // user-editable label/ageGroup/gender fields. The raw values are sent as
  // linkSourceAge/linkSourceGender so the server can build exact SQL predicates
  // (no normalization, no wildcards). This prevents a generic bracket create
  // from accidentally linking the wrong unnamed groups.
  const [namingGroupKey, setNamingGroupKey] = useState<string | null>(null);
  // Raw source values from the DB — immutable target for server-side linking.
  const [namingSourceAge, setNamingSourceAge] = useState<string | null>(null);
  const [namingSourceGender, setNamingSourceGender] = useState<string | null>(null);
  const [nameLabel, setNameLabel] = useState("");
  const [nameGender, setNameGender] = useState("");
  const [nameAge, setNameAge] = useState("");
  function startNaming(g: { age: string | null; gender: string | null }) {
    const rawGender = g.gender ?? "";
    const normalized = ["boys", "boy", "b", "m", "male", "men"].includes(
      rawGender.toLowerCase(),
    )
      ? "Boys"
      : ["girls", "girl", "g", "f", "female", "women"].includes(rawGender.toLowerCase())
        ? "Girls"
        : ["coed", "co-ed", "mixed", "x"].includes(rawGender.toLowerCase())
          ? "Coed"
          : (rawGender
            ? rawGender.charAt(0).toUpperCase() + rawGender.slice(1).toLowerCase()
            : "");
    const age = g.age ?? "";
    const defaultLabel = [age, BRACKET_GENDERS.includes(normalized as typeof BRACKET_GENDERS[number]) ? normalized : ""].filter(Boolean).join(" ");
    setNamingGroupKey(JSON.stringify([g.age, g.gender]));
    // Store exact raw DB values as the immutable linking target.
    setNamingSourceAge(g.age);
    setNamingSourceGender(g.gender);
    setNameLabel(defaultLabel || age || normalized);
    setNameGender(BRACKET_GENDERS.includes(normalized as typeof BRACKET_GENDERS[number]) ? normalized : "");
    setNameAge(age);
  }
  const nameGroup = useMutation({
    mutationFn: () =>
      customFetch(`/api/v1/competitions/${competitionId}/brackets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: nameLabel.trim(),
          gender: nameGender || null,
          ageGroup: nameAge.trim() || null,
          // Exact raw values from the DB — the server uses these to build
          // exact SQL predicates against tournament_participants. Using
          // linkSourceAge/linkSourceGender (not the edited ageGroup/gender
          // above) ensures only the correct group's rows are linked.
          linkSourceAge: namingSourceAge,
          linkSourceGender: namingSourceGender,
        }),
      }),
    onSuccess: () => {
      setNamingGroupKey(null);
      setNamingSourceAge(null);
      setNamingSourceGender(null);
      invalidate();
      // Also refresh the public competition page participant list so the
      // renamed group appears immediately without a full page reload.
      qc.invalidateQueries({ queryKey: ["competition", competitionId] });
    },
    onError: onError("Couldn't name that group"),
  });

  // Inline edit
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editGender, setEditGender] = useState("");
  const [editAge, setEditAge] = useState("");
  const startEdit = (b: CompetitionBracket) => {
    setEditingId(b.id);
    setEditLabel(b.label);
    setEditGender(b.gender ?? "");
    setEditAge(b.ageGroup ?? "");
  };
  const update = useMutation({
    mutationFn: (id: string) =>
      customFetch(`/api/v1/competitions/${competitionId}/brackets/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: editLabel.trim(),
          gender: editGender || null,
          ageGroup: editAge.trim() || null,
        }),
      }),
    onSuccess: () => {
      setEditingId(null);
      invalidate();
    },
    onError: onError("Couldn't save that bracket"),
  });

  const remove = useMutation({
    mutationFn: (id: string) =>
      customFetch(`/api/v1/competitions/${competitionId}/brackets/${id}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      invalidate();
      toast({
        title: "Bracket deleted",
        description: "Recaps that used it keep everything else — they just show under All.",
      });
    },
    onError: onError("Couldn't delete that bracket"),
  });

  return (
    <Card>
      <CollapsibleCardHeader
        icon={<ListOrdered className="w-4 h-4" />}
        label={`Brackets${brackets.length > 0 ? ` (${brackets.length})` : ""}`}
        open={open}
        onToggle={() => setOpen((v) => !v)}
        testId="btn-toggle-brackets"
      />
      {open && (
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Brackets are labels for sorting incoming recaps (they never change
            how a published recap looks). They're picked up automatically from
            your schedule's division/bracket column — add or edit them any way
            you like. Brackets are always displayed Boys first, then Girls, then
            Coed, ordered youngest to oldest within each gender.
          </p>
          <div className="space-y-2 rounded-lg border border-border/60 bg-muted/30 p-3">
            <p className="text-xs font-black uppercase tracking-widest text-muted-foreground">
              Add a bracket
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              <Input
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                className="h-8 w-44"
                placeholder="New bracket name"
                data-testid="input-new-bracket-label"
              />
              <Select
                value={newGender || "none"}
                onValueChange={(v) => setNewGender(v === "none" ? "" : v)}
              >
                <SelectTrigger
                  className="h-8 w-28"
                  data-testid="select-new-bracket-gender"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No gender</SelectItem>
                  {BRACKET_GENDERS.map((g) => (
                    <SelectItem key={g} value={g}>
                      {g}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                value={newAge}
                onChange={(e) => setNewAge(e.target.value)}
                className="h-8 w-24"
                placeholder="Age (U14)"
                data-testid="input-new-bracket-age"
              />
              <Button
                size="sm"
                variant="brand"
                disabled={create.isPending || newLabel.trim() === ""}
                onClick={() => create.mutate()}
                data-testid="btn-add-bracket"
              >
                <Plus className="w-3.5 h-3.5 mr-1" />
                Add bracket
              </Button>
            </div>
          </div>
          {bracketsQ.isLoading && !preview ? (
            <Skeleton className="h-16 rounded-lg" />
          ) : brackets.length === 0 && unassignedGroups.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="text-no-brackets">
              No brackets yet — import a schedule with a division column, or
              add one above.
            </p>
          ) : brackets.length > 0 ? (
            <>
              <p className="pt-1 text-xs font-black uppercase tracking-widest text-muted-foreground">
                Current brackets
              </p>
              <div className="space-y-1.5" data-testid="list-brackets">
                {sortedBrackets.map((b) => (
                <div
                  key={b.id}
                  className="rounded-lg border border-border px-2 py-1.5"
                  data-testid={`row-bracket-${b.id}`}
                >
                  {editingId === b.id ? (
                    <div className="flex items-center gap-2 flex-wrap">
                      <Input
                        value={editLabel}
                        onChange={(e) => setEditLabel(e.target.value)}
                        className="h-8 w-44"
                        placeholder="Bracket name"
                        data-testid="input-edit-bracket-label"
                      />
                      <Select value={editGender || "none"} onValueChange={(v) => setEditGender(v === "none" ? "" : v)}>
                        <SelectTrigger className="h-8 w-28" data-testid="select-edit-bracket-gender">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">No gender</SelectItem>
                          {BRACKET_GENDERS.map((g) => (
                            <SelectItem key={g} value={g}>{g}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input
                        value={editAge}
                        onChange={(e) => setEditAge(e.target.value)}
                        className="h-8 w-24"
                        placeholder="Age (U14)"
                        data-testid="input-edit-bracket-age"
                      />
                      <Button
                        size="sm"
                        variant="brand"
                        disabled={update.isPending || editLabel.trim() === ""}
                        onClick={() => update.mutate(b.id)}
                        data-testid="btn-save-bracket"
                      >
                        Save
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold truncate">{b.label}</span>
                      {b.gender && (
                        <Badge variant="secondary" className="shrink-0">{b.gender}</Badge>
                      )}
                      {b.ageGroup && (
                        <Badge variant="outline" className="shrink-0">{b.ageGroup}</Badge>
                      )}
                      <span className="flex-1" />
                      <Button
                        size="sm"
                        variant="ghost"
                        className="font-bold text-muted-foreground"
                        onClick={() => startEdit(b)}
                        data-testid={`btn-edit-bracket-${b.id}`}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="font-bold text-muted-foreground hover:text-destructive"
                        disabled={remove.isPending}
                        onClick={() => remove.mutate(b.id)}
                        data-testid={`btn-delete-bracket-${b.id}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  )}
                </div>
                ))}
              </div>
            </>
          ) : null}

          {/* ── Unassigned groups — participant groups from the schedule that
              have no division/bracket string and no bracket assignment yet.
              Naming one creates a bracket AND immediately links all matching
              participants so the public Teams list reflects the new name. ── */}
          {unassignedGroups.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
                Groups without a name
              </p>
              {unassignedGroups.map((g) => {
                const groupKey = JSON.stringify([g.age, g.gender]);
                const isNaming = namingGroupKey === groupKey;
                const displayAge = g.age ?? "Unknown age";
                const displayGender = g.gender
                  ? g.gender.charAt(0).toUpperCase() + g.gender.slice(1).toLowerCase()
                  : "Unknown gender";
                return (
                  <div
                    key={groupKey}
                    className="rounded-lg border border-dashed border-border px-2 py-1.5"
                    data-testid={`row-unassigned-group-${groupKey}`}
                  >
                    {isNaming ? (
                      <div className="flex items-center gap-2 flex-wrap">
                        <Input
                          value={nameLabel}
                          onChange={(e) => setNameLabel(e.target.value)}
                          className="h-8 w-44"
                          placeholder="Group name"
                          autoFocus
                          data-testid="input-name-group-label"
                        />
                        <Select
                          value={nameGender || "none"}
                          onValueChange={(v) => setNameGender(v === "none" ? "" : v)}
                        >
                          <SelectTrigger className="h-8 w-28" data-testid="select-name-group-gender">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">No gender</SelectItem>
                            {BRACKET_GENDERS.map((gv) => (
                              <SelectItem key={gv} value={gv}>{gv}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Input
                          value={nameAge}
                          onChange={(e) => setNameAge(e.target.value)}
                          className="h-8 w-24"
                          placeholder="Age (U14)"
                          data-testid="input-name-group-age"
                        />
                        <Button
                          size="sm"
                          variant="brand"
                          disabled={nameGroup.isPending || nameLabel.trim() === ""}
                          onClick={() => nameGroup.mutate()}
                          data-testid="btn-save-group-name"
                        >
                          Save
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setNamingGroupKey(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-muted-foreground truncate">
                          {displayAge} · {displayGender}
                        </span>
                        <span className="text-xs text-muted-foreground/70">
                          ({g.count} {g.count === 1 ? "team" : "teams"})
                        </span>
                        <span className="flex-1" />
                        <Button
                          size="sm"
                          variant="outline"
                          className="font-bold text-xs"
                          onClick={() => startNaming(g)}
                          data-testid={`btn-name-group-${groupKey}`}
                        >
                          Name this group
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

        </CardContent>
      )}
    </Card>
  );
}
interface CurationRecap {
  id: string;
  postId: string;
  reviewState: "pending" | "reviewed" | "featured";
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
  bracketId: string | null;
  createdAt: string;
  effectiveGameDate: string | null;
  groupDivision: string | null;
  groupBracket: string | null;
  groupingSource: "competition-game" | "recap";
  week: CompetitionWeek | null;
}

function recapWeekSections(recaps: CurationRecap[]) {
  const grouped = new Map<
    string,
    { key: string; week: CompetitionWeek | null; recaps: CurationRecap[] }
  >();
  for (const recap of recaps) {
    const week = recap.week ?? competitionWeekForDate(recap.effectiveGameDate);
    const key = week?.key ?? "__undated__";
    const current = grouped.get(key) ?? { key, week, recaps: [] };
    current.recaps.push(recap);
    grouped.set(key, current);
  }
  return Array.from(grouped.values()).sort((a, b) => {
    if (!a.week) return 1;
    if (!b.week) return -1;
    return a.week.key.localeCompare(b.week.key);
  });
}

export function CurationPanel({
  competitionId,
  preview = false,
}: {
  competitionId: string;
  preview?: boolean;
}) {
  const [open, setOpen] = useState(preview || window.location.hash === "#recaps" || new URLSearchParams(window.location.search).has("recaps"));
  const [review, setReview] = useState<"pending" | "reviewed" | "featured">("pending");
  const [offset, setOffset] = useState(0);
  const search = useSearch();
  const qc = useQueryClient();
  const { toast } = useToast();

  // Deep-link target from the public page's "Feature recaps" / "Manage"
  // buttons — scroll this panel into view when arriving via #recaps.
  const anchorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (window.location.hash === "#recaps" || new URLSearchParams(search).has("recaps")) {
      setOpen(true);
      setReview("pending");
      setOffset(0);
      anchorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [search]);

  const recapsQ = useQuery<{ data: CurationRecap[]; pendingCount: number; reviewedCount: number; featuredCount: number; nextOffset: number | null }>({
    queryKey: ["competition", competitionId, "recaps", review, offset],
    queryFn: () =>
      customFetch<{ data: CurationRecap[]; pendingCount: number; reviewedCount: number; featuredCount: number; nextOffset: number | null }>(
        `/api/v1/competitions/${competitionId}/recaps?review=${review}&offset=${offset}`,
        { method: "GET" },
      ),
    // Owner-only endpoint — skip it in claim preview (would 401).
    enabled: !preview,
    refetchInterval: 30_000,
  });

  // Task #852 — brackets for the per-recap sorting dropdown (organizer can
  // re-assign a recap's bracket any time, including after publish).
  const bracketsQ = useQuery<{ data: CompetitionBracket[] }>({
    queryKey: ["competition", competitionId, "brackets"],
    queryFn: () =>
      customFetch<{ data: CompetitionBracket[] }>(
        `/api/v1/competitions/${competitionId}/brackets`,
        { method: "GET" },
      ),
    enabled: !preview,
  });
  const brackets = bracketsQ.data?.data ?? [];

  const setBracket = useMutation({
    mutationFn: ({ articleId, bracketId }: { articleId: string; bracketId: string | null }) =>
      customFetch(
        `/api/v1/competitions/${competitionId}/recaps/${articleId}/bracket`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bracketId }),
        },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["competition", competitionId, "recaps"] });
      qc.invalidateQueries({ queryKey: ["competition"] });
    },
    onError: (err) =>
      toast({
        title: "Couldn't change that recap's bracket",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      }),
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
      setOffset(0);
      qc.invalidateQueries({ queryKey: ["competition", competitionId, "recaps"] });
      qc.invalidateQueries({ queryKey: ["competition"] });
      toast({
        title: vars.featured ? "Featured on your public page" : "Reviewed — not featured",
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
  const bracketIds = new Set(brackets.map((b) => b.id));
  const recapsByBracket = new Map<string, CurationRecap[]>();
  const otherRecaps: CurationRecap[] = [];
  for (const recap of recaps) {
    if (recap.bracketId && bracketIds.has(recap.bracketId)) {
      const current = recapsByBracket.get(recap.bracketId) ?? [];
      current.push(recap);
      recapsByBracket.set(recap.bracketId, current);
    } else {
      otherRecaps.push(recap);
    }
  }
  const recapSections = brackets
    .filter((bracket) => (recapsByBracket.get(bracket.id) ?? []).length > 0)
    .map((bracket) => ({
      key: bracket.id,
      label: bracket.label,
      recaps: recapsByBracket.get(bracket.id) ?? [],
    }));
  if (otherRecaps.length > 0) {
    recapSections.push({
      key: "__other__",
      label: "Other / unassigned",
      recaps: otherRecaps,
    });
  }

  return (
    <Card id="recaps" ref={anchorRef} className="min-w-0 scroll-mt-6">
      <CollapsibleCardHeader
        icon={<Newspaper className="w-4 h-4" />}
        label="Game recaps"
        badge={
          recaps.length > 0 ? (
            <Badge numeric variant="secondary" className="ml-1">
              {recapsQ.data?.pendingCount ?? 0} pending
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
          Review coach recaps here. Feature adds a recap to your public page;
          Reviewed — don’t feature leaves the team’s published post unchanged.
        </p>
        <a href="/app/settings#email-notifications" className="inline-block max-w-full break-words text-sm font-bold underline">Competition recap email settings</a>
        <div className="flex flex-wrap gap-2" aria-label="Recap review views">
          {(["pending", "reviewed", "featured"] as const).map(view => (
            <Button key={view} size="sm" variant={review === view ? "brand" : "outline"} className="max-w-full h-auto min-h-9 whitespace-normal text-left"
              onClick={() => { setReview(view); setOffset(0); }} data-testid={`recaps-view-${view}`}>
              {view === "pending" ? `Pending (${recapsQ.data?.pendingCount ?? 0})` : view === "reviewed" ? `Reviewed / not featured (${recapsQ.data?.reviewedCount ?? 0})` : `Featured (${recapsQ.data?.featuredCount ?? 0})`}
            </Button>
          ))}
        </div>
        {recapsQ.isError && <p role="alert" className="text-sm text-destructive">Couldn’t load recaps. <button className="underline" onClick={() => void recapsQ.refetch()}>Retry</button></p>}
        {recapsQ.isLoading ? (
          <Skeleton className="h-16 rounded-lg" />
        ) : recaps.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No recaps in this view.
          </p>
        ) : (
          <div className="space-y-5">
            {recapSections.map((section) => (
              <div
                key={section.key}
                className="space-y-3"
                data-testid={`section-curation-bracket-${section.key}`}
              >
                <h3 className="text-xs font-black uppercase tracking-widest text-muted-foreground [overflow-wrap:anywhere]">
                  {section.label}{" "}
                  <span className="font-bold normal-case tracking-normal">
                    ({section.recaps.length})
                  </span>
                </h3>
                {recapWeekSections(section.recaps).map((weekSection) => (
                  <div
                    key={weekSection.key}
                    className="space-y-2"
                    data-testid={`section-curation-week-${section.key}-${weekSection.key}`}
                  >
                    <h4 className="text-xs font-black uppercase tracking-widest text-muted-foreground/80">
                      {weekSection.week
                        ? formatCompetitionWeek(weekSection.week)
                        : "Undated"}
                    </h4>
                    <div className="space-y-2">
                      {weekSection.recaps.map((r) => (
                        <div
                          key={r.id}
                          className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-3 py-3 sm:py-2"
                          data-testid={`row-recap-${r.id}`}
                        >
                          <div className="w-full min-w-0 sm:flex-1 sm:w-auto">
                            <p className="text-sm font-bold [overflow-wrap:anywhere] sm:truncate">
                              {r.title}
                              {r.featured && (
                                <Star className="inline w-3.5 h-3.5 ml-1.5 -mt-0.5 fill-amber-400 text-amber-400" />
                              )}
                            </p>
                            <Badge variant="secondary" className="max-w-full whitespace-normal">{r.reviewState === "pending" ? "Needs review" : r.featured ? "Featured · reviewed" : "Reviewed · not featured"}</Badge>
                            <p className="text-xs text-muted-foreground truncate">
                              {r.teamName}
                              {r.opponentName ? ` vs ${r.opponentName}` : ""}
                              {r.teamScore != null && r.opponentScore != null
                                ? ` · ${r.teamScore}-${r.opponentScore}`
                                : ""}
                              {r.effectiveGameDate
                                ? ` · ${r.effectiveGameDate}`
                                : " · Date unavailable"}
                              {r.groupDivision
                                ? ` · ${r.groupDivision}${
                                    r.groupBracket ? ` / ${r.groupBracket}` : ""
                                  }`
                                : r.groupBracket
                                  ? ` · ${r.groupBracket}`
                                  : " · Division unavailable"}
                            </p>
                          </div>
                          <div className="grid w-full min-w-0 grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center lg:w-auto" data-testid={`recap-actions-${r.id}`}>
                            {brackets.length > 0 && (
                              <Select
                                value={r.bracketId ?? "none"}
                                onValueChange={(v) =>
                                  setBracket.mutate({
                                    articleId: r.id,
                                    bracketId: v === "none" ? null : v,
                                  })
                                }
                              >
                                <SelectTrigger
                                  className="col-span-2 h-9 w-full min-w-0 sm:h-8 sm:w-36"
                                  data-testid={`select-recap-bracket-${r.id}`}
                                >
                                  <SelectValue placeholder="No bracket" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="none">No bracket</SelectItem>
                                  {brackets.map((b) => (
                                    <SelectItem key={b.id} value={b.id}>
                                      {b.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            )}
                            <a className="min-w-0" href={`/app/posts/${r.postId ?? `article-${r.id}`}`} target="_blank" rel="noopener noreferrer">
                              <Button size="sm" variant="ghost" className="w-full min-h-9 font-bold text-muted-foreground sm:w-auto sm:min-h-0">
                                View
                              </Button>
                            </a>
                            {r.featured ? (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-auto min-h-9 min-w-0 whitespace-normal px-2 py-2 font-bold leading-snug sm:min-h-0 sm:px-3"
                                disabled={feature.isPending}
                                onClick={() => feature.mutate({ articleId: r.id, featured: false })}
                                data-testid={`btn-unfeature-${r.id}`}
                              >
                                Remove from rail
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                variant="brand"
                                className="h-auto min-h-9 min-w-0 gap-1 whitespace-normal px-2 py-2 text-xs leading-snug sm:min-h-0 sm:px-3 sm:text-sm"
                                disabled={feature.isPending}
                                onClick={() => feature.mutate({ articleId: r.id, featured: true })}
                                data-testid={`btn-feature-${r.id}`}
                              >
                                <Star className="w-3.5 h-3.5" />
                                Feature
                              </Button>
                            )}
                            {r.reviewState === "pending" && <Button size="sm" variant="outline" className="col-span-2 h-auto min-h-9 min-w-0 whitespace-normal px-2 py-2 leading-snug sm:min-h-0 sm:px-3"
                              disabled={feature.isPending}
                              onClick={() => feature.mutate({ articleId: r.id, featured: false })}
                              data-testid={`btn-review-${r.id}`}>Reviewed — don’t feature</Button>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2">
          {offset > 0 && <Button variant="outline" size="sm" onClick={() => setOffset(Math.max(0, offset - 100))}>Newer recaps</Button>}
          {recapsQ.data?.nextOffset != null && <Button variant="outline" size="sm" onClick={() => setOffset(recapsQ.data!.nextOffset!)}>Older recaps</Button>}
        </div>
      </CardContent>
      )}
    </Card>
  );
}

export function ScheduleFilePicker({
  disabled,
  label = "Upload schedule file",
  onStart,
  onCsv,
  onError,
}: {
  disabled?: boolean;
  label?: string;
  onStart?: () => void;
  onCsv: (csv: string) => void;
  onError: (error: unknown) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);

  const handleFile = async (file: File) => {
    onStart?.();
    setReading(true);
    try {
      onCsv(await readCompetitionScheduleFile(file));
    } catch (error) {
      onError(error);
    } finally {
      setReading(false);
    }
  };

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="hidden"
        disabled={disabled || reading}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void handleFile(file);
          // Reset so selecting the same file again after an error works.
          event.target.value = "";
        }}
        data-testid="input-csv-file"
      />
      <Button
        type="button"
        variant="brand"
        size="lg"
        className="w-full font-bold"
        disabled={disabled || reading}
        onClick={() => fileRef.current?.click()}
        data-testid="btn-csv-choose-file"
      >
        <Upload className="mr-2 h-4 w-4" />
        {reading ? "Reading your schedule…" : label}
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        Pick a CSV or Excel workbook — we'll read it and set up the games
        automatically.
      </p>
    </>
  );
}

function SchedulePanel({
  competitionId,
  matchCount,
  isLeague,
  competitionName,
  // Renamed locally: this panel already has a `preview` state (CSV dry-run).
  preview: claimPreviewMode = false,
}: {
  competitionId: string;
  matchCount: number;
  isLeague: boolean;
  competitionName: string;
  preview?: boolean;
}) {
  const [open, setOpen] = useState(claimPreviewMode);
  const [clearOpen, setClearOpen] = useState(false);
  const qc = useQueryClient();
  const { toast } = useToast();

  // Task #780 — wipe the whole schedule (team slots stay; recap posts keep
  // their competition badge, only their game link is cleared).
  const clearGames = useMutation({
    mutationFn: (confirm: string) =>
      customFetch<{ gamesDeleted: number; recapsUnlinked: number }>(
        `/api/v1/competitions/${competitionId}/clear-games`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirm }),
        },
      ),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["competition"] });
      qc.invalidateQueries({ queryKey: ["my", "competitions"] });
      setClearOpen(false);
      toast({
        title: `Removed ${r.gamesDeleted} game${r.gamesDeleted === 1 ? "" : "s"}`,
        description:
          r.recapsUnlinked > 0
            ? `${r.recapsUnlinked} recap post${r.recapsUnlinked === 1 ? "" : "s"} kept — just unlinked from deleted games.`
            : "Team slots and claims are untouched.",
      });
    },
    onError: (err) =>
      toast({
        title: "Couldn't clear the schedule",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      }),
  });
  const [csv, setCsv] = useState("");
  const [pasteOpen, setPasteOpen] = useState(false);
  const [lastResult, setLastResult] = useState<ImportResult | null>(null);
  // Task #766 — two-step import: server dry-run first, organizer confirms.
  // pendingCsv is the exact text the preview was computed from; confirm
  // sends that same text so what you saw is what gets applied.
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [pendingCsv, setPendingCsv] = useState("");
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
        actions={
          matchCount > 0 ? (
            <Button
              size="sm"
              variant="ghost"
              className="font-bold text-muted-foreground hover:text-destructive"
              onClick={() => setClearOpen(true)}
              data-testid="btn-clear-all-games"
            >
              <Trash2 className="w-3.5 h-3.5 mr-1" />
              Clear all games
            </Button>
          ) : undefined
        }
      />
      <ClearAllDialog
        open={clearOpen}
        onOpenChange={setClearOpen}
        title={`Clear all ${matchCount} games?`}
        description={
          <>
            <p>
              Every game in this competition will be deleted — the whole
              schedule, all at once. This can't be undone; re-upload a CSV to
              rebuild it.
            </p>
            <p>
              <span className="font-bold text-foreground">
                Team slots and claims are untouched
              </span>{" "}
              — claimed teams keep their spot. Recap posts survive with their
              competition badge; only their link to a deleted game is cleared.
            </p>
          </>
        }
        competitionName={competitionName}
        confirmLabel="Clear all games"
        pending={clearGames.isPending}
        onConfirm={(c) => clearGames.mutate(c)}
        testId="dialog-clear-all-games"
      />
      {open && (
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Upload the CSV or Excel workbook your scheduling tool exports — as-is,
          no cleanup needed.
        </p>
        <div
          className="rounded-lg border border-border bg-muted/40 p-3 space-y-2"
          data-testid="text-import-rules"
        >
          <p className="text-xs">
            <span className="font-bold">Only 5 columns are required:</span>{" "}
            {REQUIRED_COLUMNS.join(", ")}. Every game needs a division (group)
            value — it's what keeps the Teams list organized by group, gender,
            and age. A column named Group, Pool, Flight, or Bracket counts.
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
        <ScheduleFilePicker
          disabled={importMut.isPending || previewMut.isPending}
          label={
            previewMut.isPending
              ? "Reading your schedule…"
              : importMut.isPending
                ? "Uploading your schedule…"
                : "Upload schedule file"
          }
          onStart={() => {
            setPreview(null);
            setPendingCsv("");
          }}
          onCsv={(text) => {
            setCsv(text);
            previewMut.mutate(text);
          }}
          onError={(error) =>
            toast({
              title: "Couldn't read that file",
              description:
                error instanceof Error
                  ? error.message
                  : "Choose a CSV or Excel (.xlsx) schedule file.",
              variant: "destructive",
            })
          }
        />
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
                  {preview.addedCount ?? preview.added.length} new
                </Badge>
                <Badge variant="secondary" className="font-bold">
                  {preview.changedCount ?? preview.changed.length} changed
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
                    {preview.renumberWarningCount ??
                      preview.renumberWarnings.length}{" "}
                    "new" game
                    {(preview.renumberWarningCount ??
                      preview.renumberWarnings.length) === 1
                      ? ""
                      : "s"}{" "}
                    in this file look
                    {(preview.renumberWarningCount ??
                      preview.renumberWarnings.length) === 1
                      ? "s"
                      : ""}{" "}
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
                    {(preview.renumberWarningCount ??
                      preview.renumberWarnings.length) > 6 ? (
                      <li className="text-[11px] text-amber-700/90 dark:text-amber-400/90">
                        …and{" "}
                        {(preview.renumberWarningCount ??
                          preview.renumberWarnings.length) - 6}{" "}
                        more.
                      </li>
                    ) : null}
                  </ul>
                </div>
              ) : null}

              {preview.changed.length > 0 ? (
                <div className="space-y-1" data-testid="list-preview-changed">
                  <p className="text-xs font-bold">
                    Changing ({preview.changedCount ?? preview.changed.length})
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
                    Adding ({preview.addedCount ?? preview.added.length})
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
                    {(preview.addedCount ?? preview.added.length) > 30 ? (
                      <li className="text-[11px] text-muted-foreground">
                        …and {(preview.addedCount ?? preview.added.length) - 30}{" "}
                        more.
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
                  {preview.missingFromFileCount ??
                    preview.missingFromFile.length}{" "}
                  existing game
                  {(preview.missingFromFileCount ??
                    preview.missingFromFile.length) === 1
                    ? ""
                    : "s"}{" "}
                  — imports
                  never delete games.
                </p>
              ) : null}

              {(preview.rowWarnings?.length ?? 0) > 0 ? (
                <div className="space-y-0.5" data-testid="list-preview-warnings">
                  <p className="text-[11px] font-bold text-amber-600 dark:text-amber-500">
                    {preview.rowWarningCount ??
                      preview.rowWarnings!.length}{" "}
                    row
                    {(preview.rowWarningCount ??
                      preview.rowWarnings!.length) === 1
                      ? ""
                      : "s"}{" "}
                    to
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
                    {(preview.rowWarningCount ??
                      preview.rowWarnings!.length) > 8 ? (
                      <li className="text-[11px] text-muted-foreground">
                        …and{" "}
                        {(preview.rowWarningCount ??
                          preview.rowWarnings!.length) - 8}{" "}
                        more.
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
  preview = false,
}: {
  competitionId: string;
  slug: string;
  preview?: boolean;
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
  const [listOpen, setListOpen] = useState(preview);

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
      {listOpen && (
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
        {q.isLoading ? (
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
      )}

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
  const [open, setOpen] = useState(false);
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

  // A prospective operator can arrive here from a claim link ("Edit
  // competition" on the public page carries ?claimToken=). They get a
  // read-only preview — claim banner + walkthrough — until they actually
  // claim; every edit endpoint stays owner-only server-side.
  const { token: claimToken } = useClaimTokenParams();
  const claimResolve = useCompetitionClaimResolve(claimToken);
  const claimPreview =
    !!claimResolve.data &&
    claimResolve.data.competition.id === competitionId &&
    !claimResolve.data.alreadyClaimed
      ? claimResolve.data
      : null;

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
        targetTestId: "btn-how-it-works-toggle",
        title: "How it all works",
        body: (
          <>
            <strong>How your competition works on Kinectem</strong> is a
            2-minute guide to the whole lifecycle — from setup to your brand on
            every game recap. Only you can see it.
          </>
        ),
      },
      {
        targetTestId: "btn-toggle-hub",
        title: "Competition hub",
        body: (
          <>
            Run more than one event? <strong>Competition hub</strong> groups
            all your competitions under one branded home so teams always know
            where to find you.
          </>
        ),
      },
      {
        targetTestId: "btn-toggle-admins-competition",
        title: "Add admins",
        body: (
          <>
            <strong>Admins</strong> lets you share the work — add trusted
            people who can manage the schedule, branding, claims, and recap
            curation with you.
          </>
        ),
      },
      {
        targetTestId: "btn-toggle-details",
        title: "Edit the details",
        body: (
          <>
            Update the name, dates, location, and description any time under{" "}
            <strong>Competition details</strong>.
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
        targetTestId: "btn-toggle-promo-referral",
        title: "Earn with your promo code",
        body: (
          <>
            Share your FREE2027 signup link — unpaid organizations get free access through July 31, 2027 and your competition
            earns a <strong>15% commission</strong> after their first full-price annual payment. A ready-made message is
            waiting inside.
          </>
        ),
      },
      {
        targetTestId: "btn-toggle-schedule",
        title: "Upload your schedule",
        body: (
          <>
            Import your game schedule as a CSV under{" "}
            <strong>Schedule</strong> — exports from most scheduling tools work
            as-is.
          </>
        ),
      },
      {
        targetTestId: "btn-toggle-invite-teams",
        title: "Invite your teams",
        body: (
          <>
            <strong>Invite your teams</strong> gives you a ready-to-send
            message so coaches can claim their spot in your competition.
          </>
        ),
      },
      {
        targetTestId: "btn-toggle-claims",
        title: "Approve team claims",
        body: (
          <>
            When a coach claims a team, the request lands in{" "}
            <strong>Team claims</strong>. Approve it (or turn on auto-approve)
            so their recaps carry your competition's badge.
          </>
        ),
      },
      {
        targetTestId: "btn-toggle-games-list",
        title: "Manage individual games",
        body: (
          <>
            <strong>Games</strong> is for one-off fixes — move a time, swap a
            venue, postpone a rainout, or add a single game without
            re-uploading your CSV.
          </>
        ),
      },
      {
        targetTestId: "btn-toggle-recaps",
        title: "Feature the best recaps",
        body: (
          <>
            <strong>Game recaps</strong> is where you curate — pick the best
            team-written recaps to feature front-and-center on your public
            page.
          </>
        ),
      },
      {
        targetTestId: "btn-view-public",
        additionalTargetTestIds: ["btn-competition-replay-tour"],
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
    // With a claim token in the URL, hold this auth-gated request until the
    // token resolves: preview visitors (often anonymous) never need it, so
    // don't fire a 401-retry loop for them. Tokenless visits load it
    // immediately as before.
    enabled:
      !claimToken || (!claimResolve.isLoading && !claimPreview),
  });

  const row = (listQ.data?.data ?? []).find((c) => c.id === competitionId);

  // Claim-preview visitors have no /my/competitions row — fall back to the
  // slug the claim token resolved to (same public endpoint either way).
  // Task #877 — platform admins reach competitions not in their list via
  // search → public page → "Edit competition". In that case row is absent, so
  // fall back to competitionId (a UUID): the detail endpoint now accepts both
  // slugs and UUIDs, and canManage drives whether the console renders.
  const detailSlug =
    row?.slug ?? claimPreview?.competition.slug ?? competitionId ?? "";

  const detailQ = useQuery<CompetitionDetail>({
    queryKey: ["competition", detailSlug],
    queryFn: () =>
      customFetch<CompetitionDetail>(
        `/api/v1/competitions/${encodeURIComponent(detailSlug)}`,
        { method: "GET" },
      ),
    enabled: !!detailSlug,
  });

  // Claim-preview branch comes first: an unclaimed competition can't be in
  // anyone's /my/competitions list, so don't hold the preview hostage to that
  // (auth-gated, retrying) request — anonymous visitors would stare at a
  // skeleton for seconds otherwise. The full console renders read-only with
  // every section expanded; claiming remounts the page as the real operator.
  if (!row && claimPreview) {
    const previewDetail = detailQ.data?.competition;
    if (!previewDetail) {
      return (
        <div className="max-w-3xl mx-auto space-y-4">
          <Skeleton className="h-24 rounded-xl" />
          <Skeleton className="h-48 rounded-xl" />
        </div>
      );
    }
    // Public detail response also carries the public counts + matches (same
    // endpoint the public page and GamesPanel use) — enough for a synthetic
    // console row.
    const pub = previewDetail as CompetitionDetail["competition"] & {
      participantCount?: number;
      claimedCount?: number;
    };
    const matchCount =
      (detailQ.data as { matches?: unknown[] } | undefined)?.matches?.length ??
      0;
    const previewRow: CompetitionRow = {
      id: previewDetail.id,
      slug: previewDetail.slug,
      name: previewDetail.name,
      type: previewDetail.type,
      startDate: previewDetail.startDate,
      endDate: previewDetail.endDate,
      location: previewDetail.location,
      organizerId: null,
      autoApproveClaims: previewDetail.autoApproveClaims,
      logoUrl: previewDetail.logoUrl,
      brandColor: previewDetail.brandColor,
      matchCount,
      participantCount: pub.participantCount ?? 0,
      claimedCount: pub.claimedCount ?? 0,
      pendingClaimCount: 0,
    };
    return (
      <ConsoleWithTour
        row={previewRow}
        detail={previewDetail}
        tourOpen={false}
        setTourOpen={setTourOpen}
        finishTour={finishTour}
        tourSteps={tourSteps}
        preview
      />
    );
  }

  // Task #877 — when row is absent but detailQ loaded canManage=true (e.g. a
  // platform admin arriving via search → public page → "Edit competition"),
  // synthesize a ConsoleRow from the detail response, just like the claim-
  // preview path does. This keeps the fallback path out of the skeleton budget
  // so it waits for detail, not just the list.
  const fallbackDetail =
    !row && !claimPreview ? detailQ.data?.competition : undefined;
  const fallbackCanManage =
    fallbackDetail &&
    (fallbackDetail as { canManage?: boolean }).canManage === true;

  if (
    listQ.isLoading ||
    (!row && claimToken && claimResolve.isLoading) ||
    (!row && !claimPreview && detailQ.isLoading)
  ) {
    return (
      <div className="max-w-3xl mx-auto space-y-4">
        <Skeleton className="h-24 rounded-xl" />
        <Skeleton className="h-48 rounded-xl" />
      </div>
    );
  }

  if (!row && fallbackCanManage && fallbackDetail) {
    const pub = fallbackDetail as typeof fallbackDetail & {
      participantCount?: number;
      claimedCount?: number;
    };
    const matchCount =
      (detailQ.data as { matches?: unknown[] } | undefined)?.matches?.length ??
      0;
    const adminRow: CompetitionRow = {
      id: fallbackDetail.id,
      slug: fallbackDetail.slug,
      name: fallbackDetail.name,
      type: fallbackDetail.type,
      startDate: fallbackDetail.startDate,
      endDate: fallbackDetail.endDate,
      location: fallbackDetail.location,
      organizerId: null,
      autoApproveClaims: fallbackDetail.autoApproveClaims,
      logoUrl: fallbackDetail.logoUrl,
      brandColor: fallbackDetail.brandColor,
      matchCount,
      participantCount: pub.participantCount ?? 0,
      claimedCount: pub.claimedCount ?? 0,
      pendingClaimCount: 0,
    };
    return (
      <ConsoleWithTour
        row={adminRow}
        detail={fallbackDetail}
        tourOpen={false}
        setTourOpen={setTourOpen}
        finishTour={finishTour}
        tourSteps={tourSteps}
      />
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
  preview = false,
}: {
  row: CompetitionRow;
  detail: CompetitionDetail["competition"] | undefined;
  tourOpen: boolean;
  setTourOpen: (v: boolean) => void;
  finishTour: () => void;
  tourSteps: TourStep[];
  // Claim-link preview: prospective operator, not an owner yet. Everything
  // renders expanded and read-only (disabled fieldset); owner-only child
  // queries are skipped. Server-side authorization is unaffected.
  preview?: boolean;
}) {
  const { token: previewClaimToken } = useClaimTokenParams();
  // Open the walkthrough once per browser, the first time an authorized
  // operator lands on any competition console. Platform admins may arrive
  // through the all-competition finder without a /my/competitions row.
  useEffect(() => {
    if (typeof window === "undefined" || !detail || preview) return;
    let alreadySeen = false;
    try {
      alreadySeen = localStorage.getItem(COMP_TOUR_KEY) === "1";
    } catch {
      // storage blocked (private mode etc.) — treat as not seen
    }
    if (!alreadySeen) setTourOpen(true);
  }, [detail, setTourOpen, preview]);

  return (
    <OrganizerSidebar>
      <div className="w-full min-w-0 max-w-3xl mx-auto space-y-6">
      {preview ? (
        <>
          <CompetitionClaimBanner slug={row.slug} />
          <p
            className="text-sm text-muted-foreground"
            data-testid="text-claim-preview-note"
          >
            This is your competition console — everything below is what you'll
            manage. It's read-only until you claim the competition above.
          </p>
        </>
      ) : null}
      <div className="app-page-header p-4 sm:p-5 space-y-2" data-testid="competition-console-header">
        <p className="app-kicker max-w-full leading-relaxed">Competition command center</p>
        {!preview ? (
          <Link href="/competitions">
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline cursor-pointer">
              <ArrowLeft className="w-3 h-3" /> My competitions
            </span>
          </Link>
        ) : null}
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="w-full min-w-0 sm:w-auto sm:flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Link href={`/competitions/c/${row.slug}`} className="min-w-0 max-w-full">
                <h1
                   className="text-xl sm:text-2xl font-black leading-tight tracking-tight [overflow-wrap:anywhere] cursor-pointer hover:underline"
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
          <div className="grid w-full min-w-0 grid-cols-1 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center">
            {!preview ? (
              <Button
                size="sm"
                variant="outline"
                className="w-full sm:w-auto font-bold rounded-full"
                onClick={() => setTourOpen(true)}
                data-testid="btn-competition-replay-tour"
              >
                <Compass className="w-3.5 h-3.5 mr-1.5" />
                Show me around
              </Button>
            ) : null}
            <a
              className="min-w-0"
              href={`/app/c/${row.slug}${
                preview && previewClaimToken
                  ? `?claimToken=${encodeURIComponent(previewClaimToken)}`
                  : ""
              }`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button
                size="sm"
                variant="outline"
                className="w-full sm:w-auto font-bold rounded-full"
                data-testid="btn-view-public"
              >
                <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
                View public page
              </Button>
            </a>
          </div>
        </div>
      </div>

      {/* In claim preview everything renders expanded but read-only: the
          fieldset disables every form control (inputs, buttons, switches,
          chevron toggles) in one place. Server-side authorization is the real
          boundary — this is purely presentational. */}
      <fieldset
        disabled={preview}
        className="space-y-6 min-w-0"
        data-testid={preview ? "fieldset-claim-preview" : undefined}
      >
      {/* Compact lifecycle guide right where the organizer does the work —
          starts collapsed like every section so the page lands condensed
          (expanded for claim-preview visitors). */}
      <CompetitionHowItWorks
        brandColor={detail?.brandColor}
        secondaryColor={detail?.secondaryColor}
        defaultOpen={preview}
      />

      {!preview ? (
        <>
          <HubPanel competitionId={row.id} organizerId={row.organizerId} />
          {/* Per-competition admin management. Platform admins receive
              viewerIsOwner=true from the API so they can also remove admins;
              the competition owner remains protected. */}
          <CompetitionAdminsPanel
            kind="competition"
            targetId={row.id}
            collapsible
          />
          <CompetitionPartnerPagesPanel competitionId={row.id} />
          <CompetitionAlbumConsolePanel competitionId={row.id} slug={row.slug} />
        </>
      ) : null}
      {detail ? (
        <DetailsPanel detail={detail} competitionId={row.id} preview={preview} />
      ) : (
        <Skeleton className="h-48 rounded-xl" />
      )}
      {detail ? (
        <BrandingPanel detail={detail} competitionId={row.id} preview={preview} />
      ) : (
        <Skeleton className="h-48 rounded-xl" />
      )}
      <PromoReferralPanel
        competitionId={row.id}
        competitionName={detail?.name ?? row.name}
        promoCode={detail?.promoCode ?? null}
        hubPromoCode={detail?.organizer?.promoCode ?? null}
        preview={preview}
      />
      <SchedulePanel
        competitionId={row.id}
        matchCount={row.matchCount}
        isLeague={row.type === "league"}
        competitionName={detail?.name ?? row.name}
        preview={preview}
      />
      {/* Task #852 — brackets for sorting recaps, directly below Schedule. */}
      <BracketsPanel competitionId={row.id} preview={preview} />
      <InviteTeamsPanel
        name={detail?.name ?? row.name}
        type={detail?.type ?? row.type}
        startDate={detail?.startDate ?? row.startDate}
        endDate={detail?.endDate ?? row.endDate}
        location={detail ? detail.location : row.location}
        autoApproveClaims={detail?.autoApproveClaims ?? row.autoApproveClaims}
        slug={row.slug}
        promoCode={resolveEffectivePromoCode(
          detail?.promoCode,
          detail?.organizer?.promoCode,
        )}
        preview={preview}
      />
      <ClaimsPanel
        competitionId={row.id}
        autoApproveClaims={detail?.autoApproveClaims ?? row.autoApproveClaims}
        competitionName={detail?.name ?? row.name}
        participantCount={row.participantCount}
        claimedCount={row.claimedCount}
        preview={preview}
      />
      <GamesPanel competitionId={row.id} slug={row.slug} preview={preview} />
      <CurationPanel competitionId={row.id} preview={preview} />
      <DangerZonePanel
        competitionId={row.id}
        competitionName={detail?.name ?? row.name}
      />
      </fieldset>
      </div>
      {tourOpen && <SpotlightTour steps={tourSteps} onFinish={finishTour} />}
    </OrganizerSidebar>
  );
}
