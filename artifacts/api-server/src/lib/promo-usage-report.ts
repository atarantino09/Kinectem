import { z } from "zod";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) =>
  !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
  new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value,
);
const query = z.object({
  from: date.optional(),
  to: date.optional(),
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  format: z.enum(["csv"]).optional(),
});

export function parseUsageFilters(input: unknown) {
  const parsed = query.safeParse(input);
  if (!parsed.success || (parsed.data.from && parsed.data.to && parsed.data.from > parsed.data.to)) {
    return null;
  }
  return parsed.data;
}

export type UsageRow = {
  id: string;
  code: string;
  organizationName: string;
  organizationId: string;
  actorName: string | null;
  actorEmail: string | null;
  appliedAt: Date | null;
  datePrecision?: "exact" | "estimated" | "unknown";
  plan: string;
  discountType: string;
  discountValue: number;
  freeUntil?: Date | null;
  endedAt: Date | null;
  endReason: string | null;
  billingStatus?: string;
  billedAt?: Date | null;
  actualDiscountCents?: number | null;
};

// Quote every cell and neutralize spreadsheet formulas, including values with
// leading whitespace/control characters before the formula marker.
export function csvCell(input: string): string {
  const safe = /^[\s\u0000-\u001f]*[=+\-@]/u.test(input) ? `'${input}` : input;
  return `"${safe.replace(/"/g, '""')}"`;
}

const billingLabels: Record<string, string> = {
  free_access_not_billed: "Free-access period; no paid invoice yet",
  full_price_after_free_access: "Paid after free-access period (no promo discount)",
  not_billed: "Not billed yet",
  discounted_paid: "Yes — discount applied to paid invoice",
  discounted_no_charge: "Applied to invoice — no payment due",
  paid_without_discount: "No — paid without this discount",
  discount_on_unpaid_invoice: "Discount on unpaid invoice",
  verification_unavailable: "Could not verify with Stripe",
  unknown: "Unknown",
};

export function usageCsv(rows: UsageRow[], dateFiltered = false): string {
  const headers = ["Promo code", "Organization", "Organization ID", "Applied by", "Account email", "Applied at (UTC)", "Time precision", "Date range match", "Plan at application", "Discount type", "Discount value", "Current status", "Ended at (UTC)", "Billing result", "Paid at (UTC)", "Actual discount (USD)"];
  const data = rows.map((r) => [
    r.code, r.organizationName, r.organizationId, r.actorName ?? "",
    r.actorEmail ?? "", r.appliedAt?.toISOString() ?? "Unknown (before tracking)",
    r.datePrecision === "estimated" ? "Estimated — subscription created"
      : r.appliedAt ? "Exact" : "Legacy — exact time unknown",
    r.appliedAt ? (dateFiltered ? r.datePrecision === "estimated" ? "Yes — estimated" : "Yes" : "Not filtered")
      : dateFiltered ? "Unknown — not attributable to selected range" : "Unknown date",
    r.plan, r.discountType, String(r.discountValue),
    r.endedAt ? (r.endReason ?? "removed") : "Current",
    r.endedAt?.toISOString() ?? "",
    billingLabels[r.billingStatus ?? "unknown"] ?? "Unknown",
    r.billedAt?.toISOString() ?? "",
    r.actualDiscountCents == null ? "" : (r.actualDiscountCents / 100).toFixed(2),
  ]);
  return [headers, ...data].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}