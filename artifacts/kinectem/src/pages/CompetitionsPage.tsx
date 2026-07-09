import { useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { BrandColorField } from "@/components/BrandColorField";
import { BrandImageField } from "@/components/BrandImageField";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Trophy, CalendarDays, MapPin, ExternalLink, Settings2, Upload } from "lucide-react";

// Competitions §4 — self-serve competition creation + "my competitions" list.
// Any signed-in user can create a tournament or league they operate; the
// per-competition console lives at /competitions/:id. customFetch — these
// routes are outside the locked openapi.yaml.

interface CompetitionRow {
  id: string;
  slug: string;
  name: string;
  type: "tournament" | "league";
  startDate: string;
  endDate: string;
  location: string | null;
  matchCount: number;
  participantCount: number;
  claimedCount: number;
  pendingClaimCount: number;
  createdAt: string;
}

function fmtDate(d: string): string {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, day ?? 1).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// Competitions §9c — 3-step self-serve create wizard:
// 1. Details (creates the competition) → 2. Branding (skippable PATCH) →
// 3. Upload schedule (skippable import). Finish lands in the operator console.
function CreateCompetitionCard() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [createdId, setCreatedId] = useState<string | null>(null);
  // Step 1 — details
  const [name, setName] = useState("");
  const [type, setType] = useState<"tournament" | "league">("tournament");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  // Step 2 — branding
  const [brandColor, setBrandColor] = useState("");
  const [secondaryColor, setSecondaryColor] = useState("");
  const [tertiaryColor, setTertiaryColor] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [bannerUrl, setBannerUrl] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  // Step 3 — schedule
  const [csv, setCsv] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const finish = (id: string) => {
    qc.invalidateQueries({ queryKey: ["my", "competitions"] });
    navigate(`/competitions/${id}`);
  };

  const create = useMutation({
    mutationFn: () =>
      customFetch<CompetitionRow>(`/api/v1/competitions`, {
        method: "POST",
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
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: ["my", "competitions"] });
      setCreatedId(row.id);
      setStep(2);
      toast({ title: `${type === "league" ? "League" : "Tournament"} created` });
    },
    onError: (err) =>
      toast({
        title: "Couldn't create the competition",
        description:
          err instanceof Error ? err.message : "Check the details and try again.",
        variant: "destructive",
      }),
  });

  const hexOk = (v: string) =>
    v.trim() === "" || /^#[0-9a-fA-F]{6}$/.test(v.trim());
  const colorOk =
    hexOk(brandColor) && hexOk(secondaryColor) && hexOk(tertiaryColor);
  const brandingDirty = !!(
    brandColor.trim() ||
    secondaryColor.trim() ||
    tertiaryColor.trim() ||
    logoUrl.trim() ||
    bannerUrl.trim() ||
    websiteUrl.trim()
  );

  const saveBranding = useMutation({
    mutationFn: () =>
      customFetch(`/api/v1/competitions/${createdId}`, {
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
      toast({ title: "Branding saved" });
      setStep(3);
    },
    onError: (err) =>
      toast({
        title: "Couldn't save branding",
        description:
          err instanceof Error ? err.message : "Check the values and try again.",
        variant: "destructive",
      }),
  });

  const importMut = useMutation({
    mutationFn: () =>
      customFetch<{ matchesUpserted: number; participantCount: number }>(
        `/api/v1/competitions/${createdId}/import`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ csv }),
        },
      ),
    onSuccess: (r) => {
      toast({
        title: "Schedule uploaded",
        description: `${r.matchesUpserted} games · ${r.participantCount} teams.`,
      });
      if (createdId) finish(createdId);
    },
    onError: (err) =>
      toast({
        title: "Upload failed",
        description:
          err instanceof Error ? err.message : "Check the CSV format and try again.",
        variant: "destructive",
      }),
  });

  const canSubmit =
    name.trim().length > 0 &&
    /^\d{4}-\d{2}-\d{2}$/.test(startDate) &&
    /^\d{4}-\d{2}-\d{2}$/.test(endDate) &&
    endDate >= startDate;

  const stepLabels = ["Details", "Branding", "Schedule"] as const;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Trophy className="w-4 h-4" />
          Create a competition
        </CardTitle>
        <div className="flex items-center gap-2 pt-1">
          {stepLabels.map((label, i) => {
            const n = (i + 1) as 1 | 2 | 3;
            const active = step === n;
            const done = step > n;
            return (
              <div key={label} className="flex items-center gap-2">
                {i > 0 && <span className="h-px w-6 bg-border" />}
                <span
                  className={`flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest ${
                    active
                      ? "text-primary"
                      : done
                        ? "text-foreground"
                        : "text-muted-foreground"
                  }`}
                  data-testid={`wizard-step-${n}`}
                >
                  <span
                    className={`flex h-5 w-5 items-center justify-center rounded-full border text-[10px] ${
                      active
                        ? "border-primary bg-primary text-primary-foreground"
                        : done
                          ? "border-foreground"
                          : "border-border"
                    }`}
                  >
                    {n}
                  </span>
                  {label}
                </span>
              </div>
            );
          })}
        </div>
      </CardHeader>
      <CardContent>
        {step === 1 && (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (canSubmit) create.mutate();
            }}
          >
            <div className="flex gap-2">
              {(["tournament", "league"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setType(t)}
                  className={`rounded-full border px-4 py-1.5 text-sm font-bold capitalize transition-colors ${
                    type === t
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border hover:border-primary/50"
                  }`}
                  data-testid={`btn-type-${t}`}
                >
                  {t}
                </button>
              ))}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-name" className="text-xs font-bold">
                Name
              </Label>
              <Input
                id="c-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={
                  type === "league" ? "Metro Fall League 2026" : "Summer Classic 2026"
                }
                maxLength={200}
                data-testid="input-competition-name"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="c-start" className="text-xs font-bold">
                  {type === "league" ? "Season start" : "Start date"}
                </Label>
                <Input
                  id="c-start"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  data-testid="input-competition-start"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="c-end" className="text-xs font-bold">
                  {type === "league" ? "Season end" : "End date"}
                </Label>
                <Input
                  id="c-end"
                  type="date"
                  value={endDate}
                  min={startDate || undefined}
                  onChange={(e) => setEndDate(e.target.value)}
                  data-testid="input-competition-end"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-location" className="text-xs font-bold">
                Location <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="c-location"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Riverside Sports Complex"
                maxLength={200}
                data-testid="input-competition-location"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-desc" className="text-xs font-bold">
                Description <span className="text-muted-foreground">(optional)</span>
              </Label>
              <textarea
                id="c-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                maxLength={2000}
                placeholder="Anything coaches should know about this competition."
                className="w-full rounded-lg border border-border bg-background p-3 text-sm"
                data-testid="input-competition-description"
              />
            </div>
            {endDate && startDate && endDate < startDate && (
              <p className="text-xs font-bold text-red-700">
                End date must be on or after the start date.
              </p>
            )}
            <Button
              type="submit"
              variant="brand"
              disabled={!canSubmit || create.isPending}
              data-testid="btn-create-competition"
            >
              {create.isPending ? "Creating…" : "Create & continue"}
            </Button>
          </form>
        )}

        {step === 2 && createdId && (
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">
              Give your public page a look. Upload your logo and we'll suggest
              brand colors straight from it — or pick one from the color wheel.
              You can skip this and edit branding any time from the console.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <BrandImageField
                label="Logo"
                value={logoUrl}
                onChange={setLogoUrl}
                kind="logo"
                idPrefix="wizard-logo"
              />
              <BrandColorField
                label="Primary color"
                value={brandColor}
                onChange={setBrandColor}
                logoUrl={logoUrl}
                idPrefix="wizard-brand"
              />
              <BrandColorField
                label="Secondary color"
                value={secondaryColor}
                onChange={setSecondaryColor}
                logoUrl={logoUrl}
                idPrefix="wizard-brand-secondary"
              />
              <BrandColorField
                label="Third color"
                value={tertiaryColor}
                onChange={setTertiaryColor}
                logoUrl={logoUrl}
                idPrefix="wizard-brand-tertiary"
              />
              <BrandImageField
                label="Banner"
                value={bannerUrl}
                onChange={setBannerUrl}
                kind="banner"
                idPrefix="wizard-banner"
              />
              <div className="space-y-1.5">
                <Label htmlFor="w-site" className="text-xs font-bold">
                  Official website
                </Label>
                <Input
                  id="w-site"
                  value={websiteUrl}
                  onChange={(e) => setWebsiteUrl(e.target.value)}
                  placeholder="https://mytournament.com"
                  data-testid="input-wizard-website-url"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                variant="brand"
                disabled={!colorOk || !brandingDirty || saveBranding.isPending}
                onClick={() => saveBranding.mutate()}
                data-testid="btn-wizard-save-branding"
              >
                {saveBranding.isPending ? "Saving…" : "Save & continue"}
              </Button>
              <Button
                variant="ghost"
                className="font-bold text-muted-foreground"
                onClick={() => setStep(3)}
                data-testid="btn-wizard-skip-branding"
              >
                Skip for now
              </Button>
            </div>
          </div>
        )}

        {step === 3 && createdId && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Upload the game schedule CSV. Re-uploading later is safe — games
              update in place and claimed teams keep their claims.
            </p>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void f.text().then(setCsv);
                e.target.value = "";
              }}
              data-testid="input-wizard-csv-file"
            />
            <Button
              type="button"
              variant="outline"
              className="w-full border-dashed font-bold"
              onClick={() => fileRef.current?.click()}
              data-testid="btn-wizard-csv-choose-file"
            >
              <Upload className="mr-2 h-4 w-4" />
              Choose CSV file from your computer
            </Button>
            <p className="text-center text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
              or paste the CSV below
            </p>
            <textarea
              value={csv}
              onChange={(e) => setCsv(e.target.value)}
              rows={6}
              placeholder="match #,date,start time,age,gender,division,bracket,venue,venue state,field,home team,home score,away team,away score"
              className="w-full rounded-lg border border-border bg-background p-3 font-mono text-xs"
              data-testid="input-wizard-csv"
            />
            <div className="flex gap-2">
              <Button
                variant="brand"
                disabled={!csv.trim() || importMut.isPending}
                onClick={() => importMut.mutate()}
                data-testid="btn-wizard-import"
              >
                {importMut.isPending ? "Uploading…" : "Upload & finish"}
              </Button>
              <Button
                variant="ghost"
                className="font-bold text-muted-foreground"
                onClick={() => finish(createdId)}
                data-testid="btn-wizard-skip-import"
              >
                Skip — go to console
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function CompetitionsPage() {
  const { data, isLoading, isError, refetch } = useQuery<{
    data: CompetitionRow[];
  }>({
    queryKey: ["my", "competitions"],
    queryFn: () =>
      customFetch<{ data: CompetitionRow[] }>(`/api/v1/my/competitions`, {
        method: "GET",
      }),
  });

  const competitions = data?.data ?? [];

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Competitions</h1>
        <p className="text-sm text-muted-foreground">
          Run a tournament or league on Kinectem: upload the schedule, brand
          your public page, and let every team tell its story.
        </p>
      </div>

      <CreateCompetitionCard />

      <div className="space-y-3">
        <h2 className="text-sm font-black uppercase tracking-widest text-muted-foreground">
          My competitions
        </h2>
        {isLoading ? (
          <Card>
            <CardContent className="p-8 text-center text-sm text-muted-foreground">
              Loading competitions…
            </CardContent>
          </Card>
        ) : isError ? (
          <Card className="border-destructive/40">
            <CardContent className="p-8 text-center space-y-3">
              <p className="text-sm text-muted-foreground">
                Couldn't load your competitions.
              </p>
              <Button
                variant="outline"
                className="font-bold rounded-full"
                onClick={() => refetch()}
                data-testid="btn-retry-competitions"
              >
                Try again
              </Button>
            </CardContent>
          </Card>
        ) : competitions.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="p-8 text-center text-sm text-muted-foreground">
              No competitions yet. Create your first one above.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {competitions.map((c) => (
              <Card key={c.id} data-testid={`card-competition-${c.id}`}>
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="font-black tracking-tight truncate">
                          {c.name}
                        </h3>
                        <Badge variant="outline" className="capitalize shrink-0">
                          {c.type}
                        </Badge>
                      </div>
                      <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                        <span className="flex items-center gap-1">
                          <CalendarDays className="w-3.5 h-3.5" />
                          {fmtDate(c.startDate)} – {fmtDate(c.endDate)}
                        </span>
                        {c.location && (
                          <span className="flex items-center gap-1">
                            <MapPin className="w-3.5 h-3.5" />
                            {c.location}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 flex-wrap">
                      {c.pendingClaimCount > 0 ? (
                        <Badge data-testid={`badge-pending-${c.id}`}>
                          {c.pendingClaimCount} claim
                          {c.pendingClaimCount === 1 ? "" : "s"} to review
                        </Badge>
                      ) : null}
                      <Badge variant="secondary">
                        {c.matchCount} games · {c.claimedCount}/
                        {c.participantCount} teams claimed
                      </Badge>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Link href={`/competitions/${c.id}`}>
                      <Button
                        size="sm"
                        variant="brand"
                        data-testid={`btn-manage-${c.id}`}
                      >
                        <Settings2 className="w-3.5 h-3.5 mr-1.5" />
                        Manage
                      </Button>
                    </Link>
                    <a
                      href={`/app/c/${c.slug}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Button
                        size="sm"
                        variant="outline"
                        className="font-bold rounded-full"
                        data-testid={`btn-view-${c.id}`}
                      >
                        <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
                        View public page
                      </Button>
                    </a>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
