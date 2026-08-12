import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { customFetch } from "@workspace/api-client-react";
import { AdminLayout } from "@/components/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Download } from "lucide-react";

// Admin "Claims" tracker — one place to see every organization and
// competition that has been claimed: what, by whom, when, and how.

type ClaimedOrg = {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  ownerId: string;
  ownerName: string;
  ownerEmail: string | null;
  claimedAt: string | null;
  method: "request" | "link";
};

type ClaimedCompetition = {
  id: string;
  slug: string;
  name: string;
  type: string;
  startDate: string;
  endDate: string;
  ownerId: string | null;
  ownerName: string;
  ownerEmail: string | null;
};

type SlotClaim = {
  participantId: string;
  competitionId: string;
  competitionSlug: string;
  competitionName: string;
  slotName: string;
  division: string;
  teamId: string | null;
  teamName: string | null;
  claimedById: string | null;
  claimedByName: string;
  claimedByEmail: string | null;
  claimedAt: string | null;
};

type ClaimsResponse = {
  organizations: {
    totals: { seeded: number; claimed: number };
    claimed: ClaimedOrg[];
  };
  competitions: {
    totals: { seeded: number; claimed: number };
    claimed: ClaimedCompetition[];
  };
  slotClaims: SlotClaim[];
};

// RFC 4180 CSV escaping.
function csvCell(v: string | null | undefined): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function downloadCsv(filename: string, header: string[], rows: string[][]) {
  const csv = [header.join(",")]
    .concat(rows.map((r) => r.map(csvCell).join(",")))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function AdminClaims() {
  const [q, setQ] = useState("");

  const { data, isLoading, isError } = useQuery<ClaimsResponse>({
    queryKey: ["admin", "claims"],
    queryFn: () => customFetch("/api/v1/admin/claims"),
  });

  const needle = q.trim().toLowerCase();
  const match = (...parts: (string | null | undefined)[]) =>
    !needle ||
    parts.some((p) => (p ?? "").toLowerCase().includes(needle));

  const orgs = useMemo(
    () =>
      (data?.organizations.claimed ?? []).filter((r) =>
        match(r.name, r.ownerName, r.ownerEmail, r.city, r.state),
      ),
    [data, needle],
  );
  const comps = useMemo(
    () =>
      (data?.competitions.claimed ?? []).filter((r) =>
        match(r.name, r.ownerName, r.ownerEmail),
      ),
    [data, needle],
  );
  const slots = useMemo(
    () =>
      (data?.slotClaims ?? []).filter((r) =>
        match(
          r.competitionName,
          r.slotName,
          r.teamName,
          r.claimedByName,
          r.claimedByEmail,
        ),
      ),
    [data, needle],
  );

  const exportAll = () => {
    downloadCsv(
      "claims.csv",
      [
        "kind",
        "name",
        "claimed_by",
        "claimed_by_email",
        "claimed_at",
        "method",
        "detail",
      ],
      [
        ...orgs.map((r) => [
          "organization",
          r.name,
          r.ownerName,
          r.ownerEmail ?? "",
          r.claimedAt ?? "",
          r.method === "request" ? "approved request" : "claim link",
          [r.city, r.state].filter(Boolean).join(", "),
        ]),
        ...comps.map((r) => [
          "competition",
          r.name,
          r.ownerName,
          r.ownerEmail ?? "",
          "",
          "claim link",
          `${r.type} ${r.startDate} → ${r.endDate}`,
        ]),
        ...slots.map((r) => [
          "team slot",
          `${r.competitionName} — ${r.slotName}`,
          r.claimedByName,
          r.claimedByEmail ?? "",
          r.claimedAt ?? "",
          "slot claim",
          r.teamName ?? "",
        ]),
      ],
    );
  };

  const totals = data
    ? {
        orgSeeded: data.organizations.totals.seeded,
        orgClaimed: data.organizations.totals.claimed,
        compSeeded: data.competitions.totals.seeded,
        compClaimed: data.competitions.totals.claimed,
        slotClaims: data.slotClaims.length,
      }
    : null;

  return (
    <AdminLayout>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="text-xl font-semibold" data-testid="text-claims-title">
            Claims
          </h1>
          <p className="text-sm text-muted-foreground">
            Every organization and competition that has been claimed — who
            claimed it, when, and how.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, claimer, email…"
            className="w-64"
            data-testid="input-claims-search"
          />
          <Button
            variant="outline"
            onClick={exportAll}
            disabled={!data}
            data-testid="btn-export-claims-csv"
          >
            <Download className="w-4 h-4 mr-1" /> Export CSV
          </Button>
        </div>
      </div>

      {totals && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-6">
          <Card>
            <CardContent className="p-4">
              <p className="text-2xl font-semibold" data-testid="stat-orgs-claimed">
                {totals.orgClaimed}
                <span className="text-sm font-normal text-muted-foreground">
                  {" "}
                  / {totals.orgSeeded}
                </span>
              </p>
              <p className="text-xs text-muted-foreground">
                Organization pages claimed
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-2xl font-semibold" data-testid="stat-comps-claimed">
                {totals.compClaimed}
                <span className="text-sm font-normal text-muted-foreground">
                  {" "}
                  / {totals.compSeeded}
                </span>
              </p>
              <p className="text-xs text-muted-foreground">
                Competition pages claimed
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-2xl font-semibold" data-testid="stat-slot-claims">
                {totals.slotClaims}
              </p>
              <p className="text-xs text-muted-foreground">
                Team slots claimed by coaches
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {isLoading && (
        <p className="text-sm text-muted-foreground">Loading claims…</p>
      )}
      {isError && (
        <p className="text-sm text-destructive">Couldn't load claims.</p>
      )}

      {data && (
        <div className="space-y-8">
          <section>
            <h2 className="text-sm font-semibold mb-2">
              Claimed organizations ({orgs.length})
            </h2>
            <Table data-testid="table-claimed-orgs">
              <TableHeader>
                <TableRow>
                  <TableHead>Organization</TableHead>
                  <TableHead>Claimed by</TableHead>
                  <TableHead>When</TableHead>
                  <TableHead>How</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orgs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-sm text-muted-foreground">
                      No claimed organizations yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  orgs.map((r) => (
                    <TableRow key={r.id} data-testid={`row-claimed-org-${r.id}`}>
                      <TableCell className="font-medium">
                        <Link
                          href={`/organizations/${r.id}`}
                          className="hover:underline underline-offset-2"
                        >
                          {r.name}
                        </Link>
                        {(r.city || r.state) && (
                          <span className="ml-2 text-xs text-muted-foreground">
                            {[r.city, r.state].filter(Boolean).join(", ")}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        {r.ownerName}
                        {r.ownerEmail && (
                          <span className="block text-xs text-muted-foreground">
                            {r.ownerEmail}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm whitespace-nowrap">
                        {fmtDate(r.claimedAt)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={r.method === "request" ? "secondary" : "outline"}>
                          {r.method === "request" ? "Approved request" : "Claim link"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </section>

          <section>
            <h2 className="text-sm font-semibold mb-2">
              Claimed competitions ({comps.length})
            </h2>
            <Table data-testid="table-claimed-comps">
              <TableHeader>
                <TableRow>
                  <TableHead>Competition</TableHead>
                  <TableHead>Dates</TableHead>
                  <TableHead>Claimed by</TableHead>
                  <TableHead>How</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {comps.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-sm text-muted-foreground">
                      No claimed competitions yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  comps.map((r) => (
                    <TableRow key={r.id} data-testid={`row-claimed-comp-${r.id}`}>
                      <TableCell className="font-medium">
                        <Link
                          href={`/competitions/c/${r.slug}`}
                          className="hover:underline underline-offset-2"
                        >
                          {r.name}
                        </Link>
                        <span className="ml-2 text-xs text-muted-foreground capitalize">
                          {r.type}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm whitespace-nowrap">
                        {r.startDate} → {r.endDate}
                      </TableCell>
                      <TableCell>
                        {r.ownerName}
                        {r.ownerEmail && (
                          <span className="block text-xs text-muted-foreground">
                            {r.ownerEmail}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">Claim link</Badge>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </section>

          <section>
            <h2 className="text-sm font-semibold mb-2">
              Team slots claimed ({slots.length})
            </h2>
            <Table data-testid="table-slot-claims">
              <TableHeader>
                <TableRow>
                  <TableHead>Competition</TableHead>
                  <TableHead>Slot</TableHead>
                  <TableHead>Linked team</TableHead>
                  <TableHead>Claimed by</TableHead>
                  <TableHead>When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {slots.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-sm text-muted-foreground">
                      No team slots claimed yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  slots.map((r) => (
                    <TableRow
                      key={r.participantId}
                      data-testid={`row-slot-claim-${r.participantId}`}
                    >
                      <TableCell className="font-medium">
                        <Link
                          href={`/competitions/c/${r.competitionSlug}`}
                          className="hover:underline underline-offset-2"
                        >
                          {r.competitionName}
                        </Link>
                      </TableCell>
                      <TableCell className="text-sm">
                        {r.slotName}
                        {r.division && (
                          <span className="block text-xs text-muted-foreground">
                            {r.division}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        {r.teamId && r.teamName ? (
                          <Link
                            href={`/teams/${r.teamId}`}
                            className="hover:underline underline-offset-2"
                          >
                            {r.teamName}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {r.claimedByName}
                        {r.claimedByEmail && (
                          <span className="block text-xs text-muted-foreground">
                            {r.claimedByEmail}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm whitespace-nowrap">
                        {fmtDate(r.claimedAt)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </section>
        </div>
      )}
    </AdminLayout>
  );
}
