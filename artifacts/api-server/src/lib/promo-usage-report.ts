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
  plan: string;
  discountType: string;
  discountValue: number;
  endedAt: Date | null;
  endReason: string | null;
};

// Quote every cell and neutralize spreadsheet formulas, including values with
// leading whitespace/control characters before the formula marker.
export function csvCell(input: string): string {
  const safe = /^[\s\u0000-\u001f]*[=+\-@]/u.test(input) ? `'${input}` : input;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function usageCsv(rows: UsageRow[]): string {
  const headers = ["Promo code", "Organization", "Organization ID", "Applied by", "Account email", "Applied at (UTC)", "Time precision", "Plan at application", "Discount type", "Discount value", "Current status", "Ended at (UTC)"];
  const data = rows.map((r) => [
    r.code, r.organizationName, r.organizationId, r.actorName ?? "",
    r.actorEmail ?? "", r.appliedAt?.toISOString() ?? "",
    r.appliedAt ? "Exact" : "Legacy — exact time unknown",
    r.plan, r.discountType, String(r.discountValue),
    r.endedAt ? (r.endReason ?? "removed") : "Current",
    r.endedAt?.toISOString() ?? "",
  ]);
  return [headers, ...data].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}