import { useEffect, useRef, useState } from "react";
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
import { Trophy, CalendarDays, MapPin, ExternalLink, Settings2, Upload, Building2 } from "lucide-react";

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
  organizerId: string | null;
  matchCount: number;
  participantCount: number;
  claimedCount: number;
  pendingClaimCount: number;
  createdAt: string;
}

// Task #723 — organizer hub ("parent company") rows from GET /my/organizers.
interface OrganizerRow {
  id: string;
  slug: string;
  name: string;
  logoUrl: string | null;
  brandColor: string | null;
  secondaryColor: string | null;
  tertiaryColor: string | null;
  bannerUrl: string | null;
  websiteUrl: string | null;
  competitionCount: number;
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
function CreateCompetitionCard({
  organizers,
  initialOrganizerId,
}: {
  organizers: OrganizerRow[];
  initialOrganizerId: string | null;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [createdId, setCreatedId] = useState<string | null>(null);
  // Task #723 — create-from-hub: preselected via ?organizer=<id> from the
  // hub page; branding is inherited server-side at creation time.
  const [organizerId, setOrganizerId] = useState<string>(
    initialOrganizerId ?? "",
  );
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
  const [pasteOpen, setPasteOpen] = useState(false);
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
          organizerId: organizerId || null,
        }),
      }),
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: ["my", "competitions"] });
      setCreatedId(row.id);
      // Create-from-hub: the server copied the hub's branding onto the new
      // competition. Hydrate step 2 with the same values so a partial edit
      // + save doesn't wipe the inherited fields back to null.
      const hub = organizerId
        ? organizers.find((o) => o.id === organizerId)
        : undefined;
      if (hub) {
        setBrandColor(hub.brandColor ?? "");
        setSecondaryColor(hub.secondaryColor ?? "");
        setTertiaryColor(hub.tertiaryColor ?? "");
        setLogoUrl(hub.logoUrl ?? "");
        setBannerUrl(hub.bannerUrl ?? "");
        setWebsiteUrl(hub.websiteUrl ?? "");
      }
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
    mutationFn: (csvText: string) =>
      customFetch<{ matchesUpserted: number; participantCount: number }>(
        `/api/v1/competitions/${createdId}/import`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ csv: csvText }),
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
            {organizers.length > 0 && (
              <div className="space-y-1.5">
                <Label htmlFor="c-organizer" className="text-xs font-bold">
                  Organizer hub{" "}
                  <span className="text-muted-foreground">(optional)</span>
                </Label>
                <select
                  id="c-organizer"
                  value={organizerId}
                  onChange={(e) => setOrganizerId(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  data-testid="select-competition-organizer"
                >
                  <option value="">Standalone (no hub)</option>
                  {organizers.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
                {organizerId ? (
                  <p className="text-xs text-muted-foreground">
                    Starts with your hub's branding — you can still customize
                    it in the next step.
                  </p>
                ) : null}
              </div>
            )}
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
                if (f)
                  void f.text().then((text) => {
                    setCsv(text);
                    importMut.mutate(text);
                  });
                e.target.value = "";
              }}
              data-testid="input-wizard-csv-file"
            />
            <Button
              type="button"
              variant="brand"
              size="lg"
              className="w-full font-bold"
              disabled={importMut.isPending}
              onClick={() => fileRef.current?.click()}
              data-testid="btn-wizard-csv-choose-file"
            >
              <Upload className="mr-2 h-4 w-4" />
              {importMut.isPending
                ? "Uploading your schedule…"
                : "Upload schedule file"}
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              Pick the CSV your scheduling tool exported — we'll read it and
              set up the games automatically.
            </p>
            {!pasteOpen ? (
              <button
                type="button"
                className="mx-auto block text-[11px] font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground"
                onClick={() => setPasteOpen(true)}
                data-testid="btn-wizard-csv-paste-toggle"
              >
                Or paste the CSV text instead
              </button>
            ) : (
              <>
                <textarea
                  value={csv}
                  onChange={(e) => setCsv(e.target.value)}
                  rows={6}
                  placeholder="match #,date,start time,age,gender,division,bracket,venue,venue state,field,home team,home score,away team,away score"
                  className="w-full rounded-lg border border-border bg-background p-3 font-mono text-xs"
                  data-testid="input-wizard-csv"
                />
                <Button
                  variant="outline"
                  className="font-bold"
                  disabled={!csv.trim() || importMut.isPending}
                  onClick={() => importMut.mutate(csv)}
                  data-testid="btn-wizard-import"
                >
                  {importMut.isPending ? "Uploading…" : "Upload pasted CSV"}
                </Button>
              </>
            )}
            <div className="flex gap-2">
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

// Task #723 — organizer hub section: list my hubs + create a new one.
// A hub is the "parent company" that groups competitions under one brand.
function OrganizerHubCard({ organizers }: { organizers: OrganizerRow[] }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const create = useMutation({
    mutationFn: () =>
      customFetch<OrganizerRow>(`/api/v1/organizers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
        }),
      }),
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: ["my", "organizers"] });
      toast({ title: "Organizer hub created" });
      navigate(`/competitions/o/${row.slug}`);
    },
    onError: (err) =>
      toast({
        title: "Couldn't create the hub",
        description:
          err instanceof Error ? err.message : "Check the details and try again.",
        variant: "destructive",
      }),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Building2 className="w-4 h-4" />
          Organizer hubs
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          A home base for your company — group all your competitions under one
          brand with a shareable public page.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {organizers.map((o) => (
          <div
            key={o.id}
            className="flex items-center justify-between gap-3 rounded-lg border border-border p-3"
            data-testid={`row-organizer-${o.id}`}
          >
            <div className="flex items-center gap-2 min-w-0">
              {o.logoUrl ? (
                <img
                  src={o.logoUrl}
                  alt=""
                  className="h-8 w-8 rounded-lg object-contain bg-white shrink-0"
                />
              ) : (
                <Building2 className="h-5 w-5 text-muted-foreground shrink-0" />
              )}
              <div className="min-w-0">
                <p className="font-black tracking-tight truncate">{o.name}</p>
                <p className="text-xs text-muted-foreground">
                  {o.competitionCount} competition
                  {o.competitionCount === 1 ? "" : "s"}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Link href={`/competitions/o/${o.slug}`}>
                <Button
                  size="sm"
                  variant="outline"
                  className="font-bold rounded-full"
                  data-testid={`btn-open-hub-${o.id}`}
                >
                  Open hub
                </Button>
              </Link>
            </div>
          </div>
        ))}
        {formOpen ? (
          <form
            className="space-y-3 rounded-lg border border-dashed border-border p-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim() && !create.isPending) create.mutate();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="o-name" className="text-xs font-bold">
                Company name
              </Label>
              <Input
                id="o-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Apex Events Co"
                maxLength={200}
                data-testid="input-organizer-name"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="o-desc" className="text-xs font-bold">
                About <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="o-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What your company runs and where."
                maxLength={2000}
                data-testid="input-organizer-description"
              />
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="submit"
                size="sm"
                variant="brand"
                disabled={!name.trim() || create.isPending}
                data-testid="btn-create-organizer"
              >
                {create.isPending ? "Creating…" : "Create hub"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setFormOpen(false)}
                data-testid="btn-cancel-organizer"
              >
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="font-bold rounded-full"
            onClick={() => setFormOpen(true)}
            data-testid="btn-new-organizer"
          >
            <Building2 className="w-3.5 h-3.5 mr-1.5" />
            New organizer hub
          </Button>
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

  const organizersQ = useQuery<{ data: OrganizerRow[] }>({
    queryKey: ["my", "organizers"],
    queryFn: () =>
      customFetch<{ data: OrganizerRow[] }>(`/api/v1/my/organizers`, {
        method: "GET",
      }),
  });
  const organizers = organizersQ.data?.data ?? [];

  // Create-from-hub deep link: /competitions?organizer=<id>
  const initialOrganizerId =
    new URLSearchParams(window.location.search).get("organizer") ?? null;

  // Top-bar "Organizer Hubs" deep link: /competitions?hubs=1 scrolls to the
  // hub card once it has rendered.
  const wantHubs =
    new URLSearchParams(window.location.search).get("hubs") === "1";
  const hubCardRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (wantHubs && !organizersQ.isLoading && hubCardRef.current) {
      hubCardRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [wantHubs, organizersQ.isLoading]);

  const competitions = data?.data ?? [];

  // Group my competitions by organizer hub; standalone ones last.
  const grouped = organizers
    .map((o) => ({
      organizer: o,
      comps: competitions.filter((c) => c.organizerId === o.id),
    }))
    .filter((g) => g.comps.length > 0);
  const knownOrganizerIds = new Set(organizers.map((o) => o.id));
  const standalone = competitions.filter(
    (c) => !c.organizerId || !knownOrganizerIds.has(c.organizerId),
  );

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Competitions</h1>
        <p className="text-sm text-muted-foreground">
          Run a tournament or league on Kinectem: upload the schedule, brand
          your public page, and let every team tell its story.
        </p>
      </div>

      <CreateCompetitionCard
        organizers={organizers}
        initialOrganizerId={initialOrganizerId}
      />

      <div ref={hubCardRef} className="scroll-mt-20">
        <OrganizerHubCard organizers={organizers} />
      </div>

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
          <div className="space-y-5">
            {/* Grouped by organizer hub first, then standalone. */}
            {grouped.map(({ organizer: o, comps }) => (
              <div key={o.id} className="space-y-3" data-testid={`group-hub-${o.id}`}>
                <Link href={`/competitions/o/${o.slug}`}>
                  <span className="inline-flex items-center gap-1.5 text-xs font-black uppercase tracking-widest text-muted-foreground hover:text-foreground cursor-pointer">
                    <Building2 className="w-3.5 h-3.5" />
                    {o.name}
                  </span>
                </Link>
                {comps.map((c) => (
                  <MyCompetitionCard key={c.id} c={c} organizers={organizers} />
                ))}
              </div>
            ))}
            {standalone.length > 0 && (
              <div className="space-y-3" data-testid="group-standalone">
                {grouped.length > 0 && (
                  <span className="inline-flex items-center gap-1.5 text-xs font-black uppercase tracking-widest text-muted-foreground">
                    Standalone
                  </span>
                )}
                {standalone.map((c) => (
                  <MyCompetitionCard key={c.id} c={c} organizers={organizers} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// One row in "My competitions" — includes attach/detach to an organizer hub
// (retroactive grouping, Task #723).
function MyCompetitionCard({
  c,
  organizers,
}: {
  c: CompetitionRow;
  organizers: OrganizerRow[];
}) {
  const qc = useQueryClient();
  const { toast } = useToast();

  const link = useMutation({
    mutationFn: (vars: { organizerId: string; action: "attach" | "detach" }) =>
      customFetch(`/api/v1/organizers/${vars.organizerId}/competitions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          competitionId: c.id,
          attach: vars.action === "attach",
        }),
      }),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["my", "competitions"] });
      qc.invalidateQueries({ queryKey: ["my", "organizers"] });
      qc.invalidateQueries({ queryKey: ["organizer"] });
      toast({
        title:
          vars.action === "attach" ? "Added to your hub" : "Removed from hub",
      });
    },
    onError: (err) =>
      toast({
        title: "Couldn't update the hub link",
        description: err instanceof Error ? err.message : "Try again.",
        variant: "destructive",
      }),
  });

  return (
    <UngroupedCompetitionCard c={c}>
      {organizers.length > 0 &&
        (c.organizerId ? (
          <Button
            size="sm"
            variant="ghost"
            className="text-muted-foreground"
            disabled={link.isPending}
            onClick={() =>
              link.mutate({ organizerId: c.organizerId!, action: "detach" })
            }
            data-testid={`btn-detach-hub-${c.id}`}
          >
            Remove from hub
          </Button>
        ) : organizers.length === 1 ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={link.isPending}
            onClick={() =>
              link.mutate({ organizerId: organizers[0].id, action: "attach" })
            }
            data-testid={`btn-attach-hub-${c.id}`}
          >
            <Building2 className="w-3.5 h-3.5 mr-1.5" />
            Add to {organizers[0].name}
          </Button>
        ) : (
          <select
            className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs font-bold"
            value=""
            disabled={link.isPending}
            onChange={(e) => {
              if (e.target.value)
                link.mutate({ organizerId: e.target.value, action: "attach" });
            }}
            data-testid={`select-attach-hub-${c.id}`}
          >
            <option value="">Add to hub…</option>
            {organizers.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        ))}
    </UngroupedCompetitionCard>
  );
}

function UngroupedCompetitionCard({
  c,
  children,
}: {
  c: CompetitionRow;
  children?: React.ReactNode;
}) {
  return (
    <Card data-testid={`card-competition-${c.id}`}>
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
                    {children}
                  </div>
                </CardContent>
              </Card>
  );
}
