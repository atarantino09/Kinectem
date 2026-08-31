import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { BrandColorField } from "@/components/BrandColorField";
import { BrandImageField } from "@/components/BrandImageField";
import { NewHubDialog, OrganizerSidebar } from "@/components/OrganizerSidebar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useWhoami } from "@/hooks/useWhoami";
import { Building2, Search, ShieldCheck, Trophy, Upload } from "lucide-react";

// Competitions §4 — self-serve competition creation. Any signed-in user can
// create a tournament or league they operate; the per-competition console
// lives at /competitions/:id. The old "Competition hub" card and "My
// competitions" list moved into the collapsible OrganizerSidebar (Task #745).
// customFetch — these routes are outside the locked openapi.yaml.

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

function PlatformAdminCompetitionFinder() {
  const [query, setQuery] = useState("");
  const trimmedQuery = query.trim();
  const [debouncedQuery, setDebouncedQuery] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(trimmedQuery), 250);
    return () => window.clearTimeout(timer);
  }, [trimmedQuery]);
  const resultsQ = useQuery<{ data: CompetitionRow[] }>({
    queryKey: ["admin", "competitions", debouncedQuery],
    queryFn: () =>
      customFetch<{ data: CompetitionRow[] }>(
        `/api/v1/admin/competitions?q=${encodeURIComponent(debouncedQuery)}`,
        { method: "GET" },
      ),
    enabled: debouncedQuery.length >= 2,
  });

  return (
    <Card className="border-primary/30" data-testid="card-admin-competition-finder">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="h-4 w-4 text-primary" />
          Platform admin access
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Find any competition and open its full management console to help its
          organizer.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search competitions by name or ID…"
            className="pl-9"
            data-testid="input-admin-competition-search"
          />
        </div>
        {trimmedQuery.length < 2 ? (
          <p className="text-xs text-muted-foreground">
            Enter at least 2 characters.
          </p>
        ) : debouncedQuery !== trimmedQuery || resultsQ.isLoading ? (
          <p className="text-sm text-muted-foreground">Searching…</p>
        ) : resultsQ.isError ? (
          <p className="text-sm text-destructive">
            Competitions couldn't be loaded. Try again.
          </p>
        ) : (resultsQ.data?.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No competitions match that search.
          </p>
        ) : (
          <div className="divide-y divide-border rounded-lg border">
            {(resultsQ.data?.data ?? []).map((competition) => (
              <div
                key={competition.id}
                className="flex items-center gap-3 p-3"
                data-testid={`row-admin-competition-${competition.id}`}
              >
                <Trophy className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold">
                    {competition.name}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    <span className="capitalize">{competition.type}</span>
                    {competition.location ? ` · ${competition.location}` : ""}
                  </p>
                </div>
                <Link
                  href={`/competitions/${competition.id}`}
                  data-testid={`link-admin-competition-${competition.id}`}
                >
                  <Button size="sm" variant="outline" className="font-bold">
                    Open console
                  </Button>
                </Link>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
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
  const [websiteUrl, setWebsiteUrl] = useState("");
  // Step 3 — schedule
  const [csv, setCsv] = useState("");
  const [pasteOpen, setPasteOpen] = useState(false);
  // First-time organizers can create a hub inline without leaving the wizard.
  const [newHubOpen, setNewHubOpen] = useState(false);
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
            <div className="space-y-1.5">
              <Label htmlFor="c-organizer" className="text-xs font-bold">
                Competition hub{" "}
                <span className="text-muted-foreground">(optional)</span>
              </Label>
              {organizers.length === 0 ? (
                <div
                  className="rounded-lg border border-dashed border-border bg-muted/40 p-3 space-y-2"
                  data-testid="hub-intro-empty"
                >
                  <p className="text-xs text-muted-foreground">
                    A <strong className="text-foreground">competition hub</strong>{" "}
                    is a home base for your company or organization — it groups
                    all your tournaments and leagues under one brand with a
                    shareable public page, and new competitions start with your
                    hub's branding automatically.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="font-bold"
                    onClick={() => setNewHubOpen(true)}
                    data-testid="btn-create-hub-inline"
                  >
                    <Building2 className="w-4 h-4 mr-1.5" /> Create a competition
                    hub
                  </Button>
                  <p className="text-[11px] text-muted-foreground">
                    Running a one-off event? Skip this — your competition will be
                    standalone.
                  </p>
                </div>
              ) : (
                <>
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
                  <button
                    type="button"
                    onClick={() => setNewHubOpen(true)}
                    className="text-xs font-bold text-primary hover:underline"
                    data-testid="btn-create-hub-inline"
                  >
                    + New competition hub
                  </button>
                </>
              )}
            </div>
            <NewHubDialog
              open={newHubOpen}
              onOpenChange={setNewHubOpen}
              onCreated={(row) => {
                qc.invalidateQueries({ queryKey: ["my", "organizers"] });
                setOrganizerId(row.id);
              }}
            />
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

export default function CompetitionsPage() {
  const { data: whoami } = useWhoami();
  const effectiveRole = whoami?.isMasquerading
    ? whoami.viewingAs?.role
    : whoami?.realUser?.role;
  const isPlatformAdmin = effectiveRole === "admin";
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

  return (
    <OrganizerSidebar>
      <div className="max-w-3xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Competitions
          </h1>
          <p className="text-sm text-muted-foreground">
            Run a tournament or league on Kinectem: upload the schedule, brand
            your public page, and let every team tell its story. Your hubs and
            competitions live in the sidebar.
          </p>
        </div>

        {isPlatformAdmin ? <PlatformAdminCompetitionFinder /> : null}

        <CreateCompetitionCard
          organizers={organizers}
          initialOrganizerId={initialOrganizerId}
        />
      </div>
    </OrganizerSidebar>
  );
}
