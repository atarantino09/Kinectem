import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { BrandImageField } from "@/components/BrandImageField";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { parseOrganizationImportFile } from "@/lib/admin-org-import-file";
import {
  Check,
  Copy,
  Eye,
  EyeOff,
  Loader2,
  Plus,
  Search,
  Trash2,
  Upload,
} from "lucide-react";

type PartnerSummary = {
  id: string;
  slug: string;
  officialName: string;
  associationLabel: string;
  published: boolean;
  memberCount: number;
};

type PartnerMember = {
  id: string;
  visible: boolean;
  sourceColumn: string | null;
  importOperationId: string | null;
  hasOwner: boolean;
  teamCount: number;
  contentCount: number;
  duplicateName: boolean;
  canDeleteStaleImport: boolean;
  organization: {
    id: string;
    name: string;
    location: string | null;
    city: string | null;
    state: string | null;
    logoUrl: string | null;
  };
};

type PartnerDetail = PartnerSummary & {
  introduction: string;
  logoUrl: string | null;
  bannerUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  members: PartnerMember[];
};

type SearchResult = PartnerMember["organization"] & {
  hasOwner: boolean;
  alreadyIncluded: boolean;
};

type ImportPreviewRow = {
  index: number;
  sourceColumn: string;
  name: string;
  warnings: string[];
  possibleMatches: SearchResult[];
};

function shareUrl(slug: string) {
  return `${window.location.origin}${import.meta.env.BASE_URL}partners/${slug}`;
}

function Step({
  number,
  title,
  done,
  children,
}: {
  number: number;
  title: string;
  done?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b bg-muted/25 py-4">
        <CardTitle className="flex items-center gap-3 text-base">
          <span className={`grid h-8 w-8 place-items-center rounded-full text-sm font-black ${done ? "bg-emerald-600 text-white" : "bg-primary text-primary-foreground"}`}>
            {done ? <Check className="h-4 w-4" /> : number}
          </span>
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 p-4">{children}</CardContent>
    </Card>
  );
}

export function AdminPartnerLanding() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [selectedId, setSelectedId] = useState("");
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState({
    officialName: "",
    associationLabel: "League / association",
    slug: "",
    introduction: "",
    logoUrl: "",
    bannerUrl: "",
    primaryColor: "#155EEF",
    secondaryColor: "#06B6D4",
    published: false,
  });
  const [newOrg, setNewOrg] = useState({ name: "", city: "", state: "", teams: "", logoUrl: "" });
  const [search, setSearch] = useState("");
  const [importRows, setImportRows] = useState<Array<{ name: string; teams: string[]; sourceColumn: string }>>([]);
  const [previewRows, setPreviewRows] = useState<ImportPreviewRow[]>([]);
  const [rowActions, setRowActions] = useState<Record<number, { action: "create" | "attach" | "skip"; existingOrganizationId?: string }>>({});
  const [importKey, setImportKey] = useState("");

  const pages = useQuery<{ data: PartnerSummary[] }>({
    queryKey: ["admin", "partner-pages"],
    queryFn: () => customFetch("/api/v1/admin/partner-pages", { method: "GET" }),
  });
  const detail = useQuery<{ data: PartnerDetail }>({
    queryKey: ["admin", "partner-pages", selectedId],
    queryFn: () => customFetch(`/api/v1/admin/partner-pages/${selectedId}`, { method: "GET" }),
    enabled: !!selectedId,
  });
  const searchResults = useQuery<{ data: SearchResult[] }>({
    queryKey: ["admin", "partner-org-search", selectedId, search],
    queryFn: () =>
      customFetch(`/api/v1/admin/partner-pages/${selectedId}/organization-search?q=${encodeURIComponent(search)}`, { method: "GET" }),
    enabled: !!selectedId && search.trim().length >= 2,
  });

  const loadDetail = (id: string) => {
    setSelectedId(id);
    const page = pages.data?.data.find((item) => item.id === id);
    if (page) {
      setDraft((current) => ({
        ...current,
        officialName: page.officialName,
        associationLabel: page.associationLabel,
        slug: page.slug,
        published: page.published,
      }));
    }
  };

  const hydrated = detail.data?.data;
  useEffect(() => {
    if (!hydrated) return;
    setDraft({
      officialName: hydrated.officialName,
      associationLabel: hydrated.associationLabel,
      slug: hydrated.slug,
      introduction: hydrated.introduction,
      logoUrl: hydrated.logoUrl ?? "",
      bannerUrl: hydrated.bannerUrl ?? "",
      primaryColor: hydrated.primaryColor,
      secondaryColor: hydrated.secondaryColor,
      published: hydrated.published,
    });
  }, [hydrated]);

  const refresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["admin", "partner-pages"] }),
      qc.invalidateQueries({ queryKey: ["admin", "partner-pages", selectedId] }),
    ]);
  };

  const createPage = async () => {
    setCreating(true);
    try {
      const response = await customFetch<{ data: PartnerSummary }>("/api/v1/admin/partner-pages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      setSelectedId(response.data.id);
      await refresh();
      toast({ title: "Partner page created" });
    } catch (error) {
      toast({ title: "Couldn't create partner page", description: (error as Error).message, variant: "destructive" });
    } finally {
      setCreating(false);
    }
  };

  const savePage = async (published = draft.published) => {
    if (!selectedId) return;
    setSaving(true);
    try {
      await customFetch(`/api/v1/admin/partner-pages/${selectedId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...draft, published }),
      });
      setDraft((value) => ({ ...value, published }));
      await refresh();
      toast({ title: published ? "Partner page published" : "Partner page saved" });
    } catch (error) {
      toast({ title: "Couldn't save partner page", description: (error as Error).message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const createOrganization = async () => {
    if (!selectedId || !newOrg.name.trim()) return;
    try {
      await customFetch(`/api/v1/admin/partner-pages/${selectedId}/organizations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...newOrg,
          teams: newOrg.teams.split(/\n|,/).map((v) => v.trim()).filter(Boolean),
        }),
      });
      setNewOrg({ name: "", city: "", state: "", teams: "", logoUrl: "" });
      await refresh();
      toast({ title: "Organization added to the partner page" });
    } catch (error) {
      toast({ title: "Couldn't add organization", description: (error as Error).message, variant: "destructive" });
    }
  };

  const attachOrganization = async (organizationId: string) => {
    await customFetch(`/api/v1/admin/partner-pages/${selectedId}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizationId }),
    });
    await refresh();
    toast({ title: "Organization included" });
  };

  const parseImport = async (file: File) => {
    const parsed = await parseOrganizationImportFile(file);
    if (parsed.errors.length) {
      toast({ title: "Import file needs attention", description: parsed.errors[0], variant: "destructive" });
      return;
    }
    const rows = parsed.groups.map((group, index) => ({
      name: group.name,
      teams: group.teams,
      sourceColumn: group.column || `Column ${index + 1}`,
    }));
    setImportRows(rows);
    setImportKey(`${file.name}:${file.size}:${file.lastModified}`);
    const response = await customFetch<{ data: { rows: ImportPreviewRow[] } }>(
      `/api/v1/admin/partner-pages/${selectedId}/import/validate`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizations: rows }),
      },
    );
    setPreviewRows(response.data.rows);
    setRowActions({});
  };

  const runImport = async () => {
    await customFetch(`/api/v1/admin/partner-pages/${selectedId}/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        idempotencyKey: importKey,
        organizations: importRows.map((row, index) => ({ ...row, ...(rowActions[index] ?? { action: "create" }) })),
      }),
    });
    setImportRows([]);
    setPreviewRows([]);
    await refresh();
    toast({ title: "Partner organizations imported" });
  };

  const updateMember = async (member: PartnerMember, action: "visibility" | "remove" | "delete") => {
    const base = `/api/v1/admin/partner-pages/${selectedId}/members/${member.id}`;
    if (action === "remove") {
      if (!confirm(`Remove ${member.organization.name} from this partner page? The organization and its content will remain.`)) return;
      await customFetch(base, { method: "DELETE" });
    } else if (action === "delete") {
      if (!confirm(`Delete ${member.organization.name}, including its ${member.teamCount} team page(s)? This is only allowed because it is ownerless and has no content.`)) return;
      await customFetch(`${base}/stale-organization`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmName: member.organization.name }),
      });
    } else {
      await customFetch(base, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visible: !member.visible }),
      });
    }
    await refresh();
  };

  const updateOrgLogo = async (member: PartnerMember, logoUrl: string) => {
    await customFetch(`/api/v1/organizations/${member.organization.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ logoUrl }),
    });
    await refresh();
  };

  if (!selectedId) {
    return (
      <div className="space-y-4">
        <Step number={1} title="Choose or create the partner page">
          <div className="grid gap-2 md:grid-cols-2">
            {(pages.data?.data ?? []).map((page) => (
              <button key={page.id} type="button" onClick={() => loadDetail(page.id)} className="rounded-lg border p-4 text-left hover:border-primary">
                <div className="font-black">{page.officialName}</div>
                <div className="text-sm text-muted-foreground">/{page.slug} · {page.memberCount} organizations · {page.published ? "Published" : "Draft"}</div>
              </button>
            ))}
          </div>
          <div className="grid gap-3 rounded-lg border bg-muted/20 p-4 md:grid-cols-3">
            <Input placeholder="Official partner name" value={draft.officialName} onChange={(e) => setDraft({ ...draft, officialName: e.target.value })} />
            <Input placeholder="League / association label" value={draft.associationLabel} onChange={(e) => setDraft({ ...draft, associationLabel: e.target.value })} />
            <Input placeholder="url-slug" value={draft.slug} onChange={(e) => setDraft({ ...draft, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") })} />
            <Button onClick={createPage} disabled={creating || !draft.officialName || !draft.slug}>
              {creating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Create partner page
            </Button>
          </div>
        </Step>
      </div>
    );
  }

  const members = detail.data?.data.members ?? [];
  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={() => setSelectedId("")}>← All partner pages</Button>
      <Step number={1} title="Partner identity and branding" done={!!draft.officialName && !!draft.slug}>
        <div className="grid gap-3 md:grid-cols-2">
          <div><Label>Official partner name</Label><Input value={draft.officialName} onChange={(e) => setDraft({ ...draft, officialName: e.target.value })} /></div>
          <div><Label>League / association label</Label><Input value={draft.associationLabel} onChange={(e) => setDraft({ ...draft, associationLabel: e.target.value })} /></div>
          <div><Label>URL slug</Label><Input value={draft.slug} onChange={(e) => setDraft({ ...draft, slug: e.target.value })} /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Primary</Label><Input type="color" value={draft.primaryColor} onChange={(e) => setDraft({ ...draft, primaryColor: e.target.value })} /></div>
            <div><Label>Secondary</Label><Input type="color" value={draft.secondaryColor} onChange={(e) => setDraft({ ...draft, secondaryColor: e.target.value })} /></div>
          </div>
          <BrandImageField label="Partner logo" value={draft.logoUrl} onChange={(logoUrl) => setDraft({ ...draft, logoUrl })} kind="logo" idPrefix="partner-logo" />
          <BrandImageField label="Partner banner" value={draft.bannerUrl} onChange={(bannerUrl) => setDraft({ ...draft, bannerUrl })} kind="banner" idPrefix="partner-banner" />
          <div className="md:col-span-2"><Label>Introduction</Label><Textarea rows={4} value={draft.introduction} onChange={(e) => setDraft({ ...draft, introduction: e.target.value })} /></div>
        </div>
        <Button onClick={() => savePage()} disabled={saving}>Save branding</Button>
      </Step>

      <Step number={2} title="Import or add organizations" done={members.length > 0}>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-3 rounded-lg border p-3">
            <div className="font-bold">Mass upload</div>
            <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={(e) => e.target.files?.[0] && void parseImport(e.target.files[0])} />
            <Button variant="outline" onClick={() => fileRef.current?.click()}><Upload className="mr-2 h-4 w-4" /> Choose spreadsheet</Button>
            {previewRows.map((row) => (
              <div key={row.index} className="rounded-md border p-3 text-sm">
                <div className="font-bold">{row.sourceColumn}: {row.name}</div>
                {row.warnings.map((warning) => <div key={warning} className="mt-1 text-amber-700">{warning}</div>)}
                <select className="mt-2 w-full rounded border bg-background p-2" value={`${rowActions[row.index]?.action ?? "create"}:${rowActions[row.index]?.existingOrganizationId ?? ""}`} onChange={(e) => {
                  const [action, id] = e.target.value.split(":");
                  setRowActions((current) => ({ ...current, [row.index]: { action: action as "create" | "attach" | "skip", existingOrganizationId: id || undefined } }));
                }}>
                  <option value="create:">Create a separate organization</option>
                  {row.possibleMatches.map((match) => <option key={match.id} value={`attach:${match.id}`}>Attach {match.name} · {match.city ?? match.location ?? "Location not set"}</option>)}
                  <option value="skip:">Skip this row</option>
                </select>
              </div>
            ))}
            {previewRows.length > 0 && <Button onClick={runImport}>Import {previewRows.length} rows</Button>}
          </div>
          <div className="space-y-3 rounded-lg border p-3">
            <div className="font-bold">Add new organization</div>
            <Input placeholder="Organization name" value={newOrg.name} onChange={(e) => setNewOrg({ ...newOrg, name: e.target.value })} />
            <div className="grid grid-cols-2 gap-2"><Input placeholder="City" value={newOrg.city} onChange={(e) => setNewOrg({ ...newOrg, city: e.target.value })} /><Input placeholder="State" maxLength={2} value={newOrg.state} onChange={(e) => setNewOrg({ ...newOrg, state: e.target.value })} /></div>
            <Textarea placeholder="Optional team names, one per line" value={newOrg.teams} onChange={(e) => setNewOrg({ ...newOrg, teams: e.target.value })} />
            <BrandImageField label="Organization logo (optional)" value={newOrg.logoUrl} onChange={(logoUrl) => setNewOrg({ ...newOrg, logoUrl })} kind="logo" idPrefix="new-partner-org-logo" />
            <Button onClick={createOrganization}><Plus className="mr-2 h-4 w-4" /> Add new organization</Button>
            <div className="border-t pt-3">
              <Label>Search existing organizations</Label>
              <div className="relative"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input className="pl-9" placeholder="Name, city, state, or location" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
              {(searchResults.data?.data ?? []).map((result) => (
                <div key={result.id} className="mt-2 flex items-center justify-between gap-2 rounded border p-2 text-sm">
                  <div><div className="font-bold">{result.name}</div><div className="text-muted-foreground">{[result.city, result.state, result.location].filter(Boolean).join(", ") || "Location not set"} · {result.hasOwner ? "Claimed" : "Ownerless"}</div></div>
                  <Button size="sm" variant="outline" disabled={result.alreadyIncluded} onClick={() => attachOrganization(result.id)}>{result.alreadyIncluded ? "Included" : "Attach"}</Button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Step>

      <Step number={3} title="Review and clean up the directory" done={members.length > 0}>
        <div className="space-y-3">
          {members.map((member) => (
            <div key={member.id} className="grid gap-3 rounded-lg border p-3 lg:grid-cols-[1fr_260px_auto] lg:items-center">
              <div>
                <div className="flex flex-wrap items-center gap-2 font-black">{member.organization.name}{member.duplicateName && <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">Duplicate name</span>}</div>
                <div className="text-xs text-muted-foreground">{member.sourceColumn ?? "No import source"} · {member.teamCount} teams · {member.contentCount} posts · {member.hasOwner ? "Claimed organization" : "Ownerless import"}</div>
              </div>
              <BrandImageField label="Organization logo" value={member.organization.logoUrl ?? ""} onChange={(value) => void updateOrgLogo(member, value)} kind="logo" idPrefix={`member-logo-${member.id}`} />
              <div className="flex flex-wrap gap-1">
                <Button size="sm" variant="outline" onClick={() => updateMember(member, "visibility")}>{member.visible ? <EyeOff className="mr-1 h-3.5 w-3.5" /> : <Eye className="mr-1 h-3.5 w-3.5" />}{member.visible ? "Hide" : "Show"}</Button>
                <Button size="sm" variant="outline" onClick={() => updateMember(member, "remove")}>Remove from page</Button>
                <Button size="sm" variant="destructive" disabled={!member.canDeleteStaleImport} title={!member.canDeleteStaleImport ? "Claimed or content-bearing organizations must be hidden or removed instead" : undefined} onClick={() => updateMember(member, "delete")}><Trash2 className="mr-1 h-3.5 w-3.5" /> Delete stale import</Button>
              </div>
            </div>
          ))}
        </div>
      </Step>

      <Step number={4} title="Preview, publish, and share" done={draft.published}>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2"><Switch checked={draft.published} onCheckedChange={(published) => void savePage(published)} /><span className="font-semibold">{draft.published ? "Published" : "Unpublished"}</span></div>
          <Link href={`/partners/${draft.slug}`}><Button variant="outline" disabled={!draft.published}>Preview public page</Button></Link>
          <Button variant="outline" disabled={!draft.published} onClick={() => { void navigator.clipboard.writeText(shareUrl(draft.slug)); toast({ title: "Partner URL copied" }); }}><Copy className="mr-2 h-4 w-4" /> Copy shareable URL</Button>
        </div>
        <div className="break-all rounded-lg bg-muted p-3 text-sm">{shareUrl(draft.slug)}</div>
      </Step>
    </div>
  );
}