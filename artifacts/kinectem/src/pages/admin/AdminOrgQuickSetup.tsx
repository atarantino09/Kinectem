import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { AdminLayout } from "@/components/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { US_STATES } from "@/lib/usStates";
import {
  shrinkImageToDataUrl,
  IMAGE_UPLOAD_MAX_BYTES,
} from "@/lib/shrinkImage";
import {
  BulkPairEditor,
  trimTrailingEmpty,
  type BulkPair,
} from "@/components/BulkPairEditor";
import { PLANS, type PlanTier } from "@/lib/plans";
import { extractBrandColorsFromDataUrl } from "@/lib/extractBrandColors";
import { X } from "lucide-react";

// Task #829 — One-page org quick setup for platform admins. Org info and the
// team/coach row list live on one scrollable form with a single Save at the
// end. The numbered two-column row editor IS the team list (5 rows shown,
// "show 5 more" to expand) — no separate per-team cards. Saving hits the
// atomic quick-setup endpoint, which creates the ownerless org + claim token
// + teams + staged coach drafts in one transaction — a validation error
// creates nothing. On success the operator gets the copyable claim link for
// the hand-off.

type NameMatch = {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  hasOwner: boolean;
  exact: boolean;
};
type NameCheckResponse = { data: NameMatch[] };

// Task #929 — operator-created named lists grouping ownerless orgs.
type OrgList = {
  id: string;
  name: string;
  orgCount: number;
  createdAt: string;
};
type OrgListsResponse = { data: OrgList[] };

// Task #831 — bulk entry. Each parsed line is a (team name, optional coach
// email) pair; lines with the same team name merge their coach emails onto
// one team row. Bad lines are reported by 1-based line number, never
// silently dropped.
export function pairsToTeamRows(
  pairs: Array<{ line: number; name: string; email: string }>,
): { teams: Array<{ name: string; coachEmails: string[] }>; errors: string[] } {
  const teams: Array<{ name: string; coachEmails: string[] }> = [];
  const byName = new Map<string, number>();
  const errors: string[] = [];
  for (const p of pairs) {
    const name = p.name.trim();
    const email = p.email.trim().toLowerCase();
    if (!name && !email) continue;
    if (!name) {
      errors.push(`Line ${p.line}: coach email has no team name`);
      continue;
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.push(
        `Line ${p.line}: "${p.email.trim()}" doesn't look like an email`,
      );
      continue;
    }
    const key = name.toLowerCase();
    let idx = byName.get(key);
    if (idx === undefined) {
      idx = teams.length;
      byName.set(key, idx);
      teams.push({ name, coachEmails: [] });
    }
    if (email && !teams[idx].coachEmails.includes(email)) {
      teams[idx].coachEmails.push(email);
    }
  }
  return { teams, errors };
}

type QuickSetupResult = {
  id: string;
  name: string;
  token: string;
  teams: Array<{ id: string; name: string }>;
  stagedCoachCount: number;
};

function claimUrl(token: string): string {
  return `${window.location.origin}${import.meta.env.BASE_URL}claim/${token}`;
}

export default function AdminOrgQuickSetup() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [orgName, setOrgName] = useState("");
  const [debounced, setDebounced] = useState("");
  const [city, setCity] = useState("");
  const [stateCode, setStateCode] = useState("");
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null);
  const [logoBusy, setLogoBusy] = useState(false);
  // Monotonic token so results from a superseded logo upload never land.
  const logoUploadSeq = useRef(0);
  const [primaryColor, setPrimaryColor] = useState<string | null>(null);
  const [secondaryColor, setSecondaryColor] = useState<string | null>(null);
  const [bulkPairs, setBulkPairs] = useState<BulkPair[]>([]);
  // Task #856 — optional staged plan tier. null = not picked (skipped):
  // nothing is sent and the org behaves exactly as before (Starter default).
  // Clicking the selected card again deselects it.
  const [tier, setTier] = useState<PlanTier | null>(null);
  // Staged promo code — validated against the promo catalog, stored on the
  // org, and auto-applied when the new owner sets up billing.
  const [promoInput, setPromoInput] = useState("");
  const [appliedPromo, setAppliedPromo] = useState<{
    code: string;
    description: string | null;
    discountType: string;
    discountValue: number;
  } | null>(null);
  const [promoChecking, setPromoChecking] = useState(false);
  const [promoError, setPromoError] = useState<string | null>(null);
  // The inline row editor below is the single source of truth for teams.
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [result, setResult] = useState<QuickSetupResult | null>(null);
  // Task #929 — optional list to file this org under at creation time.
  const [listId, setListId] = useState<string | null>(null);
  const { data: listsData } = useQuery<OrgListsResponse>({
    queryKey: ["admin", "org-lists"],
    queryFn: () =>
      customFetch<OrgListsResponse>(`/api/v1/admin/org-lists`, {
        method: "GET",
      }),
  });
  const lists = useMemo(() => listsData?.data ?? [], [listsData]);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(orgName.trim()), 250);
    return () => clearTimeout(t);
  }, [orgName]);

  const { data: nameCheck, isFetching: checking } = useQuery<NameCheckResponse>(
    {
      queryKey: ["admin", "org-name-check", debounced],
      enabled: debounced.length >= 2 && !result,
      queryFn: () =>
        customFetch<NameCheckResponse>(
          `/api/v1/admin/org-name-check?name=${encodeURIComponent(debounced)}`,
          { method: "GET" },
        ),
    },
  );
  const matches = useMemo(() => nameCheck?.data ?? [], [nameCheck]);
  const exactMatch = useMemo(
    () => matches.find((m) => m.exact) ?? null,
    [matches],
  );

  const applyPromoCode = async () => {
    const code = promoInput.trim();
    if (!code) return;
    setPromoChecking(true);
    setPromoError(null);
    try {
      const res = await customFetch<{
        valid: boolean;
        promo: NonNullable<typeof appliedPromo>;
      }>(`/api/v1/promo-codes/validate`, {
        method: "POST",
        body: JSON.stringify({ code }),
      });
      setAppliedPromo(res.promo);
    } catch {
      setAppliedPromo(null);
      setPromoError("That promo code isn't valid.");
    } finally {
      setPromoChecking(false);
    }
  };

  const onLogoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
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
    setLogoBusy(true);
    const uploadSeq = ++logoUploadSeq.current;
    try {
      const dataUrl = await shrinkImageToDataUrl(file);
      if (uploadSeq !== logoUploadSeq.current) return; // superseded upload
      setLogoDataUrl(dataUrl);
      // Auto-pick brand colors from the logo. The user can still change or
      // clear them with the pickers below — this is just a starting point.
      try {
        const colors = await extractBrandColorsFromDataUrl(dataUrl);
        if (uploadSeq !== logoUploadSeq.current) return; // superseded upload
        if (colors) {
          // Set BOTH so a one-color logo clears a stale secondary from a
          // previous upload.
          setPrimaryColor(colors.primary);
          setSecondaryColor(colors.secondary);
          toast({
            title: "Brand colors picked from the logo",
            description: "You can adjust or clear them below.",
          });
        }
      } catch {
        // Color extraction is best-effort; the logo itself still uploaded.
      }
    } catch {
      toast({ title: "Couldn't read that image", variant: "destructive" });
    } finally {
      setLogoBusy(false);
    }
  };

  // The row editor IS the team list — parse it live. Lines with the same
  // team name merge their coach emails onto one team; bad lines surface as
  // errors under the list and block Save.
  const parsedBulk = useMemo(
    () =>
      pairsToTeamRows(
        // Per-row extra coaches expand into additional entries with the same
        // team name and line number — pairsToTeamRows merges same-name rows'
        // coach emails onto one team.
        trimTrailingEmpty(bulkPairs).flatMap((p, i) => [
          { line: i + 1, name: p.name, email: p.email },
          ...(p.extraEmails ?? [])
            .filter((e) => e.trim())
            .map((e) => ({ line: i + 1, name: p.name, email: e })),
        ]),
      ),
    [bulkPairs],
  );
  const validTeams = parsedBulk.teams;
  const bulkErrors = parsedBulk.errors;
  const selectedPlan = useMemo(() => PLANS.find((p) => p.id === tier), [tier]);
  const canSave =
    orgName.trim().length > 0 && !exactMatch && !saving && !logoBusy;

  const save = async () => {
    if (!canSave) return;
    // Bad rows (orphan coach emails, malformed emails) block Save — they're
    // listed under the editor by line number, never silently dropped.
    if (bulkErrors.length > 0) {
      setSaveError("Fix the highlighted rows in the team list first.");
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const resp = await customFetch<{ data: QuickSetupResult }>(
        `/api/v1/admin/org-quick-setup`,
        {
          method: "POST",
          body: JSON.stringify({
            name: orgName.trim(),
            city: city.trim() || undefined,
            state: stateCode || undefined,
            logoUrl: logoDataUrl || undefined,
            brandPrimaryColor: primaryColor || undefined,
            brandSecondaryColor: secondaryColor || undefined,
            tier: tier ?? undefined,
            promoCode: appliedPromo?.code || undefined,
            listId: listId ?? undefined,
            teams: validTeams,
          }),
        },
      );
      setResult(resp.data);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin", "organizations"] }),
        queryClient.invalidateQueries({
          queryKey: ["admin", "org-claim-links"],
        }),
        queryClient.invalidateQueries({ queryKey: ["admin", "org-lists"] }),
      ]);
      try {
        await navigator.clipboard.writeText(claimUrl(resp.data.token));
        toast({
          title: `Created "${resp.data.name}"`,
          description: "Claim link copied to clipboard",
        });
      } catch {
        toast({ title: `Created "${resp.data.name}"` });
      }
    } catch (err) {
      // customFetch throws with the server's error message ("Team N: ...");
      // team order matches the numbered rows in the editor.
      const anyErr = err as { message?: string };
      setSaveError(anyErr?.message || "Couldn't save — please try again.");
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    setOrgName("");
    setDebounced("");
    setCity("");
    setStateCode("");
    setLogoDataUrl(null);
    setPrimaryColor(null);
    setSecondaryColor(null);
    setBulkPairs([]);
    setTier(null);
    setPromoInput("");
    setAppliedPromo(null);
    setPromoError(null);
    setResult(null);
    setSaveError(null);
  };

  const copyLink = async (token: string) => {
    try {
      await navigator.clipboard.writeText(claimUrl(token));
      toast({ title: "Claim link copied" });
    } catch {
      toast({
        title: "Couldn't copy — select and copy manually",
        variant: "destructive",
      });
    }
  };

  if (result) {
    return (
      <AdminLayout>
        <div className="max-w-2xl" data-testid="quick-setup-success">
          <h1 className="text-2xl font-black mb-1">"{result.name}" is ready</h1>
          <p className="text-sm text-muted-foreground mb-4">
            {result.teams.length} team{result.teams.length === 1 ? "" : "s"}{" "}
            created
            {result.stagedCoachCount > 0 &&
              ` · ${result.stagedCoachCount} coach email${result.stagedCoachCount === 1 ? "" : "s"} staged for the hand-off`}
            . No invites were sent — the new owner confirms coaches after
            claiming.
          </p>
          <div className="rounded-lg border bg-card p-4 mb-4">
            <div className="text-sm font-bold mb-1">Claim link</div>
            <p className="text-xs text-muted-foreground mb-2">
              Send this to the org admin — whoever signs up through it becomes
              the owner.
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              <code
                className="text-xs font-mono bg-muted rounded px-2 py-1 [overflow-wrap:anywhere]"
                data-testid="quick-setup-claim-link"
              >
                {claimUrl(result.token)}
              </code>
              <Button
                size="sm"
                onClick={() => copyLink(result.token)}
                data-testid="btn-quick-setup-copy-link"
              >
                Copy link
              </Button>
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              asChild
              variant="outline"
              data-testid="link-quick-setup-org-page"
            >
              <Link href={`/organizations/${result.id}`}>Open org page</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/admin/organizations?section=claim-links">
                Back to Organizations
              </Link>
            </Button>
            <Button onClick={reset} data-testid="btn-quick-setup-another">
              Set up another org
            </Button>
          </div>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="max-w-3xl">
        <div className="mb-5">
          <h1 className="text-2xl font-black">Org quick setup</h1>
          <p className="text-sm text-muted-foreground">
            Set up an entire organization for hand-off in one pass: org info,
            teams, and coach emails. Nothing is created until you hit Save at
            the bottom — then you get the claim link to send to the org admin.
          </p>
        </div>

        {/* ---- Org info ---- */}
        <section className="rounded-lg border bg-card p-4 mb-5">
          <h2 className="text-sm font-bold mb-3">Organization</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label htmlFor="qs-org-name">Name</Label>
              <Input
                id="qs-org-name"
                placeholder="e.g. Denville Baseball"
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                data-testid="input-qs-org-name"
              />
              {debounced.length >= 2 && (
                <div className="mt-1.5 text-xs" data-testid="qs-name-check">
                  {exactMatch ? (
                    <span
                      className="text-destructive font-medium"
                      data-testid="qs-duplicate-warning"
                    >
                      ⚠ "{exactMatch.name}" already exists
                      {exactMatch.hasOwner ? " (claimed)" : " (unclaimed)"} —
                      pick a different name.
                    </span>
                  ) : matches.length > 0 ? (
                    <span className="text-muted-foreground">
                      Similar:{" "}
                      {matches
                        .slice(0, 3)
                        .map((m) => m.name)
                        .join(", ")}
                    </span>
                  ) : checking ? (
                    <span className="text-muted-foreground">Checking…</span>
                  ) : (
                    <span className="text-emerald-600">
                      No matching organization.
                    </span>
                  )}
                </div>
              )}
            </div>
            <div>
              <Label htmlFor="qs-org-city">
                City{" "}
                <span className="text-muted-foreground font-normal">
                  (optional)
                </span>
              </Label>
              <Input
                id="qs-org-city"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                data-testid="input-qs-org-city"
              />
            </div>
            <div>
              <Label>
                State{" "}
                <span className="text-muted-foreground font-normal">
                  (optional)
                </span>
              </Label>
              <Select value={stateCode} onValueChange={setStateCode}>
                <SelectTrigger data-testid="select-qs-org-state">
                  <SelectValue placeholder="Select state" />
                </SelectTrigger>
                <SelectContent>
                  {US_STATES.map((s) => (
                    <SelectItem key={s.code} value={s.code}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="qs-org-logo">Logo (optional)</Label>
              <div className="flex items-center gap-3 mt-1">
                {logoDataUrl && (
                  <img
                    src={logoDataUrl}
                    alt="Logo preview"
                    className="h-12 w-12 rounded object-contain border bg-white"
                    data-testid="img-qs-logo-preview"
                  />
                )}
                <Input
                  id="qs-org-logo"
                  type="file"
                  accept="image/*"
                  onChange={onLogoChange}
                  disabled={logoBusy}
                  className="max-w-xs"
                  data-testid="input-qs-org-logo"
                />
                {logoDataUrl && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setLogoDataUrl(null)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
            <div className="sm:col-span-2">
              <Label>Brand colors (optional)</Label>
              <div className="flex flex-wrap items-center gap-5 mt-1">
                {(
                  [
                    ["Primary", primaryColor, setPrimaryColor, "primary"],
                    [
                      "Secondary",
                      secondaryColor,
                      setSecondaryColor,
                      "secondary",
                    ],
                  ] as const
                ).map(([label, value, set, id]) => (
                  <div key={id} className="flex items-center gap-2">
                    <input
                      type="color"
                      value={value ?? "#888888"}
                      onChange={(e) => set(e.target.value)}
                      className="h-9 w-12 cursor-pointer rounded border bg-transparent p-0.5"
                      aria-label={`${label} brand color`}
                      data-testid={`input-qs-color-${id}`}
                    />
                    <div className="text-xs">
                      <div className="font-medium">{label}</div>
                      <div className="text-muted-foreground font-mono">
                        {value ?? "not set"}
                      </div>
                    </div>
                    {value && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        onClick={() => set(null)}
                        aria-label={`Clear ${label.toLowerCase()} color`}
                        data-testid={`btn-qs-clear-color-${id}`}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
              {(primaryColor || secondaryColor) && (
                <div
                  className="mt-3 h-4 w-full max-w-md rounded-full border"
                  style={{
                    background: `linear-gradient(to right, ${primaryColor ?? secondaryColor}, ${secondaryColor ?? primaryColor})`,
                  }}
                  aria-label="Brand color preview"
                  data-testid="qs-color-preview"
                />
              )}
            </div>
          </div>
        </section>

        {/* ---- Plan tier (sets the team-count cap shown below) ---- */}
        <section className="rounded-lg border bg-card p-4 mb-5">
          <h2 className="text-sm font-bold mb-1">Plan tier (optional)</h2>
          <p className="text-xs text-muted-foreground mb-3">
            Tiers differ only in the number of teams. Picking one pre-selects it
            on the new owner's subscribe page (they can still change it) and
            sets the team cap below. Skip it to leave the choice entirely to
            them (Starter cap applies during setup).
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            {PLANS.map((p) => {
              const selected = tier === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setTier((cur) => (cur === p.id ? null : p.id))}
                  aria-pressed={selected}
                  className={`rounded-md border p-3 text-left transition-colors ${
                    selected
                      ? "border-primary ring-2 ring-primary/40 bg-primary/5"
                      : "hover:border-muted-foreground/40"
                  }`}
                  data-testid={`btn-qs-tier-${p.id}`}
                >
                  <div className="text-sm font-bold">{p.name}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {p.maxTeams != null
                      ? `Up to ${p.maxTeams} teams`
                      : "41+ teams (unlimited)"}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Task #929 — optional list to file this org under at creation. */}
          <div className="mt-4">
            <Label htmlFor="qs-list">List (optional)</Label>
            <p className="text-xs text-muted-foreground mb-1.5">
              Group this org under a named list (e.g. a league or tournament).
            </p>
            <Select
              value={listId ?? "__none__"}
              onValueChange={(v) => setListId(v === "__none__" ? null : v)}
            >
              <SelectTrigger className="max-w-xs" data-testid="select-qs-list">
                <SelectValue placeholder="No list" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">No list</SelectItem>
                {lists.map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Promo code — staged on the org; auto-applied when the new owner
              sets up billing, and shown on their claim page. */}
          <div className="mt-4 border-t pt-3">
            <Label htmlFor="qs-promo-code">Promo code (optional)</Label>
            <p className="text-xs text-muted-foreground mb-2">
              Applied automatically when the org admin accepts the page and sets
              up billing — they'll see it's already on their account.
            </p>
            {appliedPromo ? (
              <div
                className="flex items-center gap-2 text-sm"
                data-testid="qs-promo-applied"
              >
                <span className="rounded-md border border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/40 px-2 py-1 font-bold uppercase">
                  {appliedPromo.code}
                </span>
                <span className="text-muted-foreground">
                  {appliedPromo.discountType === "percent"
                    ? `${appliedPromo.discountValue}% off first year`
                    : `$${appliedPromo.discountValue} off first year`}
                  {appliedPromo.description
                    ? ` — ${appliedPromo.description}`
                    : ""}
                </span>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  onClick={() => {
                    setAppliedPromo(null);
                    setPromoInput("");
                    setPromoError(null);
                  }}
                  aria-label="Remove promo code"
                  data-testid="btn-qs-promo-clear"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2 max-w-sm">
                <Input
                  id="qs-promo-code"
                  value={promoInput}
                  onChange={(e) => {
                    setPromoInput(e.target.value);
                    setPromoError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void applyPromoCode();
                    }
                  }}
                  placeholder="e.g. FOUNDING50"
                  className="h-9"
                  data-testid="input-qs-promo-code"
                />
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void applyPromoCode()}
                  disabled={promoChecking || !promoInput.trim()}
                  data-testid="btn-qs-promo-apply"
                >
                  {promoChecking ? "Checking…" : "Apply"}
                </Button>
              </div>
            )}
            {promoError && (
              <p
                className="mt-1 text-xs text-destructive"
                data-testid="qs-promo-error"
              >
                {promoError}
              </p>
            )}
          </div>
        </section>

        {/* ---- Teams + coaches — the row editor IS the team list ---- */}
        <section className="rounded-lg border bg-card p-4 mb-5">
          <h2 className="text-sm font-bold mb-1">Teams &amp; coaches</h2>
          <p className="text-xs text-muted-foreground mb-3">
            One team per line, with an optional coach email on the same line of
            the second column. Repeat a team name on another line to add more
            coaches to it. Paste a multi-line list into either column or upload
            a CSV. Coach emails are staged as drafts — no invites are sent; the
            org admin reviews and sends them after claiming the page.
          </p>
          <BulkPairEditor
            pairs={bulkPairs}
            onPairsChange={setBulkPairs}
            idPrefix="qs-bulk"
            listMaxHeightClass="max-h-none"
          />
          <div className="mt-2 flex justify-end">
            <span
              className="text-xs font-medium text-muted-foreground"
              data-testid="text-qs-team-count"
            >
              {selectedPlan
                ? selectedPlan.maxTeams != null
                  ? `${validTeams.length}/${selectedPlan.maxTeams} teams`
                  : `${validTeams.length} team${validTeams.length === 1 ? "" : "s"}`
                : `${validTeams.length}/15 teams (Starter cap until the org picks a plan)`}
            </span>
          </div>
          {bulkErrors.length > 0 && (
            <ul
              className="mt-2 space-y-0.5 text-xs text-destructive"
              data-testid="qs-bulk-errors"
            >
              {bulkErrors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}
        </section>

        {/* ---- Save ---- */}
        {saveError && (
          <p
            className="text-sm font-medium text-destructive mb-3"
            data-testid="qs-save-error"
          >
            {saveError}
          </p>
        )}
        <div className="flex items-center gap-3 pb-10">
          <Button
            onClick={save}
            disabled={!canSave}
            size="lg"
            data-testid="btn-qs-save"
          >
            {saving ? "Saving…" : "Save everything"}
          </Button>
          <span className="text-xs text-muted-foreground">
            Creates the org, {validTeams.length} team
            {validTeams.length === 1 ? "" : "s"}, and staged coach drafts in one
            shot.
          </span>
        </div>
      </div>
    </AdminLayout>
  );
}
