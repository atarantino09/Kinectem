import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CompetitionReferralReport } from "@/components/CompetitionReferralReport";
import { useToast } from "@/hooks/use-toast";
import { AdminFree2027 } from "./AdminFree2027";

type Competition = { id: string; name: string; startDate: string; endDate: string };
type Organization = { organizationId: string; organizationName: string };
type OrgList = { id: string; name: string; orgCount: number };
type Referral = { referralCode: string; competitionName: string; data: unknown[] };
const selectClass = "block w-full min-w-0 rounded-md border bg-background px-3 py-2 text-sm";

export function AdminCompetitionReferrals() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [competition, setCompetition] = useState<Competition | null>(null);
  const [orgSearch, setOrgSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);
  const competitions = useQuery({
    queryKey: ["admin", "competition-referral-search", query],
    queryFn: () => customFetch<{ data: Competition[] }>(`/api/v1/admin/competitions?q=${encodeURIComponent(query)}`),
    enabled: query.length >= 2, staleTime: 30_000,
  });
  const referral = useQuery({
    queryKey: ["competition-referrals", competition?.id],
    queryFn: () => customFetch<Referral>(`/api/v1/competitions/${competition!.id}/referrals`),
    enabled: !!competition, staleTime: 30_000,
  });
  const organizations = useQuery({
    queryKey: ["admin", "organizations", { promoOnly: false }],
    queryFn: () => customFetch<{ data: Organization[] }>("/api/v1/admin/organizations"),
    enabled: !!competition,
  });
  const lists = useQuery({
    queryKey: ["admin", "org-lists"],
    queryFn: () => customFetch<{ data: OrgList[] }>("/api/v1/admin/org-lists"),
    enabled: !!competition,
  });
  const candidates = (organizations.data?.data ?? []).filter((org) =>
    org.organizationName.toLowerCase().includes(orgSearch.trim().toLowerCase()));
  const shown = candidates.slice(0, 40);
  const shareLink = referral.data ? `${window.location.origin}${import.meta.env.BASE_URL}referrals/${referral.data.referralCode}` : "";
  async function copy(value: string) {
    try { await navigator.clipboard.writeText(value); toast({ title: "Copied" }); }
    catch { toast({ title: "Could not copy. Select and copy the text instead.", variant: "destructive" }); }
  }
  const changeCompetition = (id: string) => {
    setCompetition(competitions.data?.data.find((row) => row.id === id) ?? null);
    setSelectedIds([]); setOrgSearch("");
  };
  return <Card className="border-blue-200" data-testid="admin-competition-referrals">
    <CardHeader className="pb-3">
      <CardTitle className="text-base">FREE2027 competition referrals</CardTitle>
      <p className="text-sm text-muted-foreground">Choose a competition, then copy its signup link or apply FREE2027 to existing organizations with referral credit included. This does not change other promo codes.</p>
    </CardHeader>
    <CardContent className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="admin-referral-search">Find a competition</Label>
          <Input id="admin-referral-search" placeholder="Search competition name…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="admin-referral-competition">Competition to credit</Label>
          <select id="admin-referral-competition" className={selectClass} value={competition?.id ?? ""} onChange={(e) => changeCompetition(e.target.value)}>
            <option value="">{competitions.isFetching ? "Searching…" : "Choose a competition"}</option>
            {competition && !competitions.data?.data.some((row) => row.id === competition.id) &&
              <option value={competition.id}>{competition.name} · {competition.startDate}</option>}
            {competitions.data?.data.map((row) => <option key={row.id} value={row.id}>{row.name} · {row.startDate}</option>)}
          </select>
        </div>
      </div>
      {query.length < 2 && !competition && <p className="text-xs text-muted-foreground">Type at least two letters to find a competition, whether claimed or unclaimed.</p>}
      {competitions.isError && <p role="alert" className="text-sm text-destructive">Could not search competitions. <Button size="sm" variant="link" onClick={() => void competitions.refetch()}>Try again</Button></p>}
      {query.length >= 2 && competitions.data?.data.length === 0 && <p className="text-sm">No matching competitions.</p>}
      {competition && (referral.isPending ? <p role="status" className="text-sm">Loading competition referral…</p>
        : referral.isError || !referral.data ? <p role="alert" className="text-sm text-destructive">Could not load this competition’s referral. <Button size="sm" variant="link" onClick={() => void referral.refetch()}>Try again</Button></p>
        : <div className="space-y-4" key={competition.id}>
          <div className="rounded-lg border bg-blue-50/60 p-3 space-y-2">
            <p className="text-sm font-semibold">{competition.name}</p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => void copy(shareLink)}>Copy FREE2027 signup link</Button>
              <Button size="sm" variant="outline" onClick={() => void copy(referral.data!.referralCode.toUpperCase())}>Copy referral tag</Button>
            </div>
            <p className="text-xs break-all select-all">{shareLink}</p>
            <p className="text-xs text-muted-foreground">FREE2027 gives free access through July 31, 2027. Competition credit is separate; 15% commission is earned only after the first full-price annual payment is collected, starting August 1, 2027.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="admin-referral-org-search">Select existing organizations ({selectedIds.length} selected)</Label>
            <Input id="admin-referral-org-search" placeholder="Search organizations…" value={orgSearch} onChange={(e) => setOrgSearch(e.target.value)} />
            {organizations.isPending ? <p role="status" className="text-sm">Loading organizations…</p>
              : organizations.isError ? <p role="alert" className="text-sm text-destructive">Could not load organizations. <Button variant="link" size="sm" onClick={() => void organizations.refetch()}>Try again</Button></p>
              : <div className="max-h-44 overflow-y-auto rounded-md border divide-y">
                {shown.map((org) => <label key={org.organizationId} className="flex items-center gap-3 px-3 py-2 text-sm cursor-pointer hover:bg-muted/50">
                  <input type="checkbox" checked={selectedIds.includes(org.organizationId)} onChange={(e) => setSelectedIds((ids) => e.target.checked ? [...ids, org.organizationId] : ids.filter((id) => id !== org.organizationId))} />
                  <span className="min-w-0 break-words">{org.organizationName}</span>
                </label>)}
                {!shown.length && <p className="p-3 text-sm text-muted-foreground">No matching organizations.</p>}
              </div>}
            {candidates.length > shown.length && <p className="text-xs text-muted-foreground">Showing the first 40 matches. Search to narrow the list.</p>}
            {selectedIds.length > 0 && <div className="flex flex-wrap gap-2">
              {(organizations.data?.data ?? []).filter((org) => selectedIds.includes(org.organizationId)).map((org) =>
                <Button key={org.organizationId} size="sm" variant="outline" className="h-auto py-1 whitespace-normal text-left" onClick={() => setSelectedIds((ids) => ids.filter((id) => id !== org.organizationId))} aria-label={`Remove ${org.organizationName} from selection`}>{org.organizationName} ×</Button>)}
            </div>}
          </div>
          {lists.isError && <p role="alert" className="text-sm text-destructive">Saved lists could not load. <Button size="sm" variant="link" onClick={() => void lists.refetch()}>Try again</Button></p>}
          <AdminFree2027 key={competition.id} selectedIds={selectedIds} lists={lists.data?.data ?? []}
            presetReferral={{ code: referral.data.referralCode, competitionName: competition.name }} />
          <details className="rounded-lg border p-3">
            <summary className="cursor-pointer text-sm font-semibold">View signups &amp; commissions</summary>
            <div className="pt-3"><CompetitionReferralReport competitionId={competition.id} /></div>
          </details>
        </div>)}
    </CardContent>
  </Card>;
}
