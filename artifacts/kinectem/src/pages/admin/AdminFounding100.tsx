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

type FoundingSignup = {
  id: string;
  orgName: string;
  adminName: string;
  adminEmail: string;
  roleTitle: string;
  estimatedTeams: number;
  estimatedPlayers: number;
  sport: string | null;
  submittedAt: string;
  updatedAt: string;
};

type FoundingSignupsResponse = {
  data: FoundingSignup[];
  pagination: { nextCursor: string | null; hasMore: boolean; totalCount: number };
};

// RFC 4180 CSV escaping: wrap in quotes if the value contains quote, comma,
// or newline; double up any embedded quotes.
function csvCell(v: string | number | null): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function rowsToCsv(rows: FoundingSignup[]): string {
  const header = [
    "submitted_at",
    "org_name",
    "admin_name",
    "admin_email",
    "role_title",
    "estimated_teams",
    "estimated_players",
    "sport",
    "updated_at",
    "id",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.submittedAt,
        r.orgName,
        r.adminName,
        r.adminEmail,
        r.roleTitle,
        r.estimatedTeams,
        r.estimatedPlayers,
        r.sport ?? "",
        r.updatedAt,
        r.id,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return lines.join("\n");
}

export default function AdminFounding100() {
  const [q, setQ] = useState("");
  const { toast } = useToast();

  const { data, isLoading } = useQuery<FoundingSignupsResponse>({
    queryKey: ["admin", "founding-signups"],
    queryFn: () =>
      customFetch<FoundingSignupsResponse>(`/api/v1/admin/founding-signups`, {
        method: "GET",
      }),
  });

  const filtered = useMemo(() => {
    const rows = data?.data ?? [];
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r) => {
      return (
        r.orgName.toLowerCase().includes(needle) ||
        r.adminName.toLowerCase().includes(needle) ||
        r.adminEmail.toLowerCase().includes(needle) ||
        (r.sport ?? "").toLowerCase().includes(needle)
      );
    });
  }, [data, q]);

  const exportCsv = () => {
    const rows = data?.data ?? [];
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
    a.download = `kinectem-founding-100-${stamp}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const totalCount = data?.pagination.totalCount ?? 0;

  return (
    <AdminLayout>
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-black">Founding 100</h1>
          <p className="text-sm text-muted-foreground">
            Pre-launch organization signups from the marketing site.
          </p>
        </div>
        <Button
          onClick={exportCsv}
          disabled={totalCount === 0}
          data-testid="btn-export-founding-csv"
        >
          Export CSV
        </Button>
      </div>
      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <Input
          placeholder="Search organization, name, email, sport..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="max-w-md"
          data-testid="input-founding-search"
        />
        <div className="text-sm text-muted-foreground" data-testid="founding-count">
          {totalCount} total signup{totalCount === 1 ? "" : "s"}
        </div>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Submitted</TableHead>
            <TableHead>Organization</TableHead>
            <TableHead>Admin</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Role</TableHead>
            <TableHead className="text-right">Teams</TableHead>
            <TableHead className="text-right">Players</TableHead>
            <TableHead>Sport</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableRow>
              <TableCell colSpan={8} className="text-center py-6 text-muted-foreground">
                Loading…
              </TableCell>
            </TableRow>
          ) : filtered.length === 0 ? (
            <TableRow>
              <TableCell colSpan={8} className="text-center py-6 text-muted-foreground">
                No signups yet.
              </TableCell>
            </TableRow>
          ) : (
            filtered.map((r) => (
              <TableRow key={r.id} data-testid={`row-founding-${r.adminEmail}`}>
                <TableCell className="text-sm whitespace-nowrap">
                  {new Date(r.submittedAt).toLocaleDateString()}
                </TableCell>
                <TableCell className="font-medium">{r.orgName}</TableCell>
                <TableCell>{r.adminName}</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {r.adminEmail}
                </TableCell>
                <TableCell className="text-sm">{r.roleTitle}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {r.estimatedTeams}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {r.estimatedPlayers}
                </TableCell>
                <TableCell className="text-sm">{r.sport ?? "—"}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </AdminLayout>
  );
}
