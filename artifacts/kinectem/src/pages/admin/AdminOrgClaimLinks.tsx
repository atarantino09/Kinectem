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
  DATA_URL_MAX_LENGTH,
  isUnsupportedHeicImage,
  UnsupportedImageFormatError,
} from "@/lib/shrinkImage";
import { extractBrandColorsFromDataUrl } from "@/lib/extractBrandColors";
import { BrandColorSwapButton } from "@/components/BrandColorSwapButton";
import { PLANS, type PlanTier } from "@/lib/plans";
import {
  X,
  Plus,
  Trash2,
  Copy,
  Download,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  Mail,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

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
  // Task #929 — which named list (if any) this org is filed under.
  listId: string | null;
  listName: string | null;
};

type ClaimLinksResponse = { data: ClaimLinkRow[] };

// Task #929 — operator-created named lists grouping ownerless orgs (e.g. one
// per league/tournament). An org belongs to at most one list.
type OrgList = {
  id: string;
  name: string;
  orgCount: number;
  createdAt: string;
};
type OrgListsResponse = { data: OrgList[] };

type BulkDeleteResult = {
  data: {
    requestedCount: number;
    deletedCount: number;
    deleted: Array<{ id: string; name: string }>;
    protectedCount: number;
    protected: Array<{ id: string; name: string }>;
    missingCount: number;
    listDeleted: boolean;
    list: { id: string; name: string } | null;
  };
};

const BULK_DELETE_CONFIRMATION = "DELETE UNCLAIMED ORGANIZATIONS";

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

function exportSlug(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return slug || "selected-list";
}

// Task #929 follow-up — sort by assigned list name. Unlisted rows always
// land at the end regardless of direction; within the same list (or within
// "unlisted"), fall back to organization name so ordering stays stable.
function sortByList<T extends { listName: string | null; name: string }>(
  rows: T[],
  dir: "asc" | "desc" | null,
): T[] {
  if (!dir) return rows;
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (a.listName === null && b.listName === null)
      return a.name.localeCompare(b.name);
    if (a.listName === null) return 1;
    if (b.listName === null) return -1;
    const cmp = a.listName.localeCompare(b.listName) * sign;
    return cmp !== 0 ? cmp : a.name.localeCompare(b.name);
  });
}

function rowsToCsv(rows: ClaimLinkRow[]): string {
  const header = ["org_name", "city", "state", "claim_link", "org_id", "list"];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.name,
        r.city ?? "",
        r.state ?? "",
        claimUrl(r.token),
        r.id,
        r.listName ?? "",
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return lines.join("\n");
}

export function OrgClaimLinksContent({
  embedded = false,
}: {
  embedded?: boolean;
}) {
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
  // Task #929 — which list the new org gets filed under (optional).
  const [newOrgListId, setNewOrgListId] = useState<string | null>(null);

  // Task #929 — list filter for the table below ("all" | "none" | a list id),
  // plus lightweight list create/delete state.
  const [listFilter, setListFilter] = useState<string>("all");
  const [newListName, setNewListName] = useState("");
  const [creatingList, setCreatingList] = useState(false);
  const [listToDelete, setListToDelete] = useState<OrgList | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleteScope, setDeleteScope] = useState<
    { kind: "selected" } | { kind: "list"; list: OrgList } | null
  >(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deletingOrganizations, setDeletingOrganizations] = useState(false);
  const [emailInviteOrg, setEmailInviteOrg] = useState<ClaimLinkRow | null>(
    null,
  );
  const [ownerEmail, setOwnerEmail] = useState("");
  const [sendingOwnerEmail, setSendingOwnerEmail] = useState(false);
  // Sort rows by their assigned list — click the "List" column header to
  // cycle asc → desc → off. Unlisted orgs always sort to the end so a
  // partially-sorted list doesn't scatter them through the middle.
  const [listSort, setListSort] = useState<"asc" | "desc" | null>(null);

  const { data: listsData } = useQuery<OrgListsResponse>({
    queryKey: ["admin", "org-lists"],
    queryFn: () =>
      customFetch<OrgListsResponse>(`/api/v1/admin/org-lists`, {
        method: "GET",
      }),
  });
  const lists = useMemo(() => listsData?.data ?? [], [listsData]);

  const createList = async (name: string): Promise<OrgList | null> => {
    const trimmed = name.trim();
    if (!trimmed) return null;
    setCreatingList(true);
    try {
      const resp = await customFetch<{ data: OrgList }>(
        `/api/v1/admin/org-lists`,
        {
          method: "POST",
          body: JSON.stringify({ name: trimmed }),
        },
      );
      await queryClient.invalidateQueries({ queryKey: ["admin", "org-lists"] });
      return resp.data;
    } catch (err) {
      toast({
        title: "Couldn't create list",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
      return null;
    } finally {
      setCreatingList(false);
    }
  };

  const deleteList = async (list: OrgList) => {
    try {
      await customFetch(`/api/v1/admin/org-lists/${list.id}`, {
        method: "DELETE",
      });
      if (listFilter === list.id) setListFilter("all");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin", "org-lists"] }),
        queryClient.invalidateQueries({
          queryKey: ["admin", "org-claim-links"],
        }),
      ]);
      toast({
        title: `Deleted list "${list.name}"`,
        description: "Its orgs are unaffected.",
      });
    } catch (err) {
      toast({
        title: "Couldn't delete list",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setListToDelete(null);
    }
  };

  const assignOrgList = async (orgId: string, listId: string | null) => {
    try {
      await customFetch(`/api/v1/admin/org-claim-links/${orgId}/list`, {
        method: "PATCH",
        body: JSON.stringify({ listId }),
      });
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["admin", "org-claim-links"],
        }),
        queryClient.invalidateQueries({ queryKey: ["admin", "org-lists"] }),
      ]);
    } catch (err) {
      toast({
        title: "Couldn't update list",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    }
  };

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
    if (file.type && !file.type.startsWith("image/")) {
      toast({ title: "Please pick an image file", variant: "destructive" });
      return;
    }
    if (isUnsupportedHeicImage(file)) {
      toast({
        title: "That photo format isn't supported",
        description: "Please choose a JPG or PNG version.",
        variant: "destructive",
      });
      return;
    }
    setLogoBusy(true);
    const uploadSeq = ++logoUploadSeq.current;
    try {
      const dataUrl = await shrinkImageToDataUrl(file);
      if (dataUrl.length > DATA_URL_MAX_LENGTH) {
        throw new Error(
          "That image is still too large after compression. Please choose a smaller image.",
        );
      }
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
    } catch (err) {
      if (uploadSeq === logoUploadSeq.current) {
        toast({
          title:
            err instanceof UnsupportedImageFormatError
              ? "That photo format isn't supported"
              : err instanceof Error
                ? err.message
                : "Couldn't read that image",
          description:
            err instanceof UnsupportedImageFormatError
              ? "Please choose a JPG or PNG version."
              : undefined,
          variant: "destructive",
        });
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

  const { data: nameCheck, isFetching: checking } = useQuery<NameCheckResponse>(
    {
      queryKey: ["admin", "org-name-check", debounced],
      enabled: debounced.length >= 2,
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
            listId: newOrgListId ?? undefined,
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
      setNewOrgListId(null);
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["admin", "org-claim-links"],
        }),
        queryClient.invalidateQueries({ queryKey: ["admin", "org-lists"] }),
      ]);
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
    queryKey: ["admin", "org-claim-links", listFilter],
    queryFn: () =>
      customFetch<ClaimLinksResponse>(
        `/api/v1/admin/org-claim-links${listFilter !== "all" ? `?listId=${encodeURIComponent(listFilter)}` : ""}`,
        { method: "GET" },
      ),
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
      sortByList(
        filtered
          .filter((r) => r.quickSetupAt)
          .sort((a, b) =>
            (b.quickSetupAt as string).localeCompare(a.quickSetupAt as string),
          ),
        listSort,
      ),
    [filtered, listSort],
  );
  const otherRows = useMemo(
    () =>
      sortByList(
        filtered.filter((r) => !r.quickSetupAt),
        listSort,
      ),
    [filtered, listSort],
  );

  const visibleIds = useMemo(() => filtered.map((row) => row.id), [filtered]);
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
  const someVisibleSelected = visibleIds.some((id) => selectedIds.has(id));

  const toggleSelected = (id: string, selected: boolean) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (selected) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const toggleAllVisible = (selected: boolean) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const id of visibleIds) {
        if (selected) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  };

  const closeDeleteOrganizations = () => {
    if (deletingOrganizations) return;
    setDeleteScope(null);
    setDeleteConfirmation("");
  };

  const deleteOrganizations = async () => {
    if (!deleteScope || deletingOrganizations) return;
    const organizationIds =
      deleteScope.kind === "selected" ? [...selectedIds] : undefined;
    if (deleteScope.kind === "selected" && organizationIds?.length === 0)
      return;
    setDeletingOrganizations(true);
    try {
      const response = await customFetch<BulkDeleteResult>(
        "/api/v1/admin/org-claim-links/bulk-delete",
        {
          method: "POST",
          body: JSON.stringify(
            deleteScope.kind === "list"
              ? {
                  listId: deleteScope.list.id,
                  deleteList: true,
                  confirm: deleteConfirmation,
                }
              : {
                  organizationIds,
                  confirm: deleteConfirmation,
                },
          ),
        },
      );
      setSelectedIds(new Set());
      if (deleteScope.kind === "list" && listFilter === deleteScope.list.id) {
        setListFilter("all");
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin", "organizations"] }),
        queryClient.invalidateQueries({ queryKey: ["admin", "org-lists"] }),
        queryClient.invalidateQueries({
          queryKey: ["admin", "org-claim-links"],
        }),
      ]);
      const blocked = response.data.protectedCount + response.data.missingCount;
      toast({
        title: `Permanently deleted ${response.data.deletedCount} organization${
          response.data.deletedCount === 1 ? "" : "s"
        }`,
        description:
          blocked > 0
            ? `${response.data.protectedCount} claimed organization${
                response.data.protectedCount === 1 ? " was" : "s were"
              } protected${
                response.data.missingCount
                  ? `; ${response.data.missingCount} could not be found`
                  : ""
              }.`
            : response.data.listDeleted
              ? `The list "${response.data.list?.name}" was also deleted.`
              : "The selected ownerless pages and their dependent data were removed.",
      });
      setDeleteScope(null);
      setDeleteConfirmation("");
    } catch (err) {
      toast({
        title: "Organizations could not be deleted",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setDeletingOrganizations(false);
    }
  };

  const toggleMessaged = async (id: string, messaged: boolean) => {
    try {
      await customFetch(`/api/v1/admin/org-claim-links/${id}/messaged`, {
        method: "PATCH",
        body: JSON.stringify({ messaged }),
      });
      await queryClient.invalidateQueries({
        queryKey: ["admin", "org-claim-links"],
      });
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
      await queryClient.invalidateQueries({
        queryKey: ["admin", "org-claim-links"],
      });
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
      toast({
        title: "Couldn't copy — select and copy manually",
        variant: "destructive",
      });
    }
  };

  const sendOwnerInvite = async () => {
    if (!emailInviteOrg || !ownerEmail.trim() || sendingOwnerEmail) return;
    setSendingOwnerEmail(true);
    try {
      await customFetch(
        `/api/v1/admin/org-claim-links/${emailInviteOrg.id}/email-owner-invite`,
        {
          method: "POST",
          body: JSON.stringify({ email: ownerEmail.trim() }),
        },
      );
      await queryClient.invalidateQueries({
        queryKey: ["admin", "org-claim-links"],
      });
      toast({
        title: `Owner invitation sent to ${ownerEmail.trim()}`,
        description: `The email explains Kinectem, includes the secure claim link, and walks through setting up ${emailInviteOrg.name}.`,
      });
      setEmailInviteOrg(null);
      setOwnerEmail("");
    } catch (err) {
      toast({
        title: "Couldn't send owner invitation",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setSendingOwnerEmail(false);
    }
  };

  const exportCsv = () => {
    const exportRows = [...quickSetupRows, ...otherRows];
    if (exportRows.length === 0) {
      toast({
        title: "Nothing to export",
        description: "No unclaimed organizations match the current filters.",
      });
      return;
    }
    const csv = rowsToCsv(exportRows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 10);
    const scope =
      listFilter === "all"
        ? "all-orgs"
        : listFilter === "none"
          ? "unlisted"
          : exportSlug(
              lists.find((list) => list.id === listFilter)?.name ??
                "selected-list",
            );
    a.href = url;
    a.download = `kinectem-org-claim-links-${scope}-${stamp}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-black">
            {embedded ? "Claim links & setup" : "Org Links"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {embedded
              ? "Create and organize ownerless organization pages, then send each secure claim link to the right organization."
              : "Secret invite links for ownerless organization pages. Send each link to the right org — whoever signs up through it becomes the owner."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Task #829 — one-page org setup: org info + teams + coaches, one save. */}
          <Button asChild data-testid="btn-org-quick-setup">
            <Link href="/admin/org-quick-setup">Quick setup</Link>
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
              <BrandColorSwapButton
                testId="btn-swap-add-org-brand-colors"
                onSwap={() => {
                  const currentPrimary = primaryColor;
                  setPrimaryColor(secondaryColor);
                  setSecondaryColor(currentPrimary);
                }}
              />
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
                    onClick={() =>
                      setTier((cur) => (cur === p.id ? null : p.id))
                    }
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

        {/* Task #929 — optional list to file this org under right away. */}
        <div className="mt-3">
          <Label htmlFor="add-org-list">List (optional)</Label>
          <p className="text-xs text-muted-foreground mb-1.5">
            Group this org under a named list (e.g. a league or tournament).
          </p>
          <Select
            value={newOrgListId ?? "__none__"}
            onValueChange={(v) => setNewOrgListId(v === "__none__" ? null : v)}
          >
            <SelectTrigger
              className="max-w-xs"
              data-testid="select-add-org-list"
            >
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

        {debounced.length >= 2 && (
          <div className="mt-3" data-testid="add-org-matches">
            {exactMatch ? (
              <p
                className="text-sm font-medium text-destructive"
                data-testid="add-org-duplicate-warning"
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
                data-testid="add-org-no-match"
              >
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

      {/* Task #929 — named lists group ownerless orgs (e.g. per league). */}
      <div className="rounded-lg border bg-card p-4 mb-5">
        <h2 className="text-sm font-bold mb-1">Lists</h2>
        <p className="text-xs text-muted-foreground mb-3">
          Group the orgs you set up into named lists. Deleting a list never
          deletes or affects its orgs.
        </p>
        <div className="flex items-center gap-2 flex-wrap mb-3">
          <Select value={listFilter} onValueChange={setListFilter}>
            <SelectTrigger className="w-56" data-testid="select-list-filter">
              <SelectValue placeholder="All orgs" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All orgs</SelectItem>
              <SelectItem value="none">Unlisted</SelectItem>
              {lists.map((l) => (
                <SelectItem key={l.id} value={l.id}>
                  {l.name} ({l.orgCount})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {listFilter !== "all" && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setListFilter("all")}
              data-testid="btn-clear-list-filter"
            >
              Clear filter
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={exportCsv}
            disabled={isLoading}
            title="Download the currently filtered unclaimed organizations as a CSV"
            data-testid="btn-export-claim-links-csv"
          >
            <Download className="h-3.5 w-3.5 mr-1" />
            Export CSV
          </Button>
        </div>
        <div className="flex items-center gap-2 flex-wrap mb-2">
          <Input
            placeholder="New list name (e.g. Fall 2026 Soccer League)"
            value={newListName}
            onChange={(e) => setNewListName(e.target.value)}
            onKeyDown={async (e) => {
              if (e.key === "Enter" && newListName.trim() && !creatingList) {
                const created = await createList(newListName);
                if (created) setNewListName("");
              }
            }}
            className="max-w-sm"
            data-testid="input-new-list-name"
          />
          <Button
            size="sm"
            variant="secondary"
            disabled={!newListName.trim() || creatingList}
            onClick={async () => {
              const created = await createList(newListName);
              if (created) setNewListName("");
            }}
            data-testid="btn-create-list"
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            {creatingList ? "Creating…" : "New list"}
          </Button>
        </div>
        {lists.length > 0 && (
          <ul className="flex flex-wrap gap-2" data-testid="lists-manage">
            {lists.map((l) => (
              <li
                key={l.id}
                className="flex items-center gap-1 rounded-full border bg-muted/40 pl-3 pr-1 py-1 text-xs"
                data-testid={`list-chip-${l.id}`}
              >
                <span>
                  {l.name}{" "}
                  <span className="text-muted-foreground">({l.orgCount})</span>
                </span>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-5 w-5"
                  aria-label={`Delete list ${l.name}`}
                  onClick={() => setListToDelete(l)}
                  data-testid={`btn-delete-list-${l.id}`}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  className="h-6 px-2 text-[11px]"
                  aria-label={`Permanently delete organizations in list ${l.name} and delete the list`}
                  onClick={() => {
                    setDeleteConfirmation("");
                    setDeleteScope({ kind: "list", list: l });
                  }}
                  data-testid={`btn-delete-list-and-orgs-${l.id}`}
                >
                  Delete orgs + list
                </Button>
              </li>
            ))}
          </ul>
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
        <div
          className="text-sm text-muted-foreground"
          data-testid="claim-links-count"
        >
          {rows.length} ownerless page{rows.length === 1 ? "" : "s"}
        </div>
        <Button
          variant="destructive"
          size="sm"
          disabled={selectedIds.size === 0}
          onClick={() => {
            setDeleteConfirmation("");
            setDeleteScope({ kind: "selected" });
          }}
          data-testid="btn-delete-selected-orgs"
        >
          <Trash2 className="h-3.5 w-3.5 mr-1" />
          Permanently delete {selectedIds.size} selected
        </Button>
      </div>

      <AlertDialog
        open={!!listToDelete}
        onOpenChange={(open) => !open && setListToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{listToDelete?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              {listToDelete?.orgCount ?? 0} org
              {(listToDelete?.orgCount ?? 0) === 1 ? "" : "s"} in this list will
              become unlisted. The organizations themselves are not affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => listToDelete && deleteList(listToDelete)}
              data-testid="button-confirm-delete-list"
            >
              Delete list
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={!!deleteScope}
        onOpenChange={(open) => !open && closeDeleteOrganizations()}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deleteScope?.kind === "list"
                ? `Permanently delete "${deleteScope.list.name}" and its unclaimed organizations?`
                : `Permanently delete ${selectedIds.size} selected organization${
                    selectedIds.size === 1 ? "" : "s"
                  }?`}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  This cannot be undone. Teams, posts, invites, claim requests,
                  subscriptions, partner memberships, and related activity for
                  each still-unclaimed organization will be removed. Any
                  organization claimed before the final delete is protected.
                </p>
                <div className="space-y-1">
                  <Label htmlFor="delete-organizations-confirmation">
                    Type{" "}
                    <span className="font-mono font-bold text-foreground">
                      {deleteScope?.kind === "list"
                        ? deleteScope.list.name
                        : BULK_DELETE_CONFIRMATION}
                    </span>{" "}
                    to confirm
                  </Label>
                  <Input
                    id="delete-organizations-confirmation"
                    value={deleteConfirmation}
                    onChange={(event) =>
                      setDeleteConfirmation(event.target.value)
                    }
                    autoComplete="off"
                    data-testid="input-delete-organizations-confirmation"
                  />
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingOrganizations}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void deleteOrganizations();
              }}
              disabled={
                deletingOrganizations ||
                deleteConfirmation !==
                  (deleteScope?.kind === "list"
                    ? deleteScope.list.name
                    : BULK_DELETE_CONFIRMATION)
              }
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete-organizations"
            >
              {deletingOrganizations
                ? "Deleting…"
                : deleteScope?.kind === "list"
                  ? "Delete organizations and list"
                  : "Permanently delete organizations"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Dialog
        open={emailInviteOrg !== null}
        onOpenChange={(open) => {
          if (!open && !sendingOwnerEmail) {
            setEmailInviteOrg(null);
            setOwnerEmail("");
          }
        }}
      >
        <DialogContent
          className="sm:max-w-md"
          data-testid="dialog-email-owner-invite"
        >
          <DialogHeader>
            <DialogTitle className="font-black">
              Invite the organization owner
            </DialogTitle>
            <DialogDescription>
              Kinectem will email the secure claim link and explain how to claim
              and finish setting up {emailInviteOrg?.name}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="owner-invite-email">Owner email address</Label>
            <Input
              id="owner-invite-email"
              type="email"
              value={ownerEmail}
              onChange={(event) => setOwnerEmail(event.target.value)}
              placeholder="owner@club.org"
              autoComplete="email"
              onKeyDown={(event) => {
                if (event.key === "Enter") void sendOwnerInvite();
              }}
            />
            <p className="text-xs text-muted-foreground">
              This sends a private link that grants ownership after the
              recipient signs in and confirms the claim.
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setEmailInviteOrg(null);
                setOwnerEmail("");
              }}
              disabled={sendingOwnerEmail}
            >
              Cancel
            </Button>
            <Button
              onClick={sendOwnerInvite}
              disabled={!ownerEmail.trim() || sendingOwnerEmail}
              data-testid="btn-send-owner-invite"
            >
              <Mail className="mr-2 h-4 w-4" />
              {sendingOwnerEmail ? "Sending…" : "Send owner invitation"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {(() => {
        const renderRow = (r: ClaimLinkRow) => {
          const location = [r.city, r.state].filter(Boolean).join(", ");
          return (
            <TableRow key={r.id} data-testid={`row-claim-link-${r.id}`}>
              <TableCell>
                <Checkbox
                  checked={selectedIds.has(r.id)}
                  onCheckedChange={(value) =>
                    toggleSelected(r.id, value === true)
                  }
                  aria-label={`Select ${r.name} for permanent deletion`}
                  data-testid={`checkbox-delete-org-${r.id}`}
                />
              </TableCell>
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
              <TableCell className="text-xs font-mono text-muted-foreground">
                <div className="flex items-center gap-1">
                  <span
                    className="max-w-[140px] truncate"
                    title={claimUrl(r.token)}
                  >
                    {claimUrl(r.token)}
                  </span>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6 shrink-0"
                    onClick={() => copyLink(r.token)}
                    aria-label={`Copy claim link for ${r.name}`}
                    data-testid={`btn-copy-claim-link-${r.id}`}
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="ml-1 h-7 shrink-0 gap-1.5 px-2 text-xs font-bold"
                    onClick={() => {
                      setEmailInviteOrg(r);
                      setOwnerEmail("");
                    }}
                    data-testid={`btn-email-owner-invite-${r.id}`}
                  >
                    <Mail className="h-3.5 w-3.5" />
                    Email
                  </Button>
                </div>
              </TableCell>
              <TableCell className="w-32">
                <Select
                  value={r.listId ?? "__none__"}
                  onValueChange={(v) =>
                    assignOrgList(r.id, v === "__none__" ? null : v)
                  }
                >
                  <SelectTrigger
                    className="h-8 text-xs"
                    data-testid={`select-row-list-${r.id}`}
                  >
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
              </TableCell>
            </TableRow>
          );
        };
        const listSortIcon =
          listSort === "asc" ? (
            <ArrowUp className="h-3 w-3" />
          ) : listSort === "desc" ? (
            <ArrowDown className="h-3 w-3" />
          ) : (
            <ArrowUpDown className="h-3 w-3 opacity-50" />
          );
        const header = (
          <TableHeader>
            <TableRow>
              <TableHead className="w-[52px]">
                <Checkbox
                  checked={
                    allVisibleSelected
                      ? true
                      : someVisibleSelected
                        ? "indeterminate"
                        : false
                  }
                  onCheckedChange={(value) => toggleAllVisible(value === true)}
                  aria-label="Select all visible organizations for permanent deletion"
                  data-testid="checkbox-delete-select-all-visible"
                />
              </TableHead>
              <TableHead className="w-[110px]">Facebook</TableHead>
              <TableHead className="w-[110px]">Messaged</TableHead>
              <TableHead>Organization</TableHead>
              <TableHead>Location</TableHead>
              <TableHead>Claim link</TableHead>
              <TableHead>
                <button
                  type="button"
                  className="flex items-center gap-1 hover:text-foreground"
                  onClick={() =>
                    setListSort((cur) =>
                      cur === "asc" ? "desc" : cur === "desc" ? null : "asc",
                    )
                  }
                  aria-label="Sort by list"
                  data-testid="btn-sort-by-list"
                >
                  List
                  {listSortIcon}
                </button>
              </TableHead>
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
                <h2 className="text-sm font-bold mb-2">
                  All other unclaimed orgs
                </h2>
              )}
              <Table>
                {header}
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
                        No ownerless pages.
                      </TableCell>
                    </TableRow>
                  ) : otherRows.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={7}
                        className="text-center py-6 text-muted-foreground"
                      >
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
    </>
  );
}

export default function AdminOrgClaimLinks() {
  return (
    <AdminLayout>
      <OrgClaimLinksContent />
    </AdminLayout>
  );
}
