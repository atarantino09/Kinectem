import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AdminFree2027 } from "./AdminFree2027";

export type Free2027Org = {
  organizationId: string; organizationName: string; claimed: boolean;
  ownerName: string | null; ownerLastSignInAt: string | null; hasFree2027: boolean;
};
type Sort = "default" | "signin" | "name";
const selectClass = "block w-full min-w-0 rounded-md border bg-background px-3 py-2 text-sm";
const time = (o: Free2027Org) => (o.ownerLastSignInAt ? new Date(o.ownerLastSignInAt).getTime() : -Infinity);
const byName = (a: Free2027Org, b: Free2027Org) => a.organizationName.localeCompare(b.organizationName);
const sorters: Record<Sort, (a: Free2027Org, b: Free2027Org) => number> = {
  default: (a, b) => Number(b.claimed) - Number(a.claimed) || time(b) - time(a) || byName(a, b),
  signin: (a, b) => time(b) - time(a) || byName(a, b),
  name: byName,
};

export function AdminFree2027Organizations() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | "claimed" | "unclaimed">("all");
  const [sort, setSort] = useState<Sort>("default");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const q = useQuery({
    queryKey: ["admin", "free2027-organizations"],
    queryFn: () => customFetch<{ data: Free2027Org[] }>("/api/v1/admin/free2027/organizations"),
    staleTime: 30_000, refetchInterval: 60_000,
  });
  const all = q.data?.data ?? [];
  useEffect(() => {
    if (!q.data) return;
    const existingIds = new Set(q.data.data.map((o) => o.organizationId));
    setSelected((previous) => {
      const remaining = new Set([...previous].filter((id) => existingIds.has(id)));
      return remaining.size === previous.size ? previous : remaining;
    });
  }, [q.data]);
  const shown = useMemo(() => {
    const term = search.trim().toLowerCase();
    return all.filter((o) => (status === "all" || (status === "claimed") === o.claimed)
      && (!term || o.organizationName.toLowerCase().includes(term) || (o.ownerName ?? "").toLowerCase().includes(term)))
      .sort(sorters[sort]);
  }, [all, search, status, sort]);
  const shownIds = new Set(shown.map((o) => o.organizationId));
  const hiddenSelected = [...selected].filter((id) => !shownIds.has(id)).length;
  const add = (ids: string[]) => setSelected((s) => new Set([...s, ...ids]));
  const toggle = (id: string, on: boolean) => setSelected((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n; });
  const ids = all.filter((o) => selected.has(o.organizationId)).map((o) => o.organizationId);

  return <Card className="border-blue-200" data-testid="admin-free2027-organizations">
    <CardHeader className="pb-3">
      <CardTitle className="text-base">FREE2027 for organizations</CardTitle>
      <p className="text-sm text-muted-foreground">Pick any organizations and apply FREE2027. No competition required.</p>
    </CardHeader>
    <CardContent className="space-y-4 min-w-0">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1 min-w-0"><Label htmlFor="f27-search">Search organization or owner</Label>
          <Input id="f27-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search…" /></div>
        <div className="space-y-1 min-w-0"><Label htmlFor="f27-status">Claimed status</Label>
          <select id="f27-status" className={selectClass} value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="all">All</option><option value="claimed">Claimed</option><option value="unclaimed">Unclaimed</option></select></div>
        <div className="space-y-1 min-w-0"><Label htmlFor="f27-sort">Sort by</Label>
          <select id="f27-sort" className={selectClass} value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            <option value="default">Claimed first, then latest owner sign-in</option>
            <option value="signin">Latest owner sign-in</option><option value="name">Name</option></select></div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" disabled={!shown.length} onClick={() => add(shown.map((o) => o.organizationId))}>Select all matching</Button>
        <Button size="sm" variant="outline" disabled={!shown.some((o) => o.claimed)} onClick={() => add(shown.filter((o) => o.claimed).map((o) => o.organizationId))}>Select claimed matching</Button>
        <Button size="sm" variant="ghost" disabled={!selected.size} onClick={() => setSelected(new Set())}>Clear selection</Button>
        <p className="text-sm" data-testid="f27-counts" role="status">
          {all.length} organizations · {shown.length} shown · {selected.size} selected · {hiddenSelected} selected hidden by filters</p>
      </div>
      {q.isPending ? <p role="status" className="text-sm">Loading organizations…</p>
        : q.isError ? <p role="alert" className="text-sm text-destructive">Could not load organizations. <Button size="sm" variant="link" onClick={() => void q.refetch()}>Try again</Button></p>
        : <div className="max-h-96 overflow-y-auto rounded-md border divide-y" role="group" aria-label="Organizations" data-testid="f27-list">
          {shown.map((o) => <label key={o.organizationId} className="flex items-start gap-3 px-3 py-2 text-sm cursor-pointer hover:bg-muted/50 min-w-0">
            <input type="checkbox" className="mt-1" checked={selected.has(o.organizationId)} onChange={(e) => toggle(o.organizationId, e.target.checked)}
              aria-label={`Select ${o.organizationName}`} />
            <span className="min-w-0 flex-1 break-words">
              <span className="font-semibold">{o.organizationName}</span>
              <span className="ml-2 text-xs">{o.claimed ? "Claimed" : "Unclaimed"}</span>
              {o.hasFree2027 && <span className="ml-2 text-xs font-semibold text-primary">FREE2027 assigned</span>}
              <span className="block text-xs text-muted-foreground">
                Owner: {o.ownerName ?? "No owner"} · Owner last signed in: {o.ownerName === null && !o.ownerLastSignInAt ? "No owner" : o.ownerLastSignInAt ? new Date(o.ownerLastSignInAt).toLocaleString() : "Never recorded"}
              </span>
            </span>
          </label>)}
          {!shown.length && <p className="p-3 text-sm text-muted-foreground">No matching organizations.</p>}
        </div>}
      <AdminFree2027 selectedIds={ids} lists={[]} withoutReferral
        onApplied={(done) => setSelected((s) => { const n = new Set(s); done.forEach((id) => n.delete(id)); return n; })} />
    </CardContent>
  </Card>;
}
