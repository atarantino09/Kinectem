import { useEffect, useMemo, useState } from "react";
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
    if (!name || creating) return;
    setCreating(true);
    try {
      const resp = await customFetch<{ data: ClaimLinkRow }>(
        `/api/v1/admin/org-claim-links`,
        { method: "POST", body: JSON.stringify({ name }) },
      );
      setNewName("");
      setDebounced("");
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
            disabled={!newName.trim() || creating || !!exactMatch}
            data-testid="btn-add-org"
          >
            {creating ? "Adding…" : "Add org"}
          </Button>
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
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[110px]">Messaged</TableHead>
            <TableHead>Organization</TableHead>
            <TableHead>Location</TableHead>
            <TableHead>Claim link</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableRow>
              <TableCell colSpan={5} className="text-center py-6 text-muted-foreground">
                Loading…
              </TableCell>
            </TableRow>
          ) : filtered.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="text-center py-6 text-muted-foreground">
                No ownerless pages.
              </TableCell>
            </TableRow>
          ) : (
            filtered.map((r) => {
              const location = [r.city, r.state].filter(Boolean).join(", ");
              return (
                <TableRow key={r.id} data-testid={`row-claim-link-${r.id}`}>
                  <TableCell>
                    <Checkbox
                      checked={!!r.messagedAt}
                      onCheckedChange={(v) => toggleMessaged(r.id, v === true)}
                      aria-label={`Messaged ${r.name} on Facebook`}
                      data-testid={`checkbox-messaged-${r.id}`}
                    />
                  </TableCell>
                  <TableCell className="font-medium">{formatOrgName(r.name)}</TableCell>
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
