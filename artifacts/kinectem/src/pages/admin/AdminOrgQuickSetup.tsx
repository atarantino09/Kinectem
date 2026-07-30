import { useEffect, useMemo, useState } from "react";
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
  gender: "" | "boys" | "girls" | "coed";
  website: string;
  coachEmails: string[];
};

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
  return { key: nextKey++, name: "", gender: "", website: "", coachEmails: [""] };
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
    try {
      setLogoDataUrl(await shrinkImageToDataUrl(file));
    } catch {
      toast({ title: "Couldn't read that image", variant: "destructive" });
    } finally {
      setLogoBusy(false);
    }
  };

  const validTeams = useMemo(
    () => teamRows.filter((t) => t.name.trim().length > 0),
    [teamRows],
  );
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
            teams: validTeams.map((t) => ({
              name: t.name.trim(),
              gender: t.gender || undefined,
              website: t.website.trim() || undefined,
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
          <div className="space-y-4">
            {teamRows.map((t, i) => (
              <div
                key={t.key}
                className={`rounded-md border p-3 ${errorTeamIndex === i ? "border-destructive" : ""}`}
                data-testid={`qs-team-row-${i}`}
              >
                <div className="grid gap-2 sm:grid-cols-[1fr_10rem_1fr_auto] items-end">
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
                  <div>
                    <Label>Gender</Label>
                    <Select
                      value={t.gender}
                      onValueChange={(v) =>
                        updateTeam(t.key, { gender: v as TeamRow["gender"] })
                      }
                    >
                      <SelectTrigger data-testid={`select-qs-team-gender-${i}`}>
                        <SelectValue placeholder="—" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="boys">Boys</SelectItem>
                        <SelectItem value="girls">Girls</SelectItem>
                        <SelectItem value="coed">Coed</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor={`qs-team-website-${t.key}`}>Website (optional)</Label>
                    <Input
                      id={`qs-team-website-${t.key}`}
                      placeholder="example.com"
                      value={t.website}
                      onChange={(e) => updateTeam(t.key, { website: e.target.value })}
                      data-testid={`input-qs-team-website-${i}`}
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
