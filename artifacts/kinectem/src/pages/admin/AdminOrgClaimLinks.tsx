import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { AdminLayout } from "@/components/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";

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
};

type ClaimLinksResponse = { data: ClaimLinkRow[] };

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
          <h1 className="text-2xl font-black">Claim links</h1>
          <p className="text-sm text-muted-foreground">
            Secret invite links for ownerless organization pages. Send each link
            to the right org — whoever signs up through it becomes the owner.
          </p>
        </div>
        <Button
          onClick={exportCsv}
          disabled={rows.length === 0}
          data-testid="btn-export-claim-links-csv"
        >
          Export CSV
        </Button>
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
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Organization</TableHead>
            <TableHead>Location</TableHead>
            <TableHead>Claim link</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableRow>
              <TableCell colSpan={4} className="text-center py-6 text-muted-foreground">
                Loading…
              </TableCell>
            </TableRow>
          ) : filtered.length === 0 ? (
            <TableRow>
              <TableCell colSpan={4} className="text-center py-6 text-muted-foreground">
                No ownerless pages.
              </TableCell>
            </TableRow>
          ) : (
            filtered.map((r) => {
              const location = [r.city, r.state].filter(Boolean).join(", ");
              return (
                <TableRow key={r.id} data-testid={`row-claim-link-${r.id}`}>
                  <TableCell className="font-medium">{r.name}</TableCell>
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
            })
          )}
        </TableBody>
      </Table>
    </AdminLayout>
  );
}
