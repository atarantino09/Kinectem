import { useEffect, useRef, useState } from "react";
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
  Upload,
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
} from "lucide-react";

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

function DetailsPanel({
  detail,
  competitionId,
}: {
  detail: CompetitionDetail["competition"];
  competitionId: string;
}) {
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
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Pencil className="w-4 h-4" />
          Competition details
        </CardTitle>
      </CardHeader>
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
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Palette className="w-4 h-4" />
          Branding
        </CardTitle>
      </CardHeader>
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
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Megaphone className="w-4 h-4" />
          Invite your teams
        </CardTitle>
      </CardHeader>
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
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="w-4 h-4" />
          Team claims
        </CardTitle>
      </CardHeader>
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
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Newspaper className="w-4 h-4" />
          Game recaps
          {recaps.length > 0 && (
            <Badge variant="secondary" className="ml-1">
              {recaps.length}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
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
  const qc = useQueryClient();
  const { toast } = useToast();
  const [csv, setCsv] = useState("");
  const [pasteOpen, setPasteOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const importMut = useMutation({
    mutationFn: (csvText: string) =>
      customFetch<{ matchesUpserted: number; participantCount: number }>(
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
      toast({
        title: "Schedule uploaded",
        description: `${r.matchesUpserted} games · ${r.participantCount} teams.`,
      });
      setCsv("");
    },
    onError: (err) =>
      toast({
        title: "Upload failed",
        description:
          err instanceof Error ? err.message : "Check the CSV format and try again.",
        variant: "destructive",
      }),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Upload className="w-4 h-4" />
          Schedule ({matchCount} games)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Paste the game CSV or choose a file. Re-uploading is safe: existing
          games update in place and claimed teams keep their claims
          {isLeague ? " — perfect for adding each week's games" : ""}.
        </p>
        <code className="block rounded-md bg-muted p-2 text-[11px] leading-relaxed break-words">
          {CSV_HEADER}
        </code>
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
                importMut.mutate(text);
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
          disabled={importMut.isPending}
          onClick={() => fileRef.current?.click()}
          data-testid="btn-csv-choose-file"
        >
          <Upload className="mr-2 h-4 w-4" />
          {importMut.isPending
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
            onClick={() => importMut.mutate(csv)}
            disabled={!pasteOpen || !csv.trim() || importMut.isPending}
            data-testid="btn-upload-schedule"
          >
            <Upload className="w-3.5 h-3.5 mr-1.5" />
            {importMut.isPending ? "Uploading…" : "Upload pasted CSV"}
          </Button>
        ) : null}
      </CardContent>
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
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Building2 className="w-4 h-4" />
          Competition hub
        </CardTitle>
      </CardHeader>
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
    </Card>
  );
}

export default function CompetitionConsolePage() {
  const [, params] = useRoute("/competitions/:id");
  const competitionId = params?.id ?? "";

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
    </OrganizerSidebar>
  );
}
