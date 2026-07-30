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
import { PLANS } from "@/lib/plans";
import { extractBrandColorsFromDataUrl } from "@/lib/extractBrandColors";
import { X, Plus, Trash2 } from "lucide-react";

// Task #829 — One-page org quick setup for platform admins. Org info, bulk
// team rows, and per-team coach emails all live on one scrollable form with a
// single Save at the end. Saving hits the atomic quick-setup endpoint, which
// creates the ownerless org + claim token + teams + staged coach drafts in
// one transaction — a validation error creates nothing and highlights the
// offending row. On success the operator gets the copyable claim link for
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

type TeamRow = {
  key: number;
  name: string;
  coachEmails: string[];
};

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
      errors.push(`Line ${p.line}: "${p.email.trim()}" doesn't look like an email`);
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

// The new-org tier's team cap (same source of truth the server enforces —
// a quick-setup org starts on the entry plan until the owner upgrades).
const STARTER_TEAM_CAP = PLANS.find((p) => p.id === "starter")?.maxTeams ?? null;

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

let nextKey = 1;
function emptyTeam(): TeamRow {
  return { key: nextKey++, name: "", coachEmails: [""] };
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
  const [bulkErrors, setBulkErrors] = useState<string[]>([]);
  const [teamRows, setTeamRows] = useState<TeamRow[]>([emptyTeam()]);
  const [saving, setSaving] = useState(false);
  const [errorTeamIndex, setErrorTeamIndex] = useState<number | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [result, setResult] = useState<QuickSetupResult | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(orgName.trim()), 250);
    return () => clearTimeout(t);
  }, [orgName]);

  const { data: nameCheck, isFetching: checking } = useQuery<NameCheckResponse>({
    queryKey: ["admin", "org-name-check", debounced],
    enabled: debounced.length >= 2 && !result,
    queryFn: () =>
      customFetch<NameCheckResponse>(
        `/api/v1/admin/org-name-check?name=${encodeURIComponent(debounced)}`,
        { method: "GET" },
      ),
  });
  const matches = useMemo(() => nameCheck?.data ?? [], [nameCheck]);
  const exactMatch = useMemo(() => matches.find((m) => m.exact) ?? null, [matches]);

  const updateTeam = (key: number, patch: Partial<TeamRow>) => {
    setTeamRows((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };
  const updateCoachEmail = (key: number, idx: number, value: string) => {
    setTeamRows((rows) =>
      rows.map((r) =>
        r.key === key
          ? { ...r, coachEmails: r.coachEmails.map((e, i) => (i === idx ? value : e)) }
          : r,
      ),
    );
  };
  const addCoachRow = (key: number) => {
    setTeamRows((rows) =>
      rows.map((r) => (r.key === key ? { ...r, coachEmails: [...r.coachEmails, ""] } : r)),
    );
  };
  const removeCoachRow = (key: number, idx: number) => {
    setTeamRows((rows) =>
      rows.map((r) =>
        r.key === key
          ? { ...r, coachEmails: r.coachEmails.filter((_, i) => i !== idx) }
          : r,
      ),
    );
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

  // Task #831/#832 — merge the row-list editor's pairs into the editable
  // team rows. Teams that already exist (by name, case-insensitive) get the
  // new coach emails appended; new teams are added as rows. Blank starter
  // rows are dropped. Bad rows STAY in the editor (renumbered) with their
  // errors listed, so nothing is silently lost.
  const applyBulk = () => {
    const numbered = trimTrailingEmpty(bulkPairs).map((p, i) => ({
      line: i + 1,
      name: p.name,
      email: p.email,
    }));
    const { teams: parsed, errors } = pairsToTeamRows(numbered);
    const badLines = new Set(
      errors
        .map((e) => parseInt(/^Line (\d+)/.exec(e)?.[1] ?? "0", 10))
        .filter(Boolean),
    );
    // Keep only the failing rows in the editor, renumbered from 1, and
    // regenerate the error messages so line numbers match what's shown.
    const kept = numbered
      .filter((p) => badLines.has(p.line))
      .map((p) => ({ name: p.name, email: p.email }));
    setBulkPairs(kept);
    setBulkErrors(
      pairsToTeamRows(kept.map((p, i) => ({ line: i + 1, ...p }))).errors,
    );
    if (parsed.length === 0) {
      if (errors.length === 0) {
        toast({
          title: "No rows to add",
          description:
            "Expected a team name first, then an optional coach email.",
          variant: "destructive",
        });
      }
      return;
    }
    setTeamRows((rows) => {
      const next = rows.filter(
        (r) => r.name.trim() || r.coachEmails.some((e) => e.trim()),
      );
      const byName = new Map<string, number>();
      next.forEach((r, i) => {
        if (r.name.trim()) byName.set(r.name.trim().toLowerCase(), i);
      });
      for (const t of parsed) {
        const key = t.name.toLowerCase();
        const at = byName.get(key);
        if (at !== undefined) {
          const existing = next[at].coachEmails
            .map((e) => e.trim().toLowerCase())
            .filter(Boolean);
          const merged = [
            ...next[at].coachEmails.filter((e) => e.trim()),
            ...t.coachEmails.filter((e) => !existing.includes(e)),
          ];
          next[at] = { ...next[at], coachEmails: merged.length ? merged : [""] };
        } else {
          byName.set(key, next.length);
          next.push({
            key: nextKey++,
            name: t.name,
            coachEmails: t.coachEmails.length ? t.coachEmails : [""],
          });
        }
      }
      return next.length ? next : [emptyTeam()];
    });
    toast({
      title: `Added ${parsed.length} team${parsed.length === 1 ? "" : "s"} to the list`,
      description:
        errors.length > 0
          ? `${errors.length} row${errors.length === 1 ? "" : "s"} kept above — see the errors below.`
          : "Review the rows below, then Save.",
      variant: errors.length > 0 ? "destructive" : undefined,
    });
  };

  const validTeams = useMemo(
    () => teamRows.filter((t) => t.name.trim().length > 0),
    [teamRows],
  );
  // Live projected total against the entry-tier cap: teams already in the
  // list plus NEW names currently sitting in the bulk editor.
  const bulkNewCount = useMemo(() => {
    const parsed = pairsToTeamRows(
      trimTrailingEmpty(bulkPairs).map((p, i) => ({ line: i + 1, ...p })),
    ).teams;
    const existing = new Set(validTeams.map((t) => t.name.trim().toLowerCase()));
    return parsed.filter((t) => !existing.has(t.name.toLowerCase())).length;
  }, [bulkPairs, validTeams]);
  const projectedTeams = validTeams.length + bulkNewCount;
  const canSave =
    orgName.trim().length > 0 && !exactMatch && !saving && !logoBusy;

  const save = async () => {
    if (!canSave) return;
    // Ignore fully-blank team rows, but block a coach email on a blank team
    // row (it would be silently dropped otherwise).
    const orphan = teamRows.findIndex(
      (t) => !t.name.trim() && t.coachEmails.some((e) => e.trim()),
    );
    if (orphan !== -1) {
      setErrorTeamIndex(orphan);
      setSaveError("This team has coach emails but no team name.");
      return;
    }
    setSaving(true);
    setSaveError(null);
    setErrorTeamIndex(null);
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
            teams: validTeams.map((t) => ({
              name: t.name.trim(),
              coachEmails: t.coachEmails.map((e) => e.trim()).filter(Boolean),
            })),
          }),
        },
      );
      setResult(resp.data);
      await queryClient.invalidateQueries({ queryKey: ["admin", "org-claim-links"] });
      try {
        await navigator.clipboard.writeText(claimUrl(resp.data.token));
        toast({ title: `Created "${resp.data.name}"`, description: "Claim link copied to clipboard" });
      } catch {
        toast({ title: `Created "${resp.data.name}"` });
      }
    } catch (err) {
      // customFetch throws with the server's error message; the endpoint
      // also returns `index` for per-team errors, surfaced when available.
      const anyErr = err as { message?: string; index?: number; data?: { index?: number } };
      const idx =
        typeof anyErr?.index === "number"
          ? anyErr.index
          : typeof anyErr?.data?.index === "number"
            ? anyErr.data.index
            : null;
      // Server messages are prefixed "Team N: ..." — recover N when the
      // structured index didn't survive the client error path. The server
      // index counts non-blank teams, so map back to the visible row.
      let visibleIdx = idx;
      if (visibleIdx === null && anyErr?.message) {
        const m = /^Team (\d+):/.exec(anyErr.message);
        if (m) visibleIdx = parseInt(m[1], 10) - 1;
      }
      if (visibleIdx !== null && validTeams[visibleIdx]) {
        const key = validTeams[visibleIdx].key;
        setErrorTeamIndex(teamRows.findIndex((t) => t.key === key));
      }
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
    setBulkErrors([]);
    setTeamRows([emptyTeam()]);
    setResult(null);
    setSaveError(null);
    setErrorTeamIndex(null);
  };

  const copyLink = async (token: string) => {
    try {
      await navigator.clipboard.writeText(claimUrl(token));
      toast({ title: "Claim link copied" });
    } catch {
      toast({ title: "Couldn't copy — select and copy manually", variant: "destructive" });
    }
  };

  if (result) {
    return (
      <AdminLayout>
        <div className="max-w-2xl" data-testid="quick-setup-success">
          <h1 className="text-2xl font-black mb-1">"{result.name}" is ready</h1>
          <p className="text-sm text-muted-foreground mb-4">
            {result.teams.length} team{result.teams.length === 1 ? "" : "s"} created
            {result.stagedCoachCount > 0 &&
              ` · ${result.stagedCoachCount} coach email${result.stagedCoachCount === 1 ? "" : "s"} staged for the hand-off`}
            . No invites were sent — the new owner confirms coaches after claiming.
          </p>
          <div className="rounded-lg border bg-card p-4 mb-4">
            <div className="text-sm font-bold mb-1">Claim link</div>
            <p className="text-xs text-muted-foreground mb-2">
              Send this to the org admin — whoever signs up through it becomes the owner.
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              <code
                className="text-xs font-mono bg-muted rounded px-2 py-1 [overflow-wrap:anywhere]"
                data-testid="quick-setup-claim-link"
              >
                {claimUrl(result.token)}
              </code>
              <Button size="sm" onClick={() => copyLink(result.token)} data-testid="btn-quick-setup-copy-link">
                Copy link
              </Button>
            </div>
          </div>
          <div className="flex gap-2">
            <Button asChild variant="outline" data-testid="link-quick-setup-org-page">
              <Link href={`/organizations/${result.id}`}>Open org page</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/admin/org-claim-links">Back to claim links</Link>
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
                    <span className="text-destructive font-medium" data-testid="qs-duplicate-warning">
                      ⚠ "{exactMatch.name}" already exists
                      {exactMatch.hasOwner ? " (claimed)" : " (unclaimed)"} — pick a different name.
                    </span>
                  ) : matches.length > 0 ? (
                    <span className="text-muted-foreground">
                      Similar: {matches.slice(0, 3).map((m) => m.name).join(", ")}
                    </span>
                  ) : checking ? (
                    <span className="text-muted-foreground">Checking…</span>
                  ) : (
                    <span className="text-emerald-600">No matching organization.</span>
                  )}
                </div>
              )}
            </div>
            <div>
              <Label htmlFor="qs-org-city">City</Label>
              <Input
                id="qs-org-city"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                data-testid="input-qs-org-city"
              />
            </div>
            <div>
              <Label>State</Label>
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
                  <Button size="sm" variant="ghost" onClick={() => setLogoDataUrl(null)}>
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
                    ["Secondary", secondaryColor, setSecondaryColor, "secondary"],
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
            </div>
          </div>
        </section>

        {/* ---- Teams + coaches ---- */}
        <section className="rounded-lg border bg-card p-4 mb-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold">Teams &amp; coaches</h2>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setTeamRows((r) => [...r, emptyTeam()])}
              data-testid="btn-qs-add-team"
            >
              <Plus className="h-4 w-4 mr-1" /> Add team
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            Coach emails are staged as drafts — no invites are sent. The org
            admin reviews and sends them after claiming the page.
          </p>

          {/* ---- Bulk add (Task #831/#832) — shared row-list editor ---- */}
          <div className="rounded-md border border-dashed p-3 mb-4 bg-muted/30">
            <div className="text-xs font-bold mb-1">Bulk add</div>
            <p className="text-xs text-muted-foreground mb-2">
              One team per line, with an optional coach email on the same line
              of the second column. Repeat a team name on another line to add
              more coaches to it. Paste a multi-line list into either column
              or upload a CSV.
            </p>
            <BulkPairEditor
              pairs={bulkPairs}
              onPairsChange={setBulkPairs}
              idPrefix="qs-bulk"
              minRows={5}
              listMaxHeightClass="max-h-64"
            />
            <div className="mt-2 flex items-center justify-between gap-3">
              <Button
                size="sm"
                variant="secondary"
                onClick={applyBulk}
                disabled={trimTrailingEmpty(bulkPairs).length === 0}
                data-testid="btn-qs-bulk-apply"
              >
                Add to list
              </Button>
              <span
                className="text-xs font-medium text-muted-foreground"
                data-testid="text-qs-team-count"
              >
                {STARTER_TEAM_CAP != null
                  ? `${projectedTeams}/${STARTER_TEAM_CAP} teams`
                  : `${projectedTeams} team${projectedTeams === 1 ? "" : "s"}`}
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
          </div>
          <div className="space-y-4">
            {teamRows.map((t, i) => (
              <div
                key={t.key}
                className={`rounded-md border p-3 ${errorTeamIndex === i ? "border-destructive" : ""}`}
                data-testid={`qs-team-row-${i}`}
              >
                <div className="grid gap-2 sm:grid-cols-[1fr_auto] items-end">
                  <div>
                    <Label htmlFor={`qs-team-name-${t.key}`}>Team name</Label>
                    <Input
                      id={`qs-team-name-${t.key}`}
                      placeholder="e.g. 12U Blue"
                      value={t.name}
                      onChange={(e) => updateTeam(t.key, { name: e.target.value })}
                      data-testid={`input-qs-team-name-${i}`}
                    />
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() =>
                      setTeamRows((rows) =>
                        rows.length === 1 ? [emptyTeam()] : rows.filter((r) => r.key !== t.key),
                      )
                    }
                    aria-label="Remove team"
                    data-testid={`btn-qs-remove-team-${i}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <div className="mt-2 pl-1">
                  <div className="text-xs font-medium text-muted-foreground mb-1">
                    Coach emails
                  </div>
                  <div className="space-y-1.5">
                    {t.coachEmails.map((email, ei) => (
                      <div key={ei} className="flex items-center gap-2">
                        <Input
                          type="email"
                          placeholder="coach@example.com"
                          value={email}
                          onChange={(e) => updateCoachEmail(t.key, ei, e.target.value)}
                          className="max-w-sm h-8 text-sm"
                          data-testid={`input-qs-coach-email-${i}-${ei}`}
                        />
                        {t.coachEmails.length > 1 && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            onClick={() => removeCoachRow(t.key, ei)}
                            aria-label="Remove coach email"
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="mt-1 h-7 text-xs"
                    onClick={() => addCoachRow(t.key)}
                    data-testid={`btn-qs-add-coach-${i}`}
                  >
                    <Plus className="h-3.5 w-3.5 mr-1" /> Add coach
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ---- Save ---- */}
        {saveError && (
          <p className="text-sm font-medium text-destructive mb-3" data-testid="qs-save-error">
            {saveError}
          </p>
        )}
        <div className="flex items-center gap-3 pb-10">
          <Button onClick={save} disabled={!canSave} size="lg" data-testid="btn-qs-save">
            {saving ? "Saving…" : "Save everything"}
          </Button>
          <span className="text-xs text-muted-foreground">
            Creates the org, {validTeams.length} team{validTeams.length === 1 ? "" : "s"}, and
            staged coach drafts in one shot.
          </span>
        </div>
      </div>
    </AdminLayout>
  );
}
