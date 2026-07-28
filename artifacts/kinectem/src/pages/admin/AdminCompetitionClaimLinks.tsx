import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { AdminLayout } from "@/components/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { BrandImageField } from "@/components/BrandImageField";
import { BrandColorField } from "@/components/BrandColorField";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  shrinkImageToDataUrl,
  isUnsupportedHeicImage,
  IMAGE_UPLOAD_MAX_BYTES,
} from "@/lib/shrinkImage";
import { Upload } from "lucide-react";

// Admin screen listing every ownerless competition with its secret claim
// link (same concept as the org claim-links tab). The operator copies each
// link to the corresponding organizer so a recipient can sign up and become
// the competition's operator directly. Links are re-displayable on demand
// (plaintext token) and exportable as CSV.

type ClaimLinkRow = {
  id: string;
  name: string;
  type: string;
  slug: string;
  location: string | null;
  startDate: string;
  endDate: string;
  logoUrl: string | null;
  brandColor: string | null;
  secondaryColor: string | null;
  promoCode: string | null;
  token: string;
  messagedAt: string | null;
  facebookAddedAt: string | null;
};

type ClaimLinksResponse = { data: ClaimLinkRow[] };

type NameMatch = {
  id: string;
  name: string;
  type: string;
  startDate: string;
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
  return `${window.location.origin}${import.meta.env.BASE_URL}claim/competition/${token}`;
}

function rowsToCsv(rows: ClaimLinkRow[]): string {
  const header = [
    "competition_name",
    "type",
    "start_date",
    "end_date",
    "location",
    "promo_code",
    "claim_link",
    "competition_id",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.name,
        r.type,
        r.startDate,
        r.endDate,
        r.location ?? "",
        r.promoCode ?? "",
        claimUrl(r.token),
        r.id,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return lines.join("\n");
}

export default function AdminCompetitionClaimLinks() {
  const [q, setQ] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<"tournament" | "league">("tournament");
  const [newStartDate, setNewStartDate] = useState("");
  const [newEndDate, setNewEndDate] = useState("");
  const [newLogoUrl, setNewLogoUrl] = useState("");
  const [debounced, setDebounced] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(newName.trim()), 250);
    return () => clearTimeout(t);
  }, [newName]);

  const { data: nameCheck, isFetching: checking } = useQuery<NameCheckResponse>({
    queryKey: ["admin", "competition-name-check", debounced],
    enabled: debounced.length >= 2,
    queryFn: () =>
      customFetch<NameCheckResponse>(
        `/api/v1/admin/competition-name-check?name=${encodeURIComponent(debounced)}`,
        { method: "GET" },
      ),
  });

  const matches = useMemo(() => nameCheck?.data ?? [], [nameCheck]);
  const exactMatch = useMemo(
    () => matches.find((m) => m.exact) ?? null,
    [matches],
  );

  const canAdd =
    !!newName.trim() && !!newStartDate && !!newEndDate && !exactMatch && !creating;

  const addCompetition = async () => {
    if (!canAdd) return;
    setCreating(true);
    try {
      const resp = await customFetch<{ data: ClaimLinkRow }>(
        `/api/v1/admin/competition-claim-links`,
        {
          method: "POST",
          body: JSON.stringify({
            name: newName.trim(),
            type: newType,
            startDate: newStartDate,
            endDate: newEndDate,
            ...(newLogoUrl ? { logoUrl: newLogoUrl } : {}),
          }),
        },
      );
      setNewName("");
      setDebounced("");
      setNewStartDate("");
      setNewEndDate("");
      setNewLogoUrl("");
      await queryClient.invalidateQueries({
        queryKey: ["admin", "competition-claim-links"],
      });
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
        title: "Couldn't add competition",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setCreating(false);
    }
  };

  const { data, isLoading } = useQuery<ClaimLinksResponse>({
    queryKey: ["admin", "competition-claim-links"],
    queryFn: () =>
      customFetch<ClaimLinksResponse>(`/api/v1/admin/competition-claim-links`, {
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
        (r.location ?? "").toLowerCase().includes(needle) ||
        r.type.toLowerCase().includes(needle),
    );
  }, [rows, q]);

  const toggleMessaged = async (id: string, messaged: boolean) => {
    try {
      await customFetch(
        `/api/v1/admin/competition-claim-links/${id}/messaged`,
        { method: "PATCH", body: JSON.stringify({ messaged }) },
      );
      await queryClient.invalidateQueries({
        queryKey: ["admin", "competition-claim-links"],
      });
    } catch (err) {
      toast({
        title: "Couldn't update",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    }
  };

  // Per-row logo upload: shrink client-side, PATCH inline as a data: URL
  // (same pattern as org logos / team banners).
  const rowLogoInputRef = useRef<HTMLInputElement>(null);
  const [logoTargetId, setLogoTargetId] = useState<string | null>(null);
  const [logoUploadingId, setLogoUploadingId] = useState<string | null>(null);

  const pickRowLogo = (id: string) => {
    setLogoTargetId(id);
    rowLogoInputRef.current?.click();
  };

  const uploadRowLogo = async (file: File) => {
    const id = logoTargetId;
    if (!id) return;
    if (isUnsupportedHeicImage(file)) {
      toast({
        title: "That photo format isn't supported",
        description: "Please choose a JPG or PNG version.",
        variant: "destructive",
      });
      return;
    }
    if (file.size > IMAGE_UPLOAD_MAX_BYTES) {
      toast({
        title: "That image is too large",
        description: "Please choose an image under 5 MB.",
        variant: "destructive",
      });
      return;
    }
    setLogoUploadingId(id);
    try {
      const dataUrl = await shrinkImageToDataUrl(file);
      await customFetch(`/api/v1/admin/competition-claim-links/${id}/logo`, {
        method: "PATCH",
        body: JSON.stringify({ logoUrl: dataUrl }),
      });
      await queryClient.invalidateQueries({
        queryKey: ["admin", "competition-claim-links"],
      });
      toast({ title: "Logo updated" });
    } catch (err) {
      toast({
        title: "Couldn't upload logo",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setLogoUploadingId(null);
      setLogoTargetId(null);
    }
  };

  // Per-row promo code editor: local draft, saved on blur / Enter. The code
  // lands in the competition's promo_code field, which the organizer's
  // invite message auto-fills from once they claim it.
  const [promoDrafts, setPromoDrafts] = useState<Record<string, string>>({});
  const [promoSavingId, setPromoSavingId] = useState<string | null>(null);

  const savePromoCode = async (id: string, current: string | null) => {
    const draft = promoDrafts[id];
    if (draft === undefined) return; // never touched
    const next = draft.trim();
    if (next === (current ?? "")) {
      // Unchanged (incl. trim-equal) — drop the draft so it stops shadowing
      // the canonical server value on future refreshes.
      setPromoDrafts((d) => {
        const { [id]: _, ...rest } = d;
        return rest;
      });
      return;
    }
    setPromoSavingId(id);
    try {
      await customFetch(
        `/api/v1/admin/competition-claim-links/${id}/promo-code`,
        { method: "PATCH", body: JSON.stringify({ promoCode: next || null }) },
      );
      await queryClient.invalidateQueries({
        queryKey: ["admin", "competition-claim-links"],
      });
      setPromoDrafts((d) => {
        const { [id]: _, ...rest } = d;
        return rest;
      });
      toast({
        title: next ? `Promo code set to ${next}` : "Promo code cleared",
        description: next
          ? "It'll be pre-filled in the organizer's invite message when they claim."
          : undefined,
      });
    } catch (err) {
      toast({
        title: "Couldn't save promo code",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setPromoSavingId(null);
    }
  };

  // Branding dialog: click a competition's name to set its brand colors so
  // the page + claim landing card are already branded when it's claimed.
  const [brandingTarget, setBrandingTarget] = useState<ClaimLinkRow | null>(null);
  const [brandDraft, setBrandDraft] = useState("");
  const [secondaryDraft, setSecondaryDraft] = useState("");
  const [brandingSaving, setBrandingSaving] = useState(false);
  const HEX = /^#[0-9a-fA-F]{6}$/;

  const openBranding = (r: ClaimLinkRow) => {
    setBrandingTarget(r);
    setBrandDraft(r.brandColor ?? "");
    setSecondaryDraft(r.secondaryColor ?? "");
  };

  const brandingValid =
    (brandDraft.trim() === "" || HEX.test(brandDraft.trim())) &&
    (secondaryDraft.trim() === "" || HEX.test(secondaryDraft.trim()));

  const saveBranding = async () => {
    if (!brandingTarget || !brandingValid) return;
    setBrandingSaving(true);
    try {
      await customFetch(
        `/api/v1/admin/competition-claim-links/${brandingTarget.id}/branding`,
        {
          method: "PATCH",
          body: JSON.stringify({
            brandColor: brandDraft.trim() || null,
            secondaryColor: secondaryDraft.trim() || null,
          }),
        },
      );
      await queryClient.invalidateQueries({
        queryKey: ["admin", "competition-claim-links"],
      });
      toast({ title: `Branding updated for ${brandingTarget.name}` });
      setBrandingTarget(null);
    } catch (err) {
      toast({
        title: "Couldn't save branding",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setBrandingSaving(false);
    }
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
    a.download = `kinectem-competition-claim-links-${stamp}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <AdminLayout>
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-black">Competition claim links</h1>
          <p className="text-sm text-muted-foreground">
            Secret invite links for ownerless competitions. Send each link to
            the right organizer — whoever signs up through it becomes the
            operator.
          </p>
        </div>
        <Button
          onClick={exportCsv}
          disabled={rows.length === 0}
          data-testid="btn-export-competition-claim-links-csv"
        >
          Export CSV
        </Button>
      </div>

      <div className="rounded-lg border bg-card p-4 mb-5">
        <h2 className="text-sm font-bold mb-1">Add a competition</h2>
        <p className="text-xs text-muted-foreground mb-3">
          Type a name to create a fresh claimable competition. Matching
          competitions appear below so you don't add a duplicate.
        </p>
        <div className="flex items-end gap-3 flex-wrap">
          <div className="flex-1 min-w-[16rem]">
            <label className="text-xs font-medium text-muted-foreground block mb-1">
              Name
            </label>
            <Input
              placeholder="Competition name (e.g. Legacy Fall Finale)"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              data-testid="input-add-competition-name"
            />
          </div>
          <div className="w-[10rem]">
            <label className="text-xs font-medium text-muted-foreground block mb-1">
              Type
            </label>
            <Select
              value={newType}
              onValueChange={(v) => setNewType(v === "league" ? "league" : "tournament")}
            >
              <SelectTrigger data-testid="select-add-competition-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="tournament">Tournament</SelectItem>
                <SelectItem value="league">League</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">
              Start date
            </label>
            <Input
              type="date"
              value={newStartDate}
              onChange={(e) => setNewStartDate(e.target.value)}
              data-testid="input-add-competition-start-date"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">
              End date
            </label>
            <Input
              type="date"
              value={newEndDate}
              onChange={(e) => setNewEndDate(e.target.value)}
              data-testid="input-add-competition-end-date"
            />
          </div>
          <Button
            onClick={addCompetition}
            disabled={!canAdd}
            data-testid="btn-add-competition"
          >
            {creating ? "Adding…" : "Add competition"}
          </Button>
        </div>

        <div className="mt-3 max-w-md">
          <BrandImageField
            label="Logo (optional — pre-loaded for the organizer)"
            value={newLogoUrl}
            onChange={setNewLogoUrl}
            kind="logo"
            idPrefix="add-competition-claim"
          />
        </div>

        {debounced.length >= 2 && (
          <div className="mt-3" data-testid="add-competition-matches">
            {exactMatch ? (
              <p
                className="text-sm font-medium text-destructive"
                data-testid="add-competition-duplicate-warning"
              >
                ⚠ "{exactMatch.name}" already exists
                {exactMatch.hasOwner ? " (already claimed)" : " (unclaimed)"} —
                adding is blocked to avoid a duplicate.
              </p>
            ) : matches.length > 0 ? (
              <p className="text-xs text-muted-foreground mb-1">
                {matches.length} similar name{matches.length === 1 ? "" : "s"}{" "}
                already exist — make sure yours is different:
              </p>
            ) : checking ? (
              <p className="text-xs text-muted-foreground">Checking…</p>
            ) : (
              <p
                className="text-xs text-emerald-600"
                data-testid="add-competition-no-match"
              >
                No matching competition — good to add.
              </p>
            )}
            {matches.length > 0 && (
              <ul className="mt-1 space-y-1">
                {matches.map((m) => (
                  <li
                    key={m.id}
                    className="text-xs flex items-center gap-2"
                    data-testid={`add-competition-match-${m.id}`}
                  >
                    <span className={m.exact ? "font-semibold" : "font-medium"}>
                      {m.name}
                    </span>
                    <span className="text-muted-foreground capitalize">
                      {m.type}
                    </span>
                    <span className="text-muted-foreground">
                      · starts {m.startDate}
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
          placeholder="Search competition, location, type..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="max-w-md"
          data-testid="input-competition-claim-links-search"
        />
        <div
          className="text-sm text-muted-foreground"
          data-testid="competition-claim-links-count"
        >
          {rows.length} ownerless competition{rows.length === 1 ? "" : "s"}
        </div>
      </div>
      <input
        ref={rowLogoInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        data-testid="input-row-competition-logo"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void uploadRowLogo(file);
        }}
      />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[110px]">Emailed</TableHead>
            <TableHead className="w-[70px]">Logo</TableHead>
            <TableHead>Competition</TableHead>
            <TableHead className="w-[130px]">Dates</TableHead>
            <TableHead className="min-w-[220px]">Promo code</TableHead>
            <TableHead>Claim link</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableRow>
              <TableCell
                colSpan={7}
                className="text-center py-6 text-muted-foreground"
              >
                Loading…
              </TableCell>
            </TableRow>
          ) : filtered.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={7}
                className="text-center py-6 text-muted-foreground"
              >
                No ownerless competitions.
              </TableCell>
            </TableRow>
          ) : (
            filtered.map((r) => (
              <TableRow key={r.id} data-testid={`row-competition-claim-link-${r.id}`}>
                <TableCell>
                  <Checkbox
                    checked={!!r.messagedAt}
                    onCheckedChange={(v) => toggleMessaged(r.id, v === true)}
                    aria-label={`Emailed ${r.name}`}
                    data-testid={`checkbox-competition-emailed-${r.id}`}
                  />
                </TableCell>
                <TableCell>
                  <button
                    type="button"
                    onClick={() => pickRowLogo(r.id)}
                    disabled={logoUploadingId === r.id}
                    title={r.logoUrl ? "Change logo" : "Upload logo"}
                    className="w-10 h-10 rounded-md border bg-muted flex items-center justify-center overflow-hidden hover:ring-2 hover:ring-ring disabled:opacity-50"
                    data-testid={`btn-competition-logo-${r.id}`}
                  >
                    {logoUploadingId === r.id ? (
                      <span className="text-[10px] text-muted-foreground">…</span>
                    ) : r.logoUrl ? (
                      <img
                        src={r.logoUrl}
                        alt=""
                        className="w-full h-full object-contain p-0.5"
                      />
                    ) : (
                      <Upload className="w-4 h-4 text-muted-foreground" />
                    )}
                  </button>
                </TableCell>
                <TableCell className="font-medium">
                  <button
                    type="button"
                    onClick={() => openBranding(r)}
                    className="text-left hover:underline underline-offset-2"
                    title="Set branding colors"
                    data-testid={`btn-competition-branding-${r.id}`}
                  >
                    {r.name}
                  </button>
                  <span className="ml-2 text-xs text-muted-foreground capitalize">
                    {r.type}
                  </span>
                  {(r.brandColor || r.secondaryColor) && (
                    <span className="ml-2 inline-flex items-center gap-1 align-middle">
                      {r.brandColor && (
                        <span
                          className="inline-block w-3 h-3 rounded-full border border-border"
                          style={{ backgroundColor: r.brandColor }}
                          title={r.brandColor}
                        />
                      )}
                      {r.secondaryColor && (
                        <span
                          className="inline-block w-3 h-3 rounded-full border border-border"
                          style={{ backgroundColor: r.secondaryColor }}
                          title={r.secondaryColor}
                        />
                      )}
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                  {r.startDate.slice(5).replace("-", "/")} →{" "}
                  {r.endDate.slice(5).replace("-", "/")}
                  <span className="block text-[10px]">{r.startDate.slice(0, 4)}</span>
                </TableCell>
                <TableCell>
                  <Input
                    value={promoDrafts[r.id] ?? r.promoCode ?? ""}
                    placeholder="e.g. LEGACY25"
                    className="h-8 min-w-[200px] text-sm font-mono uppercase"
                    maxLength={64}
                    disabled={promoSavingId === r.id}
                    onChange={(e) =>
                      setPromoDrafts((d) => ({ ...d, [r.id]: e.target.value }))
                    }
                    onBlur={() => void savePromoCode(r.id, r.promoCode)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                    }}
                    data-testid={`input-competition-promo-code-${r.id}`}
                  />
                </TableCell>
                <TableCell className="text-xs font-mono text-muted-foreground max-w-xs truncate">
                  {claimUrl(r.token)}
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => copyLink(r.token)}
                    data-testid={`btn-copy-competition-claim-link-${r.id}`}
                  >
                    Copy link
                  </Button>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      <Dialog
        open={brandingTarget != null}
        onOpenChange={(open) => {
          if (!open) setBrandingTarget(null);
        }}
      >
        <DialogContent data-testid="dialog-competition-branding">
          <DialogHeader>
            <DialogTitle>
              Branding — {brandingTarget?.name}
            </DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground -mt-2">
            These colors brand the competition page and claim card before the
            organizer takes over. Leave blank to clear.
          </p>
          <div className="space-y-4">
            <BrandColorField
              value={brandDraft}
              onChange={setBrandDraft}
              logoUrl={brandingTarget?.logoUrl}
              idPrefix="competition-brand"
              label="Primary color"
            />
            <BrandColorField
              value={secondaryDraft}
              onChange={setSecondaryDraft}
              logoUrl={brandingTarget?.logoUrl}
              idPrefix="competition-secondary"
              label="Secondary color"
            />
            {(brandDraft.trim() || secondaryDraft.trim()) && (
              <div
                className="h-10 rounded-lg border border-border"
                style={{
                  background: brandDraft.trim()
                    ? secondaryDraft.trim()
                      ? `linear-gradient(135deg, ${brandDraft.trim()} 0%, ${secondaryDraft.trim()} 100%)`
                      : brandDraft.trim()
                    : secondaryDraft.trim(),
                }}
                title="Preview"
                data-testid="preview-competition-branding"
              />
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setBrandingTarget(null)}
              disabled={brandingSaving}
            >
              Cancel
            </Button>
            <Button
              onClick={saveBranding}
              disabled={!brandingValid || brandingSaving}
              data-testid="btn-save-competition-branding"
            >
              {brandingSaving ? "Saving…" : "Save branding"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
