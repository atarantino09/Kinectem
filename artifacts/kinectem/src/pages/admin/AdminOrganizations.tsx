import { useState } from "react";
import { formatOrgName } from "@/lib/format";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { AdminLayout } from "@/components/AdminLayout";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Building2 } from "lucide-react";

type AdminOrg = {
  organizationId: string;
  organizationName: string;
  plan: "starter" | "pro" | "elite" | null;
  status: "trialing" | "active" | "past_due" | "canceled" | null;
  billingStartsAt: string | null;
  subscribedAt: string | null;
  promoCode: string | null;
  promoDiscountType: "percent" | "amount" | null;
  promoDiscountValue: number | null;
  promoExpiresAt: string | null;
};

type AdminOrgsResponse = { data: AdminOrg[] };

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

export default function AdminOrganizations() {
  const [promoOnly, setPromoOnly] = useState(false);

  const { data, isLoading } = useQuery<AdminOrgsResponse>({
    queryKey: ["admin", "organizations", { promoOnly }],
    queryFn: () =>
      customFetch<AdminOrgsResponse>(
        `/api/v1/admin/organizations${promoOnly ? "?promoOnly=true" : ""}`,
        { method: "GET" },
      ),
  });

  const rows = data?.data ?? [];

  return (
    <AdminLayout>
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-black tracking-tight flex items-center gap-2">
            <Building2 className="w-6 h-6" /> Organizations
          </h1>
          <p className="text-sm text-muted-foreground">
            Every organization and its subscription plan, status, and applied
            promo code.
          </p>
        </div>
      </div>

      <div className="inline-flex rounded-lg border p-1 mb-4" role="tablist">
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
          Promo code applied
        </button>
      </div>

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
              <TableCell colSpan={7} className="text-center py-6 text-muted-foreground">
                Loading…
              </TableCell>
            </TableRow>
          ) : rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="text-center py-6 text-muted-foreground">
                {promoOnly
                  ? "No organizations have applied a promo code yet."
                  : "No organizations yet."}
              </TableCell>
            </TableRow>
          ) : (
            rows.map((r) => (
              <TableRow
                key={r.organizationId}
                data-testid={`row-org-${r.organizationId}`}
              >
                <TableCell className="font-medium">
                  {formatOrgName(r.organizationName)}
                </TableCell>
                <TableCell>{r.plan ? PLAN_LABELS[r.plan] : "None"}</TableCell>
                <TableCell>
                  {r.status ? (
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-bold ${STATUS_STYLES[r.status]}`}
                    >
                      {STATUS_LABELS[r.status]}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="text-sm whitespace-nowrap">
                  {r.subscribedAt
                    ? new Date(r.subscribedAt).toLocaleDateString()
                    : "—"}
                </TableCell>
                <TableCell>
                  {r.promoCode ? (
                    <span className="font-bold uppercase">{r.promoCode}</span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="text-sm">{formatDiscount(r)}</TableCell>
                <TableCell className="text-sm whitespace-nowrap">
                  {r.promoCode ? formatExpiry(r.promoExpiresAt) : "—"}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </AdminLayout>
  );
}
