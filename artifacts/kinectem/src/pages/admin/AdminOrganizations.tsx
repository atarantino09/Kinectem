import { useMemo, useRef, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { AdminLayout } from "@/components/AdminLayout";
import { OrgClaimLinksContent } from "./AdminOrgClaimLinks";
import { AdminPartnerLanding } from "./AdminPartnerLanding";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  parseOrganizationImportFile,
  type OrgImportParseResult,
} from "@/lib/admin-org-import-file";
import { formatOrgName } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import {
  Building2,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Loader2,
  Upload,
} from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type AdminOrg = {
  organizationId: string;
  organizationName: string;
  plan: "starter" | "pro" | "elite" | null;
  status: "trialing" | "active" | "past_due" | "canceled" | null;
  billingStartsAt: string | null;
  subscribedAt: string | null;
  promoCode: string | null;
  pendingPromoCode: string | null;
  promoDiscountType: "percent" | "amount" | null;
  promoDiscountValue: number | null;
  promoExpiresAt: string | null;
};

type AdminOrgsResponse = { data: AdminOrg[] };
type PromoCode = {
  id: string;
  code: string;
  description: string | null;
  discountType: "percent" | "amount";
  discountValue: number;
  active: boolean;
  maxRedemptions: number | null;
  redemptionCount: number;
  expiresAt: string | null;
};
type OrgList = {
  id: string;
  name: string;
  orgCount: number;
  createdAt: string;
};
type BulkIssue = {
  scope: "file" | "organization" | "team";
  organizationIndex: number | null;
  teamIndex: number | null;
  message: string;
};
type BulkValidationResponse = {
  data: {
    valid: boolean;
    list: { id: string; name: string } | null;
    issues: BulkIssue[];
  };
};
type BulkImportResult = {
  data: {
    list: { id: string; name: string };
    promoCode: string | null;
    organizationCount: number;
    teamCount: number;
    organizations: Array<{
      id: string;
      name: string;
      token: string;
      teams: Array<{ id: string; name: string }>;
    }>;
  };
};

const PLAN_LABELS: Record<NonNullable<AdminOrg["plan"]>, string> = {
  starter: "Starter",
  pro: "Pro",
  elite: "Elite",
};

const STATUS_LABELS: Record<NonNullable<AdminOrg["status"]>, string> = {
  trialing: "Trialing",
  active: "Active",
  past_due: "Past due",
  canceled: "Canceled",
};

const STATUS_STYLES: Record<NonNullable<AdminOrg["status"]>, string> = {
  trialing: "bg-amber-100 text-amber-700",
  active: "bg-emerald-100 text-emerald-700",
  past_due: "bg-orange-100 text-orange-700",
  canceled: "bg-muted text-muted-foreground",
};

function formatDiscount(row: AdminOrg): string {
  if (!row.promoDiscountType || row.promoDiscountValue == null) return "—";
  return row.promoDiscountType === "percent"
    ? `${row.promoDiscountValue}%`
    : `$${row.promoDiscountValue.toLocaleString("en-US")} off`;
}

function formatExpiry(expiresAt: string | null): string {
  if (!expiresAt) return "No expiry";
  const d = new Date(expiresAt);
  if (d.getTime() < Date.now()) return "Expired";
  return d.toLocaleDateString();
}

function claimUrl(token: string): string {
  return `${window.location.origin}${import.meta.env.BASE_URL}claim/${token}`;
}

function csvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function exportBulkResult(result: BulkImportResult["data"]) {
  const rows = [
    [
      "organization_name",
      "team_count",
      "claim_link",
      "organization_id",
      "list",
    ],
    ...result.organizations.map((organization) => [
      organization.name,
      String(organization.teams.length),
      claimUrl(organization.token),
      organization.id,
      result.list.name,
    ]),
  ];
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
  const url = URL.createObjectURL(
    new Blob([csv], { type: "text/csv;charset=utf-8" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `kinectem-${result.list.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-claim-links.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export default function AdminOrganizations() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const search = useSearch();
  const sectionParam = new URLSearchParams(search).get("section");
  const partnerEditSlug = new URLSearchParams(search).get("edit") ?? undefined;
  const activeSection =
    sectionParam === "claim-links"
      ? "claim-links"
      : sectionParam === "partner"
        ? "partner"
        : "overview";
  const [promoOnly, setPromoOnly] = useState(false);
  const [parseResult, setParseResult] = useState<OrgImportParseResult | null>(
    null,
  );
  const [fileName, setFileName] = useState("");
  const [fileError, setFileError] = useState<string | null>(null);
  const [listName, setListName] = useState("");
  const [promoCode, setPromoCode] = useState("");
  const [serverIssues, setServerIssues] = useState<BulkIssue[]>([]);
  const [checkingImport, setCheckingImport] = useState(false);
  const [importing, setImporting] = useState(false);
  const [validated, setValidated] = useState(false);
  const [importResult, setImportResult] = useState<
    BulkImportResult["data"] | null
  >(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const selectSection = (section: "overview" | "claim-links" | "partner") => {
    setLocation(
      section === "claim-links"
        ? "/admin/organizations?section=claim-links"
        : section === "partner"
          ? "/admin/organizations?section=partner"
          : "/admin/organizations",
    );
  };

  const { data, isLoading } = useQuery<AdminOrgsResponse>({
    queryKey: ["admin", "organizations", { promoOnly }],
    queryFn: () =>
      customFetch<AdminOrgsResponse>(
        `/api/v1/admin/organizations${promoOnly ? "?promoOnly=true" : ""}`,
        { method: "GET" },
      ),
  });
  const { data: promoData } = useQuery<{ data: PromoCode[] }>({
    queryKey: ["admin", "promo-codes"],
    queryFn: () =>
      customFetch<{ data: PromoCode[] }>("/api/v1/admin/promo-codes", {
        method: "GET",
      }),
  });
  const { data: listData } = useQuery<{ data: OrgList[] }>({
    queryKey: ["admin", "org-lists"],
    queryFn: () =>
      customFetch<{ data: OrgList[] }>("/api/v1/admin/org-lists", {
        method: "GET",
      }),
  });

  const rows = data?.data ?? [];
  const lists = listData?.data ?? [];
  const availablePromos = useMemo(
    () =>
      (promoData?.data ?? []).filter(
        (promo) =>
          promo.active &&
          (!promo.expiresAt ||
            new Date(promo.expiresAt).getTime() > Date.now()) &&
          (promo.maxRedemptions == null ||
            promo.redemptionCount < promo.maxRedemptions),
      ),
    [promoData],
  );
  const payloadOrganizations = useMemo(
    () =>
      parseResult?.groups.map((group) => ({
        name: group.name,
        teams: group.teams,
      })) ?? [],
    [parseResult],
  );
  const allIssues = useMemo(
    () => [
      ...(parseResult?.errors ?? []).map((message) => ({ message })),
      ...serverIssues.map((issue) => ({ message: issue.message })),
    ],
    [parseResult, serverIssues],
  );

  const resetImport = () => {
    setParseResult(null);
    setFileName("");
    setFileError(null);
    setListName("");
    setPromoCode("");
    setServerIssues([]);
    setValidated(false);
    setImportResult(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const onFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setFileError(null);
    setServerIssues([]);
    setValidated(false);
    setImportResult(null);
    try {
      const parsed = await parseOrganizationImportFile(file);
      setParseResult(parsed);
      setFileName(file.name);
    } catch (error) {
      setParseResult(null);
      setFileName("");
      setFileError(
        error instanceof Error ? error.message : "Couldn't read that file.",
      );
    }
  };

  const validateImport = async () => {
    if (!parseResult || !listName.trim()) return;
    setCheckingImport(true);
    setServerIssues([]);
    setValidated(false);
    try {
      const response = await customFetch<BulkValidationResponse>(
        "/api/v1/admin/org-bulk-import/validate",
        {
          method: "POST",
          body: JSON.stringify({
            listName: listName.trim(),
            promoCode: promoCode || null,
            organizations: payloadOrganizations,
          }),
        },
      );
      setServerIssues(response.data.issues);
      setValidated(response.data.valid && parseResult.errors.length === 0);
    } catch (error) {
      setServerIssues([
        {
          scope: "file",
          organizationIndex: null,
          teamIndex: null,
          message:
            error instanceof Error
              ? error.message
              : "Couldn't validate this import.",
        },
      ]);
    } finally {
      setCheckingImport(false);
    }
  };

  const runImport = async () => {
    if (!validated || !parseResult) return;
    setImporting(true);
    try {
      const response = await customFetch<BulkImportResult>(
        "/api/v1/admin/org-bulk-import",
        {
          method: "POST",
          body: JSON.stringify({
            listName: listName.trim(),
            promoCode: promoCode || null,
            organizations: payloadOrganizations,
          }),
        },
      );
      setImportResult(response.data);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin", "organizations"] }),
        queryClient.invalidateQueries({ queryKey: ["admin", "org-lists"] }),
        queryClient.invalidateQueries({
          queryKey: ["admin", "org-claim-links"],
        }),
      ]);
      toast({
        title: `Imported ${response.data.organizationCount} organizations`,
        description: `All organizations were added to "${response.data.list.name}".`,
      });
    } catch (error) {
      setValidated(false);
      toast({
        title: "Import could not be completed",
        description:
          error instanceof Error
            ? error.message
            : "Please review the file and try again.",
        variant: "destructive",
      });
    } finally {
      setImporting(false);
    }
  };

  return (
    <AdminLayout>
      <div className="space-y-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-black tracking-tight flex items-center gap-2">
              <Building2 className="w-6 h-6" /> Organizations
            </h1>
            <p className="text-sm text-muted-foreground">
              Manage organization billing, imports, and claim-link handoffs in
              one place.
            </p>
          </div>
        </div>

        <div
          className="inline-flex max-w-full flex-wrap rounded-lg border bg-muted/30 p-1"
          role="tablist"
          aria-label="Organization admin sections"
          data-testid="admin-org-sections"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeSection === "overview"}
            onClick={() => selectSection("overview")}
            className={`rounded-md px-3 py-2 text-sm font-semibold ${
              activeSection === "overview"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
            data-testid="tab-org-overview"
          >
            Overview & imports
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeSection === "claim-links"}
            onClick={() => selectSection("claim-links")}
            className={`rounded-md px-3 py-2 text-sm font-semibold ${
              activeSection === "claim-links"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
            data-testid="tab-org-claim-links"
          >
            Claim links & setup
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeSection === "partner"}
            onClick={() => selectSection("partner")}
            className={`rounded-md px-3 py-2 text-sm font-semibold ${
              activeSection === "partner"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
            data-testid="tab-org-partner"
          >
            Partner landing page
          </button>
        </div>

        {activeSection === "partner" ? (
          <AdminPartnerLanding initialSlug={partnerEditSlug} />
        ) : activeSection === "claim-links" ? (
          <OrgClaimLinksContent embedded />
        ) : (
          <div className="space-y-5" data-testid="admin-org-overview">
            <Card data-testid="card-org-bulk-import">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileSpreadsheet className="h-5 w-5" /> Import partner
                  organizations
                </CardTitle>
                <CardDescription>
                  Upload a CSV or Excel file with one organization per column.
                  The first populated cell is the organization name; cells below
                  it are team names. Nothing is created until you review and
                  confirm.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {!importResult ? (
                  <>
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label htmlFor="bulk-org-file">Organization file</Label>
                        <input
                          ref={fileInputRef}
                          id="bulk-org-file"
                          type="file"
                          accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                          className="sr-only"
                          onChange={onFileChange}
                          data-testid="input-org-bulk-file"
                        />
                        <div className="flex items-center gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => fileInputRef.current?.click()}
                            data-testid="btn-org-bulk-upload"
                          >
                            <Upload className="h-4 w-4 mr-2" /> Choose file
                          </Button>
                          <span className="text-sm text-muted-foreground truncate">
                            {fileName || "CSV or Excel, up to 10 MB"}
                          </span>
                        </div>
                        {fileError && (
                          <p
                            className="text-sm text-destructive"
                            data-testid="bulk-file-error"
                          >
                            {fileError}
                          </p>
                        )}
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="bulk-list-name">List name</Label>
                        <Input
                          id="bulk-list-name"
                          value={listName}
                          onChange={(event) => {
                            setListName(event.target.value);
                            setValidated(false);
                            setServerIssues([]);
                          }}
                          list="existing-org-lists"
                          placeholder="e.g. Fall 2026 Partner League"
                          data-testid="input-org-bulk-list-name"
                        />
                        <datalist id="existing-org-lists">
                          {lists.map((list) => (
                            <option key={list.id} value={list.name} />
                          ))}
                        </datalist>
                        <p className="text-xs text-muted-foreground">
                          Every imported organization will be grouped on this
                          list. An existing name reuses that list.
                        </p>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="bulk-promo-code">
                        Promo code for this batch (optional)
                      </Label>
                      <Select
                        value={promoCode || "__none__"}
                        onValueChange={(value) => {
                          setPromoCode(value === "__none__" ? "" : value);
                          setValidated(false);
                          setServerIssues([]);
                        }}
                      >
                        <SelectTrigger
                          id="bulk-promo-code"
                          className="max-w-md"
                          data-testid="select-org-bulk-promo"
                        >
                          <SelectValue placeholder="No promo code" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">
                            No promo code
                          </SelectItem>
                          {availablePromos.map((promo) => (
                            <SelectItem key={promo.id} value={promo.code}>
                              {promo.code.toUpperCase()} ·{" "}
                              {promo.discountType === "percent"
                                ? `${promo.discountValue}% off`
                                : `$${promo.discountValue} off`}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        If selected, the code is staged for each organization
                        and applied later when its owner sets up billing.
                      </p>
                    </div>

                    {parseResult && (
                      <div
                        className="rounded-lg border bg-muted/20 p-3 space-y-3"
                        data-testid="bulk-import-preview"
                      >
                        <div className="flex items-center justify-between gap-3 flex-wrap">
                          <div>
                            <div className="font-bold">Preview</div>
                            <div className="text-sm text-muted-foreground">
                              {parseResult.groups.length} organizations ·{" "}
                              {parseResult.totalTeams} teams
                            </div>
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {parseResult.rowCount} rows ·{" "}
                            {parseResult.columnCount} columns scanned
                          </span>
                        </div>
                        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                          {parseResult.groups.map((group) => (
                            <div
                              key={group.column}
                              className="rounded-md border bg-background p-3"
                              data-testid={`bulk-preview-column-${group.column}`}
                            >
                              <div className="flex items-baseline justify-between gap-2">
                                <span className="font-semibold truncate">
                                  {group.name}
                                </span>
                                <span className="text-xs text-muted-foreground">
                                  {group.column}
                                </span>
                              </div>
                              {group.teams.length > 0 ? (
                                <ul className="mt-2 text-xs text-muted-foreground space-y-0.5">
                                  {group.teams
                                    .slice(0, 5)
                                    .map((team, index) => (
                                      <li
                                        key={`${team}-${index}`}
                                        className="truncate"
                                      >
                                        {team}
                                      </li>
                                    ))}
                                  {group.teams.length > 5 && (
                                    <li>
                                      + {group.teams.length - 5} more teams
                                    </li>
                                  )}
                                </ul>
                              ) : (
                                <p className="mt-2 text-xs text-amber-700">
                                  No teams
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                        {(parseResult.warnings.length > 0 ||
                          allIssues.length > 0) && (
                          <div
                            className="space-y-1.5"
                            data-testid="bulk-import-issues"
                          >
                            {parseResult.warnings.map((warning) => (
                              <p
                                key={warning}
                                className="text-sm text-amber-700"
                              >
                                {warning}
                              </p>
                            ))}
                            {allIssues.map((issue, index) => (
                              <p
                                key={`${issue.message}-${index}`}
                                className="text-sm text-destructive"
                              >
                                {issue.message}
                              </p>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    <div className="flex items-center gap-2 flex-wrap">
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => void validateImport()}
                        disabled={
                          checkingImport ||
                          !parseResult ||
                          parseResult.errors.length > 0 ||
                          !listName.trim()
                        }
                        data-testid="btn-org-bulk-check"
                      >
                        {checkingImport ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : null}
                        Check import
                      </Button>
                      <Button
                        type="button"
                        onClick={() => void runImport()}
                        disabled={!validated || importing}
                        data-testid="btn-org-bulk-import"
                      >
                        {importing ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : null}
                        Create organizations
                      </Button>
                      {(parseResult || fileError) && (
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={resetImport}
                        >
                          Clear
                        </Button>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="space-y-4" data-testid="bulk-import-success">
                    <div className="flex items-start gap-3">
                      <CheckCircle2 className="h-6 w-6 text-emerald-600 shrink-0" />
                      <div>
                        <h2 className="font-bold">
                          {importResult.organizationCount} organizations created
                        </h2>
                        <p className="text-sm text-muted-foreground">
                          {importResult.teamCount} teams were created and every
                          organization was added to “{importResult.list.name}”.
                          {importResult.promoCode ? (
                            <>
                              Promo code{" "}
                              <span className="font-semibold uppercase">
                                {importResult.promoCode}
                              </span>{" "}
                              is staged for each one.
                            </>
                          ) : (
                            "No promo code was assigned."
                          )}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => exportBulkResult(importResult)}
                        data-testid="btn-export-bulk-claim-links"
                      >
                        <Download className="h-4 w-4 mr-2" /> Export claim links
                      </Button>
                      <Button
                        type="button"
                        onClick={resetImport}
                        data-testid="btn-new-bulk-import"
                      >
                        Import another file
                      </Button>
                    </div>
                    <div className="overflow-x-auto rounded-md border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Organization</TableHead>
                            <TableHead>Teams</TableHead>
                            <TableHead>Claim link</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {importResult.organizations.map((organization) => (
                            <TableRow key={organization.id}>
                              <TableCell className="font-medium whitespace-nowrap">
                                {organization.name}
                              </TableCell>
                              <TableCell>{organization.teams.length}</TableCell>
                              <TableCell className="font-mono text-xs whitespace-nowrap">
                                {claimUrl(organization.token)}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <div className="inline-flex rounded-lg border p-1" role="tablist">
              <button
                type="button"
                onClick={() => setPromoOnly(false)}
                className={`px-3 py-1.5 rounded-md text-sm font-semibold ${
                  !promoOnly
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                data-testid="tab-all-orgs"
              >
                All organizations
              </button>
              <button
                type="button"
                onClick={() => setPromoOnly(true)}
                className={`px-3 py-1.5 rounded-md text-sm font-semibold ${
                  promoOnly
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                data-testid="tab-promo-orgs"
              >
                Promo code applied or staged
              </button>
            </div>

            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Organization</TableHead>
                    <TableHead>Plan</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Subscribed</TableHead>
                    <TableHead>Promo code</TableHead>
                    <TableHead>Discount</TableHead>
                    <TableHead>Code expiry</TableHead>
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
                  ) : rows.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={7}
                        className="text-center py-6 text-muted-foreground"
                      >
                        {promoOnly
                          ? "No organizations have an applied or staged promo code."
                          : "No organizations yet."}
                      </TableCell>
                    </TableRow>
                  ) : (
                    rows.map((row) => (
                      <TableRow
                        key={row.organizationId}
                        data-testid={`row-org-${row.organizationId}`}
                      >
                        <TableCell className="font-medium">
                          {formatOrgName(row.organizationName)}
                        </TableCell>
                        <TableCell>
                          {row.plan ? PLAN_LABELS[row.plan] : "None"}
                        </TableCell>
                        <TableCell>
                          {row.status ? (
                            <span
                              className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-bold ${STATUS_STYLES[row.status]}`}
                            >
                              {STATUS_LABELS[row.status]}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm whitespace-nowrap">
                          {row.subscribedAt
                            ? new Date(row.subscribedAt).toLocaleDateString()
                            : "—"}
                        </TableCell>
                        <TableCell>
                          {row.promoCode ? (
                            <div>
                              <span className="font-bold uppercase">
                                {row.promoCode}
                              </span>
                              <span className="ml-1.5 text-xs text-emerald-700">
                                Applied
                              </span>
                            </div>
                          ) : row.pendingPromoCode ? (
                            <div>
                              <span className="font-bold uppercase">
                                {row.pendingPromoCode}
                              </span>
                              <span className="ml-1.5 text-xs text-amber-700">
                                Staged
                              </span>
                            </div>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm">
                          {formatDiscount(row)}
                        </TableCell>
                        <TableCell className="text-sm whitespace-nowrap">
                          {row.promoCode || row.pendingPromoCode
                            ? formatExpiry(row.promoExpiresAt)
                            : "—"}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
