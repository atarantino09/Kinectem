import { useEffect, useRef, useState } from "react";
import { Link, useRoute } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { BrandColorField } from "@/components/BrandColorField";
import { BrandImageField } from "@/components/BrandImageField";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import {
  Upload,
  ExternalLink,
  Palette,
  Pencil,
  ShieldCheck,
  ArrowLeft,
  Newspaper,
  Star,
  Scale,
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
  autoApproveClaims: boolean;
  logoUrl: string | null;
  brandColor: string | null;
  matchCount: number;
  participantCount: number;
  claimedCount: number;
  pendingClaimCount: number;
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
  "match #,date,start time,age,gender,division,bracket,venue,venue state,field,home team,home score,away team,away score";

const SAMPLE = `${CSV_HEADER}
1,2026-07-11,09:00,U12,boys,Gold,A,Riverside Park,CA,Field 2,Thunder FC,2,Lightning SC,1
2,2026-07-11,10:30,U12,boys,Gold,A,Riverside Park,CA,Field 2,Strikers,,Comets,`;

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
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
          <div>
            <p className="text-sm font-bold">Auto-approve claims</p>
            <p className="text-xs text-muted-foreground">
              When off, coaches&apos; claims wait here for your approval.
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
            No claims waiting for review.
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
    <Card>
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

// §6 — disputed scores queue: games where the two claimed teams reported
// different results and no official score exists. Operator settles each one
// by entering the official score inline.
interface DisputeRow {
  gameId: string;
  matchNumber: number | null;
  matchDate: string | null;
  division: string | null;
  bracket: string | null;
  homeName: string | null;
  awayName: string | null;
  reports: {
    teamId: string;
    teamName: string;
    homeScore: number;
    awayScore: number;
    updatedAt: string;
  }[];
}

function DisputeRowItem({
  competitionId,
  d,
}: {
  competitionId: string;
  d: DisputeRow;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [home, setHome] = useState("");
  const [away, setAway] = useState("");

  const settle = useMutation({
    mutationFn: () =>
      customFetch(
        `/api/v1/competitions/${competitionId}/games/${d.gameId}/official-score`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            homeScore: Number(home),
            awayScore: Number(away),
          }),
        },
      ),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: ["competition", competitionId, "disputes"],
      });
      qc.invalidateQueries({ queryKey: ["competition"] });
      toast({ title: "Official score set" });
    },
    onError: (err) =>
      toast({
        title: "Couldn't set the official score",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      }),
  });

  const valid = /^\d{1,3}$/.test(home.trim()) && /^\d{1,3}$/.test(away.trim());

  return (
    <div
      className="rounded-lg border border-border px-3 py-2 space-y-2"
      data-testid={`row-dispute-${d.gameId}`}
    >
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {d.matchNumber != null ? <span>#{d.matchNumber}</span> : null}
        {d.matchDate ? <span>{d.matchDate}</span> : null}
        {d.division ? <span>{d.division}</span> : null}
        {d.bracket ? <span>{d.bracket}</span> : null}
      </div>
      <p className="text-sm font-bold">
        {d.homeName ?? "TBD"}{" "}
        <span className="text-muted-foreground font-medium">vs</span>{" "}
        {d.awayName ?? "TBD"}
      </p>
      <div className="space-y-0.5">
        {d.reports.map((r) => (
          <p key={r.teamId} className="text-xs text-muted-foreground">
            {r.teamName} reported{" "}
            <span className="font-bold tabular-nums text-foreground">
              {r.homeScore}–{r.awayScore}
            </span>
          </p>
        ))}
      </div>
      <div className="flex items-center gap-1.5">
        <Input
          value={home}
          onChange={(e) => setHome(e.target.value)}
          placeholder="Home"
          inputMode="numeric"
          className="h-8 w-16 text-center"
          data-testid={`input-official-home-${d.gameId}`}
        />
        <span className="text-xs text-muted-foreground">–</span>
        <Input
          value={away}
          onChange={(e) => setAway(e.target.value)}
          placeholder="Away"
          inputMode="numeric"
          className="h-8 w-16 text-center"
          data-testid={`input-official-away-${d.gameId}`}
        />
        <Button
          size="sm"
          variant="brand"
          className="font-bold"
          disabled={!valid || settle.isPending}
          onClick={() => settle.mutate()}
          data-testid={`btn-official-${d.gameId}`}
        >
          Set official score
        </Button>
      </div>
    </div>
  );
}

function DisputesPanel({ competitionId }: { competitionId: string }) {
  const disputesQ = useQuery<{ data: DisputeRow[] }>({
    queryKey: ["competition", competitionId, "disputes"],
    queryFn: () =>
      customFetch<{ data: DisputeRow[] }>(
        `/api/v1/competitions/${competitionId}/disputes`,
        { method: "GET" },
      ),
  });
  const disputes = disputesQ.data?.data ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Scale className="w-4 h-4" />
          Disputed scores
          {disputes.length > 0 && (
            <Badge variant="destructive" className="ml-1">
              {disputes.length}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          When both teams report different results, the score is hidden
          publicly until you set the official one.
        </p>
        {disputesQ.isLoading ? (
          <Skeleton className="h-16 rounded-lg" />
        ) : disputes.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No disputes — nice and quiet.
          </p>
        ) : (
          <div className="space-y-2">
            {disputes.map((d) => (
              <DisputeRowItem
                key={d.gameId}
                competitionId={competitionId}
                d={d}
              />
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
              <h1 className="text-2xl font-semibold tracking-tight truncate">
                {row.name}
              </h1>
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

      {detail ? (
        <DetailsPanel detail={detail} competitionId={row.id} />
      ) : (
        <Skeleton className="h-48 rounded-xl" />
      )}
      <ClaimsPanel
        competitionId={row.id}
        autoApproveClaims={detail?.autoApproveClaims ?? row.autoApproveClaims}
      />
      <CurationPanel competitionId={row.id} />
      <DisputesPanel competitionId={row.id} />
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
    </div>
  );
}
