import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { formatOrgName } from "@/lib/format";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { AdminLayout } from "@/components/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Label } from "@/components/ui/label";
import {
  shrinkImageToDataUrl,
  IMAGE_UPLOAD_MAX_BYTES,
} from "@/lib/shrinkImage";
import { extractBrandColorsFromDataUrl } from "@/lib/extractBrandColors";
import { PLANS, type PlanTier } from "@/lib/plans";
import { X } from "lucide-react";

// Task #610 — Admin screen listing every ownerless org page with its secret
// claim link. The operator copies each link to the corresponding org so a
// recipient can sign up and become the owner directly. Links are re-displayable
// on demand (plaintext token) and exportable as CSV for off-site distribution.

type ClaimLinkRow = {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  logoUrl: string | null;
  token: string;
  messagedAt: string | null;
  facebookAddedAt: string | null;
  // Non-null when the org was created through either admin setup flow
  // ("orgs I set up"); those rows render in their own section on top.
  quickSetupAt: string | null;
};

type ClaimLinksResponse = { data: ClaimLinkRow[] };

type NameMatch = {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  hasOwner: boolean;
  exact: boolean;
};

type NameCheckResponse = { data: NameMatch[] };

// RFC 4180 CSV escaping.
function csvCell(v: string | null): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function claimUrl(token: string): string {
  return `${window.location.origin}${import.meta.env.BASE_URL}claim/${token}`;
}

function rowsToCsv(rows: ClaimLinkRow[]): string {
  const header = ["org_name", "city", "state", "claim_link", "org_id"];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [r.name, r.city ?? "", r.state ?? "", claimUrl(r.token), r.id]
        .map(csvCell)
        .join(","),
    );
  }
  return lines.join("\n");
}

export default function AdminOrgClaimLinks() {
  const [q, setQ] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [newName, setNewName] = useState("");
  const [debounced, setDebounced] = useState("");
  const [creating, setCreating] = useState(false);
  // Optional branding at creation time (mirrors Quick setup): logo upload
  // auto-suggests brand colors, both stay editable/clearable before Add.
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null);
  const [logoBusy, setLogoBusy] = useState(false);
  const logoUploadSeq = useRef(0);
  const [primaryColor, setPrimaryColor] = useState<string | null>(null);
  const [secondaryColor, setSecondaryColor] = useState<string | null>(null);
  // Task #856 — optional staged plan tier + promo code (mirrors Quick setup).
  // Both skippable; when set they're stored on the org and pre-selected /
  // auto-applied on the new owner's subscribe page.
  const [tier, setTier] = useState<PlanTier | null>(null);
  const [promoInput, setPromoInput] = useState("");
  const [appliedPromo, setAppliedPromo] = useState<{
    code: string;
    description: string | null;
    discountType: string;
    discountValue: number;
  } | null>(null);
  const [promoChecking, setPromoChecking] = useState(false);
  const [promoError, setPromoError] = useState<string | null>(null);

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
      if (uploadSeq === logoUploadSeq.current) {
        toast({ title: "Couldn't read that image", variant: "destructive" });
      }
    } finally {
      // Only the latest upload may clear the busy flag — a superseded job
      // finishing must not reopen the submit window early.
      if (uploadSeq === logoUploadSeq.current) setLogoBusy(false);
    }
  };

  useEffect(() => {
    const t = setTimeout(() => setDebounced(newName.trim()), 250);
    return () => clearTimeout(t);
  }, [newName]);

  const { data: nameCheck, isFetching: checking } = useQuery<NameCheckResponse>({
    queryKey: ["admin", "org-name-check", debounced],
    enabled: debounced.length >= 2,
    queryFn: () =>
      customFetch<NameCheckResponse>(
        `/api/v1/admin/org-name-check?name=${encodeURIComponent(debounced)}`,
        { method: "GET" },
      ),
  });

  const matches = useMemo(() => nameCheck?.data ?? [], [nameCheck]);
  const exactMatch = useMemo(() => matches.find((m) => m.exact) ?? null, [matches]);

  const addOrg = async () => {
    const name = newName.trim();
    // Mirror the button's disabled conditions — Enter in the name field also
    // lands here, and submitting mid logo-processing would drop the branding.
    if (!name || creating || logoBusy || exactMatch) return;
    setCreating(true);
    try {
      const resp = await customFetch<{ data: ClaimLinkRow }>(
        `/api/v1/admin/org-claim-links`,
        {
          method: "POST",
          body: JSON.stringify({
            name,
            logoUrl: logoDataUrl || undefined,
            brandPrimaryColor: primaryColor || undefined,
            brandSecondaryColor: secondaryColor || undefined,
            tier: tier ?? undefined,
            promoCode: appliedPromo?.code || undefined,
          }),
        },
      );
      setNewName("");
      setDebounced("");
      setLogoDataUrl(null);
      setPrimaryColor(null);
      setSecondaryColor(null);
      setTier(null);
      setPromoInput("");
      setAppliedPromo(null);
      setPromoError(null);
      await queryClient.invalidateQueries({ queryKey: ["admin", "org-claim-links"] });
      try {
        await navigator.clipboard.writeText(claimUrl(resp.data.token));
        toast({
          title: `Added "${resp.data.name}"`,
          description: "Claim link copied to clipboard",
        });
      } catch {
        toast({ title: `Added "${resp.data.name}"` });
      }
    } catch (err) {
      toast({
        title: "Couldn't add organization",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setCreating(false);
    }
  };

  const { data, isLoading } = useQuery<ClaimLinksResponse>({
    queryKey: ["admin", "org-claim-links"],
    queryFn: () =>
      customFetch<ClaimLinksResponse>(`/api/v1/admin/org-claim-links`, {
        method: "GET",
      }),
  });

  const rows = useMemo(() => data?.data ?? [], [data]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter(
      (r) =>
        r.name.toLowerCase().includes(needle) ||
        (r.city ?? "").toLowerCase().includes(needle) ||
        (r.state ?? "").toLowerCase().includes(needle),
    );
  }, [rows, q]);

  // Split into "Orgs I set up" (created through either admin setup flow,
  // most recent first) and everything else. Search filters both sections.
  const quickSetupRows = useMemo(
    () =>
      filtered
        .filter((r) => r.quickSetupAt)
        .sort((a, b) =>
          (b.quickSetupAt as string).localeCompare(a.quickSetupAt as string),
        ),
    [filtered],
  );
  const otherRows = useMemo(
    () => filtered.filter((r) => !r.quickSetupAt),
    [filtered],
  );

  const toggleMessaged = async (id: string, messaged: boolean) => {
    try {
      await customFetch(`/api/v1/admin/org-claim-links/${id}/messaged`, {
        method: "PATCH",
        body: JSON.stringify({ messaged }),
      });
      await queryClient.invalidateQueries({ queryKey: ["admin", "org-claim-links"] });
    } catch (err) {
      toast({
        title: "Couldn't update",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    }
  };

  const toggleFacebookAdded = async (id: string, facebookAdded: boolean) => {
    try {
      await customFetch(`/api/v1/admin/org-claim-links/${id}/facebook-added`, {
        method: "PATCH",
        body: JSON.stringify({ facebookAdded }),
      });
      await queryClient.invalidateQueries({ queryKey: ["admin", "org-claim-links"] });
    } catch (err) {
      toast({
        title: "Couldn't update",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    }
  };

  const copyLink = async (token: string) => {
    try {
      await navigator.clipboard.writeText(claimUrl(token));
      toast({ title: "Claim link copied" });
    } catch {
      toast({ title: "Couldn't copy — select and copy manually", variant: "destructive" });
    }
  };

  const exportCsv = () => {
    if (rows.length === 0) {
      toast({ title: "Nothing to export yet" });
      return;
    }
    const csv = rowsToCsv(rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `kinectem-org-claim-links-${stamp}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <AdminLayout>
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-black">Org Links</h1>
          <p className="text-sm text-muted-foreground">
            Secret invite links for ownerless organization pages. Send each link
            to the right org — whoever signs up through it becomes the owner.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Task #829 — one-page org setup: org info + teams + coaches, one save. */}
          <Button asChild data-testid="btn-org-quick-setup">
            <Link href="/admin/org-quick-setup">Quick setup</Link>
          </Button>
          <Button
            variant="outline"
            onClick={exportCsv}
            disabled={rows.length === 0}
            data-testid="btn-export-claim-links-csv"
          >
            Export CSV
          </Button>
        </div>
      </div>

      <div className="rounded-lg border bg-card p-4 mb-5">
        <h2 className="text-sm font-bold mb-1">Add an organization</h2>
        <p className="text-xs text-muted-foreground mb-3">
          Type a name to create a fresh claimable page. Matching orgs appear
          below so you don't add a duplicate.
        </p>
        <div className="flex items-start gap-3 flex-wrap">
          <div className="flex-1 min-w-[16rem]">
            <Input
              placeholder="Organization name (e.g. Denville Baseball)"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !exactMatch) addOrg();
              }}
              data-testid="input-add-org-name"
            />
          </div>
          <Button
            onClick={addOrg}
            disabled={!newName.trim() || creating || logoBusy || !!exactMatch}
            data-testid="btn-add-org"
          >
            {creating ? "Adding…" : "Add org"}
          </Button>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="add-org-logo">Logo (optional)</Label>
            <div className="flex items-center gap-3 mt-1">
              {logoDataUrl && (
                <img
                  src={logoDataUrl}
                  alt="Logo preview"
                  className="h-12 w-12 rounded object-contain border bg-white"
                  data-testid="img-add-org-logo-preview"
                />
              )}
              <Input
                id="add-org-logo"
                type="file"
                accept="image/*"
                onChange={onLogoChange}
                disabled={logoBusy}
                className="max-w-xs"
                data-testid="input-add-org-logo"
              />
              {logoDataUrl && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setLogoDataUrl(null)}
                  aria-label="Remove logo"
                  data-testid="btn-add-org-clear-logo"
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
          <div>
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
                    data-testid={`input-add-org-color-${id}`}
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
                      data-testid={`btn-add-org-clear-color-${id}`}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Task #856 — optional staged plan tier + promo code. Both skippable;
            they're pre-selected / auto-applied on the owner's subscribe page. */}
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <Label>Plan tier (optional)</Label>
            <p className="text-xs text-muted-foreground mb-1.5">
              Pre-selects the tier on the new owner's subscribe page — they can
              still change it. Click again to deselect.
            </p>
            <div className="flex flex-wrap gap-2">
              {PLANS.map((p) => {
                const selected = tier === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setTier((cur) => (cur === p.id ? null : p.id))}
                    aria-pressed={selected}
                    className={`rounded-md border px-3 py-2 text-left transition-colors ${
                      selected
                        ? "border-primary ring-2 ring-primary/40 bg-primary/5"
                        : "hover:border-muted-foreground/40"
                    }`}
                    data-testid={`btn-add-org-tier-${p.id}`}
                  >
                    <div className="text-xs font-bold">{p.name}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {p.maxTeams != null
                        ? `Up to ${p.maxTeams} teams`
                        : "41+ teams (unlimited)"}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <Label htmlFor="add-org-promo-code">Promo code (optional)</Label>
            <p className="text-xs text-muted-foreground mb-1.5">
              Applied automatically when the org admin claims the page and sets
              up billing.
            </p>
            {appliedPromo ? (
              <div
                className="flex items-center gap-2 text-sm"
                data-testid="add-org-promo-applied"
              >
                <span className="rounded-md border border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/40 px-2 py-1 font-bold uppercase">
                  {appliedPromo.code}
                </span>
                <span className="text-muted-foreground">
                  {appliedPromo.discountType === "percent"
                    ? `${appliedPromo.discountValue}% off first year`
                    : `$${appliedPromo.discountValue} off first year`}
                  {appliedPromo.description ? ` — ${appliedPromo.description}` : ""}
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
                  data-testid="btn-add-org-promo-clear"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2 max-w-sm">
                <Input
                  id="add-org-promo-code"
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
                  data-testid="input-add-org-promo-code"
                />
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void applyPromoCode()}
                  disabled={promoChecking || !promoInput.trim()}
                  data-testid="btn-add-org-promo-apply"
                >
                  {promoChecking ? "Checking…" : "Apply"}
                </Button>
              </div>
            )}
            {promoError && (
              <p
                className="mt-1 text-xs text-destructive"
                data-testid="add-org-promo-error"
              >
                {promoError}
              </p>
            )}
          </div>
        </div>

        {debounced.length >= 2 && (
          <div className="mt-3" data-testid="add-org-matches">
            {exactMatch ? (
              <p
                className="text-sm font-medium text-destructive"
                data-testid="add-org-duplicate-warning"
              >
                ⚠ "{exactMatch.name}" already exists
                {exactMatch.hasOwner ? " (already claimed)" : " (unclaimed)"} — adding
                is blocked to avoid a duplicate.
              </p>
            ) : matches.length > 0 ? (
              <p className="text-xs text-muted-foreground mb-1">
                {matches.length} similar name{matches.length === 1 ? "" : "s"} already
                exist — make sure yours is different:
              </p>
            ) : checking ? (
              <p className="text-xs text-muted-foreground">Checking…</p>
            ) : (
              <p className="text-xs text-emerald-600" data-testid="add-org-no-match">
                No matching organization — good to add.
              </p>
            )}
            {matches.length > 0 && (
              <ul className="mt-1 space-y-1">
                {matches.map((m) => (
                  <li
                    key={m.id}
                    className="text-xs flex items-center gap-2"
                    data-testid={`add-org-match-${m.id}`}
                  >
                    <span className={m.exact ? "font-semibold" : "font-medium"}>
                      {m.name}
                    </span>
                    <span className="text-muted-foreground">
                      {[m.city, m.state].filter(Boolean).join(", ")}
                    </span>
                    <span className="text-muted-foreground">
                      · {m.hasOwner ? "claimed" : "unclaimed"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <Input
          placeholder="Search organization, city, state..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="max-w-md"
          data-testid="input-claim-links-search"
        />
        <div className="text-sm text-muted-foreground" data-testid="claim-links-count">
          {rows.length} ownerless page{rows.length === 1 ? "" : "s"}
        </div>
      </div>
      {(() => {
        const renderRow = (r: ClaimLinkRow) => {
          const location = [r.city, r.state].filter(Boolean).join(", ");
          return (
            <TableRow key={r.id} data-testid={`row-claim-link-${r.id}`}>
              <TableCell>
                <Checkbox
                  checked={!!r.facebookAddedAt}
                  onCheckedChange={(v) => toggleFacebookAdded(r.id, v === true)}
                  aria-label={`Added ${r.name} on Facebook`}
                  data-testid={`checkbox-facebook-added-${r.id}`}
                />
              </TableCell>
              <TableCell>
                <Checkbox
                  checked={!!r.messagedAt}
                  onCheckedChange={(v) => toggleMessaged(r.id, v === true)}
                  aria-label={`Messaged ${r.name} on Facebook`}
                  data-testid={`checkbox-messaged-${r.id}`}
                />
              </TableCell>
              <TableCell className="font-medium">
                {/* Task #808 — link straight to the unclaimed org page so
                    the operator can set it up (logo, teams, staged
                    coaches) before sending the claim link. */}
                <Link
                  href={`/organizations/${r.id}`}
                  className="hover:underline"
                  data-testid={`link-claim-org-${r.id}`}
                >
                  {formatOrgName(r.name)}
                </Link>
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {location || "—"}
              </TableCell>
              <TableCell className="text-xs font-mono text-muted-foreground max-w-xs truncate">
                {claimUrl(r.token)}
              </TableCell>
              <TableCell className="text-right">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => copyLink(r.token)}
                  data-testid={`btn-copy-claim-link-${r.id}`}
                >
                  Copy link
                </Button>
              </TableCell>
            </TableRow>
          );
        };
        const header = (
          <TableHeader>
            <TableRow>
              <TableHead className="w-[110px]">Facebook</TableHead>
              <TableHead className="w-[110px]">Messaged</TableHead>
              <TableHead>Organization</TableHead>
              <TableHead>Location</TableHead>
              <TableHead>Claim link</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
        );
        return (
          <>
            {/* Orgs the operator created through either setup flow get their
                own section on top, most recent first, above the bulk-imported
                organizations below. */}
            {quickSetupRows.length > 0 && (
              <div className="mb-6" data-testid="section-quick-setup-orgs">
                <h2 className="text-sm font-bold mb-1">Orgs I set up</h2>
                <p className="text-xs text-muted-foreground mb-2">
                  Created here or through Quick setup — most recent first.
                </p>
                <Table>
                  {header}
                  <TableBody>{quickSetupRows.map(renderRow)}</TableBody>
                </Table>
              </div>
            )}
            <div data-testid="section-all-orgs">
              {quickSetupRows.length > 0 && (
                <h2 className="text-sm font-bold mb-2">All other unclaimed orgs</h2>
              )}
              <Table>
                {header}
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-6 text-muted-foreground">
                        Loading…
                      </TableCell>
                    </TableRow>
                  ) : filtered.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-6 text-muted-foreground">
                        No ownerless pages.
                      </TableCell>
                    </TableRow>
                  ) : otherRows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-6 text-muted-foreground">
                        No other unclaimed orgs match.
                      </TableCell>
                    </TableRow>
                  ) : (
                    otherRows.map(renderRow)
                  )}
                </TableBody>
              </Table>
            </div>
          </>
        );
      })()}
    </AdminLayout>
  );
}
