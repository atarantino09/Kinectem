import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { BrandImageField } from "@/components/BrandImageField";
import { BrandColorSwapButton } from "@/components/BrandColorSwapButton";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { parseOrganizationImportFile } from "@/lib/admin-org-import-file";
import { extractBrandColorsFromDataUrl } from "@/lib/extractBrandColors";
import {
  canonicalizePartnerSlug,
  isValidPartnerSlug,
  partnerSlugError,
} from "@/lib/partner-slug";
import {
  Check,
  Copy,
  Eye,
  EyeOff,
  Loader2,
  Plus,
  Search,
  Trash2,
  Trophy,
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

type OrgList = {
  id: string;
  name: string;
  orgCount: number;
  createdAt: string;
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
  duplicateCandidates?: OrganizationCandidate[];
  protected?: boolean;
  protection?: unknown;
  cleanup?: {
    allowed?: boolean;
    reason?: string | null;
    summary?: string | null;
  } | null;
  provenance?: {
    membershipImportOperationId: string | null;
    organizationCreatedByImportOperationId: string | null;
  };
  teams: Array<{
    id: string;
    name: string;
    organizationId?: string;
    importOperationId: string | null;
    provenance?: {
      teamImportOperationId: string | null;
      membershipImportOperationId: string | null;
      organizationCreatedByImportOperationId: string | null;
    };
    canDelete?: boolean;
  }>;
  organization: {
    id: string;
    name: string;
    location: string | null;
    city: string | null;
    state: string | null;
    logoUrl: string | null;
    brandPrimaryColor: string | null;
    brandSecondaryColor: string | null;
  };
};

type PartnerDetail = PartnerSummary & {
  introduction: string;
  logoUrl: string | null;
  bannerUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  competition: PartnerCompetition | null;
  competitions?: PartnerCompetition[];
  members: PartnerMember[];
  duplicateSwapRequests?: DuplicateSwapRequest[];
};

type DuplicateSwapRequest = {
  id: string;
  status: "pending" | "approved" | "denied";
  sourceMembershipId: string;
  sourceOrganizationId: string | null;
  targetOrganizationId: string;
  requestedByUserId: string;
  requestedAt: string;
  decidedAt: string | null;
  sourceOrganization: { id: string; name: string } | null;
  targetOrganization: { id: string; name: string } | null;
  requester: { id: string; name: string; email: string | null } | null;
  approver: { id: string; name: string; email: string | null } | null;
};

type PartnerCompetition = {
  id: string;
  slug: string;
  name: string;
  type: "tournament" | "league" | string;
  startDate: string;
  endDate: string;
  location: string | null;
};

type CompetitionSearchResult = PartnerCompetition & {
  linkedToPage: boolean;
};

type SearchResult = PartnerMember["organization"] & {
  hasOwner?: boolean;
  alreadyIncluded?: boolean;
  matchKind?: string | null;
  evidence?: unknown;
  claimed?: boolean;
  teamNames?: string[];
  teamCount?: number;
  pageMember?: boolean;
  partnerPages?: Array<{ id?: string; name?: string; slug?: string } | string>;
  rank?: number;
};

type OrganizationCandidate = SearchResult & {
  id: string;
};

type ImportPreviewRow = {
  index: number;
  sourceColumn: string;
  name: string;
  warnings: string[];
  possibleMatches: SearchResult[];
  candidates?: OrganizationCandidate[];
  requiresDecision?: boolean;
  decisionRequired?: boolean;
  rememberedDecision?: "create" | "attach" | "skip" | "keep_distinct" | null;
  rememberedSuggestion?: {
    organizationId?: string;
    decision?: "create" | "attach" | "skip" | "keep_distinct" | null;
    action?: "create" | "attach" | "skip" | "keep_distinct" | null;
    rationale?: unknown;
  } | null;
};

type ImportAction = {
  action: "create" | "attach" | "skip" | "keep_distinct";
  candidateId?: string;
  existingOrganizationId?: string;
};

type ReplacementImpact = {
  organizationId?: string;
  organizationName?: string;
  memberId?: string;
  protected?: boolean;
  canReplace?: boolean;
  warnings?: string[];
  affectedTeams?: number;
  affectedPosts?: number;
  affectedHighlights?: number;
  cleanup?: string | string[] | null;
  stale?: Array<{
    name?: string;
    safe?: boolean;
    reasons?: string[];
    action?: string;
  }>;
  summary?: string | null;
  [key: string]: unknown;
};

const DEFAULT_PARTNER_PRIMARY = "#155EEF";
const DEFAULT_PARTNER_SECONDARY = "#06B6D4";

function shareUrl(slug: string) {
  const basePath = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
  return `${window.location.origin}${basePath}/partners/${encodeURIComponent(slug)}`;
}

function buildPartnerOutreachMessage(partnerName: string, partnerUrl: string) {
  const name = partnerName.trim() || "Your association";
  return `Subject: Your club's page on Kinectem is already built

Hi coaches and club directors,

${name} has partnered with Kinectem — and your club's page, plus a page for every one of your teams, is already built and waiting for you.

Kinectem is the youth-sports platform where the story of your season comes to life. It isn't another registration, scheduling, or communication app — it's the layer that sits on top of the one you already use. Your coaches write a game recap after each game, every rostered player is tagged automatically, and season after season that becomes a permanent record of your teams and every athlete on them.

And it's less work than it sounds. AI Assist is built into the game recap composer — a coach types a couple of sentences about how the game went, and it comes back as a full game recap for them to review, edit, and publish. A couple of minutes, not a Sunday night project.

Find your club here: ${partnerUrl}

That page has the full picture, and your club is on it with your teams already listed underneath. Claim it and you're in.

As a ${name} club you get your first 90 days free and 25% off your first year, already applied to your account — no code to enter. Parents and players are always free.

Questions? competitions@kinectem.com is happy to help.

Thanks,
The ${name} team`;
}

async function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand?.("copy");
  document.body.removeChild(textarea);
  if (!copied) throw new Error("Clipboard unavailable");
}

function candidateList(row: ImportPreviewRow): OrganizationCandidate[] {
  return (row.candidates ?? row.possibleMatches ?? []) as OrganizationCandidate[];
}

function candidateLocation(candidate: SearchResult): string {
  return [candidate.city, candidate.state, candidate.location]
    .filter(Boolean)
    .join(", ") || "Location not set";
}

function candidateEvidence(candidate: SearchResult): string[] {
  if (Array.isArray(candidate.evidence)) return candidate.evidence.filter(Boolean);
  if (typeof candidate.evidence === "string") return [candidate.evidence];
  if (candidate.evidence && typeof candidate.evidence === "object") {
    return Object.entries(candidate.evidence as Record<string, unknown>)
      .filter(([, value]) => value !== null && value !== undefined && value !== false)
      .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") : String(value)}`);
  }
  return [];
}

function candidateLabel(candidate: SearchResult): string {
  const kind = candidate.matchKind?.replace(/[_-]/g, " ");
  return kind ? kind.replace(/\b\w/g, (letter) => letter.toUpperCase()) : "Possible match";
}

function candidateAlreadyIncluded(candidate: SearchResult): boolean {
  return Boolean(candidate.alreadyIncluded || candidate.pageMember);
}

function rememberedDecisionLabel(row: ImportPreviewRow): string | null {
  if (row.rememberedDecision) return row.rememberedDecision.replace("_", " ");
  if (row.rememberedSuggestion?.decision) {
    return row.rememberedSuggestion.decision.replace("_", " ");
  }
  if (row.rememberedSuggestion?.action) {
    return row.rememberedSuggestion.action.replace("_", " ");
  }
  if (
    row.rememberedSuggestion?.rationale &&
    typeof row.rememberedSuggestion.rationale === "object"
  ) {
    const rationale = row.rememberedSuggestion.rationale as {
      decision?: string;
      action?: string;
    };
    const decision = rationale.decision ?? rationale.action;
    if (decision) return decision.replace("_", " ");
  }
  if (row.rememberedSuggestion?.organizationId) return "attach";
  return null;
}

function protectionLabel(protection: unknown): string {
  if (typeof protection === "string") return protection;
  if (Array.isArray(protection)) return protection.map(String).join(", ");
  return "This organization has protected data";
}

function replacementIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `partner-replacement-${Date.now()}`;
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

export function AdminPartnerLanding({
  initialSlug,
}: {
  initialSlug?: string;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const logoExtractionSeq = useRef(0);
  const replacementPanelRef = useRef<HTMLDivElement>(null);
  const [selectedId, setSelectedId] = useState("");
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [outreachCopied, setOutreachCopied] = useState(false);
  const [slugTouched, setSlugTouched] = useState(false);
  const [draft, setDraft] = useState({
    officialName: "",
    associationLabel: "League / association",
    slug: "",
    introduction: "",
    logoUrl: "",
    bannerUrl: "",
    primaryColor: DEFAULT_PARTNER_PRIMARY,
    secondaryColor: DEFAULT_PARTNER_SECONDARY,
    published: false,
  });
  const [newOrg, setNewOrg] = useState({ name: "", city: "", state: "", teams: "", logoUrl: "" });
  const [search, setSearch] = useState("");
  const [partnerPageSearch, setPartnerPageSearch] = useState("");
  const [selectedOrgListId, setSelectedOrgListId] = useState("");
  const [addingOrgList, setAddingOrgList] = useState(false);
  const [competitionSearch, setCompetitionSearch] = useState("");
  const [selectedCompetitions, setSelectedCompetitions] = useState<PartnerCompetition[]>([]);
  const [newCompetition, setNewCompetition] = useState({
    name: "",
    type: "tournament" as "tournament" | "league",
    startDate: "",
    endDate: "",
    location: "",
    description: "",
  });
  const [importRows, setImportRows] = useState<Array<{ name: string; teams: string[]; sourceColumn: string }>>([]);
  const [previewRows, setPreviewRows] = useState<ImportPreviewRow[]>([]);
  const [rowActions, setRowActions] = useState<Record<number, ImportAction>>({});
  const [importKey, setImportKey] = useState("");
  const [importSummary, setImportSummary] = useState<Record<string, unknown> | null>(null);
  const [replacement, setReplacement] = useState<{
    member: PartnerMember;
    candidate: OrganizationCandidate;
    impact: ReplacementImpact | null;
    loading: boolean;
    idempotencyKey: string;
  } | null>(null);
  const [replacementSummary, setReplacementSummary] = useState<Record<string, unknown> | null>(null);
  const [replacementSearch, setReplacementSearch] = useState({
    memberId: "",
    query: "",
  });
  const [orgBrandDrafts, setOrgBrandDrafts] = useState<
    Record<string, { primary: string; secondary: string }>
  >({});
  const [savingOrgBrand, setSavingOrgBrand] = useState<string | null>(null);
  const [swapDecisionLoading, setSwapDecisionLoading] = useState<string | null>(null);
  const [selectedTeamIds, setSelectedTeamIds] = useState<string[]>([]);
  const [bulkTargetOrganizationId, setBulkTargetOrganizationId] = useState("");
  const [bulkActionLoading, setBulkActionLoading] = useState(false);
  const [deleteTeamsDialogOpen, setDeleteTeamsDialogOpen] = useState(false);
  const [directoryOrganizationSearch, setDirectoryOrganizationSearch] = useState("");

  useEffect(() => {
    if (!replacement) return;
    const frame = window.requestAnimationFrame(() => {
      replacementPanelRef.current?.scrollIntoView?.({
        behavior: "smooth",
        block: "center",
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [replacement?.member.id, replacement?.candidate.id]);

  const pages = useQuery<{ data: PartnerSummary[] }>({
    queryKey: ["admin", "partner-pages"],
    queryFn: () => customFetch("/api/v1/admin/partner-pages", { method: "GET" }),
  });
  const orgLists = useQuery<{ data: OrgList[] }>({
    queryKey: ["admin", "org-lists"],
    queryFn: () =>
      customFetch("/api/v1/admin/org-lists", { method: "GET" }),
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
  const replacementSearchResults = useQuery<{ data: SearchResult[] }>({
    queryKey: [
      "admin",
      "partner-replacement-search",
      selectedId,
      replacementSearch.query,
    ],
    queryFn: () =>
      customFetch(
        `/api/v1/admin/partner-pages/${selectedId}/organization-search?q=${encodeURIComponent(replacementSearch.query)}`,
        { method: "GET" },
      ),
    enabled:
      !!selectedId &&
      !!replacementSearch.memberId &&
      replacementSearch.query.trim().length >= 2,
  });
  const competitionResults = useQuery<{ data: CompetitionSearchResult[] }>({
    queryKey: ["admin", "partner-competition-search", selectedId, competitionSearch],
    queryFn: () =>
      customFetch(`/api/v1/admin/partner-pages/${selectedId}/competition-search?q=${encodeURIComponent(competitionSearch)}`, { method: "GET" }),
    enabled: !!selectedId && competitionSearch.trim().length >= 2,
  });

  const loadDetail = (id: string) => {
    setSelectedId(id);
    setSelectedOrgListId("");
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

  useEffect(() => {
    if (!initialSlug || selectedId || !pages.data?.data) return;
    const page = pages.data.data.find(
      (item) => item.slug.toLowerCase() === initialSlug.toLowerCase(),
    );
    if (page) {
      setSelectedOrgListId("");
      setSelectedId(page.id);
    }
  }, [initialSlug, pages.data, selectedId]);

  const suggestColorsFromLogo = (logoUrl: string, notify: boolean) => {
    const extractionSeq = ++logoExtractionSeq.current;
    if (!logoUrl.startsWith("data:")) return;

    void extractBrandColorsFromDataUrl(logoUrl)
      .then((colors) => {
        if (extractionSeq !== logoExtractionSeq.current || !colors) return;
        setDraft((current) => ({
          ...current,
          primaryColor: colors.primary,
          // A one-color logo gets a solid-color treatment instead of an
          // invalid/null gradient stop.
          secondaryColor: colors.secondary ?? colors.primary,
        }));
        if (notify) {
          toast({
            title: "Brand colors picked from the logo",
            description: "You can adjust them below.",
          });
        }
      })
      .catch(() => {
        // Color extraction is best-effort; the logo itself still uploads.
      });
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
    setSelectedCompetitions(
      hydrated.competitions ?? (hydrated.competition ? [hydrated.competition] : []),
    );
    // Existing pages created with the default palette should catch up to the
    // logo they already have. Custom colors remain untouched.
    if (
      hydrated.logoUrl?.startsWith("data:") &&
      hydrated.primaryColor.toLowerCase() === DEFAULT_PARTNER_PRIMARY.toLowerCase() &&
      hydrated.secondaryColor.toLowerCase() === DEFAULT_PARTNER_SECONDARY.toLowerCase()
    ) {
      suggestColorsFromLogo(hydrated.logoUrl, false);
    }
  }, [hydrated]);

  const refresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["admin", "partner-pages"] }),
      qc.invalidateQueries({ queryKey: ["admin", "partner-pages", selectedId] }),
    ]);
  };

  const canonicalSlug = canonicalizePartnerSlug(draft.slug);
  const slugError = partnerSlugError(draft.slug);
  const showSlugError = slugTouched || !draft.slug || !!selectedId;
  const outreachUrl = canonicalSlug
    ? shareUrl(canonicalSlug)
    : `${window.location.origin}${(import.meta.env.BASE_URL || "/").replace(/\/$/, "")}/partners/[your-slug]`;
  const outreachMessage = buildPartnerOutreachMessage(draft.officialName, outreachUrl);
  const setSlugFromInput = (value: string) => {
    setSlugTouched(true);
    const trimmed = value.trim();
    const slug = /^(?:https?:\/\/|www\.)/i.test(trimmed)
      ? canonicalizePartnerSlug(value) || value
      : value;
    setDraft((current) => ({ ...current, slug }));
  };
  const normalizeSlug = () => {
    setDraft((current) => ({
      ...current,
      slug: canonicalizePartnerSlug(current.slug),
    }));
  };

  const onPartnerLogoChange = (logoUrl: string) => {
    setDraft((current) => ({ ...current, logoUrl }));
    suggestColorsFromLogo(logoUrl, true);
  };
  const handleSlugPaste = (event: React.ClipboardEvent<HTMLInputElement>) => {
    const pasted = event.clipboardData.getData("text");
    if (!pasted) return;
    const normalized = canonicalizePartnerSlug(pasted);
    if (normalized) {
      event.preventDefault();
      setSlugTouched(true);
      setDraft((current) => ({ ...current, slug: normalized }));
    }
  };

  const createPage = async () => {
    if (!draft.officialName.trim() || !isValidPartnerSlug(draft.slug)) {
      setSlugTouched(true);
      return;
    }
    setCreating(true);
    try {
      const response = await customFetch<{ data: PartnerSummary }>("/api/v1/admin/partner-pages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...draft, officialName: draft.officialName.trim(), slug: canonicalSlug }),
      });
      setDraft((current) => ({ ...current, slug: response.data.slug }));
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
    if (!draft.officialName.trim() || !isValidPartnerSlug(draft.slug)) {
      setSlugTouched(true);
      return;
    }
    setSaving(true);
    try {
      await customFetch(`/api/v1/admin/partner-pages/${selectedId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...draft, officialName: draft.officialName.trim(), slug: canonicalSlug, published }),
      });
      setDraft((value) => ({ ...value, officialName: value.officialName.trim(), slug: canonicalSlug, published }));
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

  const addOrganizationList = async () => {
    if (!selectedId || !selectedOrgListId || addingOrgList) return;
    const selectedList = (orgLists.data?.data ?? []).find(
      (list) => list.id === selectedOrgListId,
    );
    if (!selectedList) return;
    setAddingOrgList(true);
    try {
      const response = await customFetch<{
        data: {
          addedCount: number;
          skippedCount: number;
          organizationCount: number;
        };
      }>(
        `/api/v1/admin/partner-pages/${selectedId}/lists/${selectedOrgListId}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        },
      );
      await refresh();
      const { addedCount, skippedCount } = response.data;
      toast({
        title:
          addedCount === 0
            ? "All organizations were already included"
            : `${addedCount} organization${addedCount === 1 ? "" : "s"} added`,
        description:
          skippedCount > 0
            ? `${skippedCount} already included`
            : `Added from ${selectedList.name}`,
      });
    } catch (error) {
      toast({
        title: "Couldn't add organization list",
        description: (error as Error).message,
        variant: "destructive",
      });
    } finally {
      setAddingOrgList(false);
    }
  };

  const updateFeaturedCompetition = async (competitionId: string) => {
    try {
      const response = await customFetch<{
        competition: PartnerCompetition;
        competitions: PartnerCompetition[];
      }>(
        `/api/v1/admin/partner-pages/${selectedId}/competition`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ competitionId }),
        },
      );
      setSelectedCompetitions(
        response.competitions ??
          (response.competition ? [response.competition] : []),
      );
      setCompetitionSearch("");
      await refresh();
      toast({ title: "Featured competition linked" });
    } catch (error) {
      toast({ title: "Couldn't link competition", description: (error as Error).message, variant: "destructive" });
    }
  };

  const removeFeaturedCompetition = async (competitionId: string) => {
    try {
      const response = await customFetch<{ competitions: PartnerCompetition[] }>(
        `/api/v1/admin/partner-pages/${selectedId}/competition/${competitionId}`,
        { method: "DELETE" },
      );
      setSelectedCompetitions(response.competitions);
      await refresh();
      toast({ title: "Featured competition removed" });
    } catch (error) {
      toast({ title: "Couldn't remove competition", description: (error as Error).message, variant: "destructive" });
    }
  };

  const createFeaturedCompetition = async () => {
    if (!newCompetition.name.trim() || !newCompetition.startDate || !newCompetition.endDate) return;
    try {
      const response = await customFetch<{
        competition: PartnerCompetition;
        consolePath: string;
      }>(`/api/v1/admin/partner-pages/${selectedId}/competition`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...newCompetition,
          name: newCompetition.name.trim(),
          location: newCompetition.location.trim() || null,
          description: newCompetition.description.trim() || null,
        }),
      });
      setSelectedCompetitions((current) => [...current, response.competition]);
      setNewCompetition({
        name: "",
        type: "tournament",
        startDate: "",
        endDate: "",
        location: "",
        description: "",
      });
      await refresh();
      toast({ title: `${response.competition.type === "league" ? "League" : "Tournament"} created and linked` });
    } catch (error) {
      toast({ title: "Couldn't create competition", description: (error as Error).message, variant: "destructive" });
    }
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
    setPreviewRows(
      response.data.rows.map((row) => ({
        ...row,
        possibleMatches: row.possibleMatches ?? row.candidates ?? [],
        candidates: row.candidates ?? row.possibleMatches ?? [],
      })),
    );
    setRowActions({});
    setImportSummary(null);
  };

  const runImport = async () => {
    const response = await customFetch<{ data?: Record<string, unknown> }>(
      `/api/v1/admin/partner-pages/${selectedId}/import`,
      {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        idempotencyKey: importKey,
        organizations: importRows.map((row, index) => ({
          ...row,
          ...(rowActions[index] ?? { action: "create" }),
        })),
      }),
      },
    );
    setImportRows([]);
    setPreviewRows([]);
    setRowActions({});
    setImportSummary(response.data ?? null);
    await refresh();
    const summary = response.data;
    const created = summary?.createdCount ?? summary?.created;
    const attached = summary?.attachedCount ?? summary?.attached;
    const skipped = summary?.skippedCount ?? summary?.skipped;
    toast({
      title: "Partner organizations imported",
      description:
        created !== undefined || attached !== undefined || skipped !== undefined
          ? `${created ?? 0} created · ${attached ?? 0} attached · ${skipped ?? 0} skipped`
          : undefined,
    });
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

  const runTeamBulkAction = async (action: "delete" | "move") => {
    if (!selectedId || selectedTeamIds.length === 0 || bulkActionLoading) return;
    if (action === "move" && !bulkTargetOrganizationId) return;
    setBulkActionLoading(true);
    try {
      const response = await customFetch<{
        data: { deleted: number; moved: number; protected: Array<{ id: string; reason: string }> };
      }>(`/api/v1/admin/partner-pages/${selectedId}/teams/bulk-action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teamIds: selectedTeamIds,
          action,
          ...(action === "move" ? { targetOrganizationId: bulkTargetOrganizationId } : {}),
        }),
      });
      setSelectedTeamIds([]);
      setBulkTargetOrganizationId("");
      if (action === "delete") setDeleteTeamsDialogOpen(false);
      await refresh();
      const updatedCount =
        action === "delete" ? response.data.deleted : response.data.moved;
      toast({
        title: action === "delete" ? "Teams deleted" : "Teams moved",
        description:
          response.data.protected.length > 0
            ? `${updatedCount} updated; ${response.data.protected.length} skipped because they are no longer eligible.`
            : `${updatedCount} team page${updatedCount === 1 ? "" : "s"} updated.`,
      });
    } catch (error) {
      toast({
        title: `Couldn't ${action} teams`,
        description: (error as Error).message,
        variant: "destructive",
      });
    } finally {
      setBulkActionLoading(false);
    }
  };

  const previewReplacement = async (
    member: PartnerMember,
    candidate: OrganizationCandidate,
  ) => {
    setReplacement({
      member,
      candidate,
      impact: null,
      loading: true,
      idempotencyKey: replacementIdempotencyKey(),
    });
    try {
      const operationPath = `/api/v1/admin/partner-pages/${selectedId}/members/${member.id}/replace/preview`;
      const response = await customFetch<{
        data?: ReplacementImpact;
        impact?: ReplacementImpact;
      }>(operationPath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidateId: candidate.id,
          organizationId: candidate.id,
        }),
      });
      setReplacement((current) =>
        current
          ? {
              ...current,
              impact: response.impact ?? response.data ?? {},
              loading: false,
            }
          : current,
      );
    } catch (error) {
      setReplacement(null);
      toast({
        title: "Couldn't preview replacement",
        description: (error as Error).message,
        variant: "destructive",
      });
    }
  };

  const confirmReplacement = async () => {
    if (!replacement?.impact || replacement.loading) return;
    setReplacement((current) => (current ? { ...current, loading: true } : current));
    try {
      const operationPath = `/api/v1/admin/partner-pages/${selectedId}/members/${replacement.member.id}/replace`;
      const response = await customFetch<{
        data?: Record<string, unknown>;
        summary?: Record<string, unknown>;
      }>(operationPath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "attach",
          idempotencyKey: replacement.idempotencyKey,
          candidateId: replacement.candidate.id,
          organizationId: replacement.candidate.id,
          confirmed: true,
        }),
      });
      setReplacementSummary(response.summary ?? response.data ?? {});
      setReplacement(null);
      await refresh();
      toast({ title: "Organization replaced", description: "The partner directory was updated." });
    } catch (error) {
      setReplacement((current) => (current ? { ...current, loading: false } : current));
      toast({
        title: "Couldn't replace organization",
        description: (error as Error).message,
        variant: "destructive",
      });
    }
  };

  const updateOrgLogo = async (member: PartnerMember, logoUrl: string) => {
    const colors = logoUrl.startsWith("data:")
      ? await extractBrandColorsFromDataUrl(logoUrl).catch(() => null)
      : null;
    const colorPatch = colors
      ? {
          brandPrimaryColor: colors.primary,
          brandSecondaryColor: colors.secondary ?? colors.primary,
        }
      : {};
    await customFetch(`/api/v1/organizations/${member.organization.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ logoUrl, ...colorPatch }),
    });
    if (colors) {
      setOrgBrandDrafts((current) => ({
        ...current,
        [member.organization.id]: {
          primary: colors.primary,
          secondary: colors.secondary ?? colors.primary,
        },
      }));
      toast({
        title: "Organization colors picked from the logo",
        description: "Adjust them below if needed.",
      });
    }
    await refresh();
  };

  const orgBrandDraft = (member: PartnerMember) =>
    orgBrandDrafts[member.organization.id] ?? {
      primary: member.organization.brandPrimaryColor ?? "#155eef",
      secondary: member.organization.brandSecondaryColor ?? "#06b6d4",
    };

  const setOrgBrandColor = (
    member: PartnerMember,
    key: "primary" | "secondary",
    value: string,
  ) => {
    const current = orgBrandDraft(member);
    setOrgBrandDrafts((drafts) => ({
      ...drafts,
      [member.organization.id]: { ...current, [key]: value },
    }));
  };

  const saveOrgBrandColors = async (member: PartnerMember) => {
    const colors = orgBrandDraft(member);
    setSavingOrgBrand(member.organization.id);
    try {
      await customFetch(`/api/v1/organizations/${member.organization.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brandPrimaryColor: colors.primary,
          brandSecondaryColor: colors.secondary,
        }),
      });
      await refresh();
      toast({ title: "Organization colors saved" });
    } catch (error) {
      toast({
        title: "Couldn't save organization colors",
        description: (error as Error).message,
        variant: "destructive",
      });
    } finally {
      setSavingOrgBrand(null);
    }
  };

  const decideDuplicateSwap = async (request: DuplicateSwapRequest, decision: "approved" | "denied") => {
    setSwapDecisionLoading(request.id);
    try {
      await customFetch(`/api/v1/admin/partner-duplicate-swap-requests/${request.id}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      await refresh();
      toast({ title: decision === "approved" ? "Directory swap approved" : "Directory swap denied" });
    } catch (error) {
      toast({
        title: "Couldn't update swap request",
        description: (error as Error).message,
        variant: "destructive",
      });
    } finally {
      setSwapDecisionLoading(null);
    }
  };

  const partnerPageSummaries = pages.data?.data ?? [];
  const normalizedPartnerPageSearch = partnerPageSearch.trim().toLowerCase();
  const filteredPartnerPages = normalizedPartnerPageSearch
    ? partnerPageSummaries.filter((page) =>
        [page.officialName, page.slug, page.associationLabel].some((value) =>
          value.toLowerCase().includes(normalizedPartnerPageSearch),
        ),
      )
    : partnerPageSummaries;

  if (!selectedId) {
    return (
      <div className="space-y-4">
        <Step number={1} title="Choose or create the partner page">
          <div className="space-y-1">
            <Label htmlFor="partner-page-search">Search existing partner pages</Label>
            <div className="relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                id="partner-page-search"
                data-testid="input-partner-page-search"
                className="pl-9"
                placeholder="Partner name, URL slug, or association"
                value={partnerPageSearch}
                onChange={(event) => setPartnerPageSearch(event.target.value)}
              />
            </div>
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            {filteredPartnerPages.map((page) => (
              <div key={page.id} className="rounded-lg border p-4 hover:border-primary">
                <div className="flex items-start justify-between gap-3">
                  <Link
                    href={`/partners/${encodeURIComponent(page.slug)}`}
                    className="font-black text-primary underline-offset-4 hover:underline"
                    aria-label={`Open public page for ${page.officialName}`}
                  >
                    {page.officialName}
                  </Link>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="shrink-0"
                    onClick={() => loadDetail(page.id)}
                    aria-label={`Edit ${page.officialName}`}
                  >
                    Edit
                  </Button>
                </div>
                <div className="text-sm text-muted-foreground">/{page.slug} · {page.memberCount} organizations · {page.published ? "Published" : "Draft"}</div>
              </div>
            ))}
          </div>
          {normalizedPartnerPageSearch && filteredPartnerPages.length === 0 && (
            <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground" data-testid="partner-page-search-empty">
              No existing partner pages match “{partnerPageSearch.trim()}”.
            </p>
          )}
          <div className="grid gap-3 rounded-lg border bg-muted/20 p-4 md:grid-cols-3">
            <Input aria-label="Official partner name" placeholder="Official partner name" value={draft.officialName} onChange={(e) => setDraft({ ...draft, officialName: e.target.value })} />
            <Input aria-label="League / association label" placeholder="League / association label" value={draft.associationLabel} onChange={(e) => setDraft({ ...draft, associationLabel: e.target.value })} />
            <div className="md:col-span-3">
              <Label htmlFor="new-partner-slug">Partner page URL</Label>
              <div className="mt-1 flex min-w-0 items-stretch">
                <span className="flex shrink-0 items-center rounded-l-md border border-r-0 bg-muted px-3 text-sm text-muted-foreground">
                  /partners/
                </span>
                <Input
                  id="new-partner-slug"
                  data-testid="input-partner-slug"
                  className="min-w-0 rounded-l-none"
                  placeholder="your-partner-name"
                  value={draft.slug}
                  onChange={(e) => setSlugFromInput(e.target.value)}
                  onBlur={normalizeSlug}
                  onPaste={handleSlugPaste}
                  aria-invalid={showSlugError && !!slugError}
                />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">Enter only the final URL segment. You can type a name-like slug or paste an http(s) address.</p>
              {showSlugError && slugError && <p className="mt-1 text-sm text-destructive" role="alert" data-testid="partner-slug-error">{slugError}</p>}
              <p className="mt-2 break-all rounded-md bg-background px-3 py-2 text-sm" data-testid="partner-url-preview">
                {canonicalSlug ? shareUrl(canonicalSlug) : `${window.location.origin}${(import.meta.env.BASE_URL || "/").replace(/\/$/, "")}/partners/[your-slug]`}
              </p>
            </div>
            <Button onClick={createPage} disabled={creating || !draft.officialName.trim() || !!slugError}>
              {creating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Create partner page
            </Button>
          </div>
        </Step>
      </div>
    );
  }

  const members = detail.data?.data.members ?? [];
  const duplicateSwapRequests = detail.data?.data.duplicateSwapRequests ?? [];
  const selectedTeamMemberIds = new Set(
    members
      .filter((member) => (member.teams ?? []).some((team) => selectedTeamIds.includes(team.id)))
      .map((member) => member.id),
  );
  const bulkMoveEligible = selectedTeamMemberIds.size > 0
    ? members.filter(
        (member) =>
          !member.hasOwner &&
          !selectedTeamMemberIds.has(member.id),
      )
    : [];
  const normalizedDirectoryOrganizationSearch =
    directoryOrganizationSearch.trim().toLocaleLowerCase();
  const filteredMembers = normalizedDirectoryOrganizationSearch
    ? members.filter((member) =>
        member.organization.name
          .toLocaleLowerCase()
          .includes(normalizedDirectoryOrganizationSearch),
      )
    : members;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={() => setSelectedId("")}>← All partner pages</Button>
        <Link
          href={`/partners/${encodeURIComponent(canonicalSlug)}`}
          className="text-lg font-black text-primary underline-offset-4 hover:underline"
          aria-label={`Open public page for ${draft.officialName}`}
        >
          {draft.officialName}
        </Link>
      </div>
      <Step number={1} title="Partner identity and branding" done={!!draft.officialName && !!draft.slug}>
        <div className="grid gap-3 md:grid-cols-2">
          <div><Label>Official partner name</Label><Input value={draft.officialName} onChange={(e) => setDraft({ ...draft, officialName: e.target.value })} /></div>
          <div><Label>League / association label</Label><Input value={draft.associationLabel} onChange={(e) => setDraft({ ...draft, associationLabel: e.target.value })} /></div>
          <div className="md:col-span-2">
            <Label htmlFor="partner-slug">Partner page URL</Label>
            <div className="mt-1 flex min-w-0 items-stretch">
              <span className="flex shrink-0 items-center rounded-l-md border border-r-0 bg-muted px-3 text-sm text-muted-foreground">
                /partners/
              </span>
              <Input
                id="partner-slug"
                data-testid="input-partner-slug"
                className="min-w-0 rounded-l-none"
                value={draft.slug}
                onChange={(e) => setSlugFromInput(e.target.value)}
                onBlur={normalizeSlug}
                onPaste={handleSlugPaste}
                aria-invalid={showSlugError && !!slugError}
              />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">This is the final segment of the Kinectem partner-page URL.</p>
            {showSlugError && slugError && <p className="mt-1 text-sm text-destructive" role="alert" data-testid="partner-slug-error">{slugError}</p>}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Primary</Label><Input type="color" value={draft.primaryColor} onChange={(e) => setDraft({ ...draft, primaryColor: e.target.value })} data-testid="input-partner-primary-color" /></div>
            <div><Label>Secondary</Label><Input type="color" value={draft.secondaryColor} onChange={(e) => setDraft({ ...draft, secondaryColor: e.target.value })} data-testid="input-partner-secondary-color" /></div>
            <div className="col-span-2">
              <BrandColorSwapButton
                testId="btn-swap-partner-brand-colors"
                onSwap={() => {
                  const currentPrimary = draft.primaryColor;
                  setDraft({
                    ...draft,
                    primaryColor: draft.secondaryColor,
                    secondaryColor: currentPrimary,
                  });
                }}
              />
            </div>
          </div>
          <BrandImageField label="Partner logo" value={draft.logoUrl} onChange={onPartnerLogoChange} kind="logo" idPrefix="partner-logo" />
          <BrandImageField label="Partner banner" value={draft.bannerUrl} onChange={(bannerUrl) => setDraft({ ...draft, bannerUrl })} kind="banner" idPrefix="partner-banner" />
          <div className="md:col-span-2"><Label>Introduction</Label><Textarea rows={4} value={draft.introduction} onChange={(e) => setDraft({ ...draft, introduction: e.target.value })} /></div>
        </div>
        <Button onClick={() => savePage()} disabled={saving || !draft.officialName.trim() || !!slugError}>Save branding</Button>
      </Step>

      <Step number={2} title="Import or add organizations" done={members.length > 0}>
        <div className="rounded-lg border border-primary/25 bg-primary/5 p-3">
          <div className="font-bold">Add from a saved organization list</div>
          <p className="mt-1 text-sm text-muted-foreground">
            Add all ownerless organizations in an existing admin list to this
            partner page. Organizations already included are skipped.
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
            <select
              className="min-h-10 min-w-0 flex-1 rounded-md border bg-background px-3 py-2 text-sm"
              value={selectedOrgListId}
              onChange={(event) => setSelectedOrgListId(event.target.value)}
              aria-label="Saved organization list"
              data-testid="select-partner-org-list"
              disabled={orgLists.isLoading || addingOrgList}
            >
              <option value="">
                {orgLists.isLoading
                  ? "Loading saved lists…"
                  : orgLists.data?.data.length
                    ? "Choose a saved list"
                    : "No saved organization lists"}
              </option>
              {(orgLists.data?.data ?? []).map((list) => (
                <option key={list.id} value={list.id}>
                  {list.name} · {list.orgCount} organization
                  {list.orgCount === 1 ? "" : "s"}
                </option>
              ))}
            </select>
            <Button
              onClick={() => void addOrganizationList()}
              disabled={
                !selectedOrgListId ||
                addingOrgList ||
                !(
                  orgLists.data?.data.find(
                    (list) => list.id === selectedOrgListId,
                  )?.orgCount
                )
              }
              data-testid="btn-add-partner-org-list"
            >
              {addingOrgList && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Add list
            </Button>
          </div>
          {!orgLists.isLoading &&
            (orgLists.data?.data ?? []).length === 0 && (
              <p className="mt-2 text-xs text-muted-foreground">
                Create a list in{" "}
                <Link
                  className="font-semibold text-primary underline"
                  href="/admin/organizations?section=claim-links"
                >
                  Organizations → Claim links & setup
                </Link>
                .
              </p>
            )}
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-3 rounded-lg border p-3">
            <div className="font-bold">Mass upload</div>
            <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" data-testid="input-partner-import-file" onChange={(e) => e.target.files?.[0] && void parseImport(e.target.files[0])} />
            <Button variant="outline" onClick={() => fileRef.current?.click()}><Upload className="mr-2 h-4 w-4" /> Choose spreadsheet</Button>
            {previewRows.map((row) => (
              (() => {
                const candidates = candidateList(row);
                const action = rowActions[row.index];
                const needsDecision =
                  row.requiresDecision === true ||
                  row.decisionRequired === true ||
                  candidates.length > 0;
                const teams = importRows[row.index]?.teams ?? [];
                return (
              <div key={row.index} className="rounded-md border p-3 text-sm" data-testid={`import-review-row-${row.index}`}>
                <div className="flex flex-wrap items-center gap-2 font-bold">
                  <span>{row.sourceColumn}: {row.name}</span>
                  {rememberedDecisionLabel(row) && (
                    <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-800">
                      Remembered: {rememberedDecisionLabel(row)}
                    </span>
                  )}
                  {needsDecision && !action && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                      Decision required
                    </span>
                  )}
                  {action?.action === "keep_distinct" && (
                    <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-semibold text-violet-800">
                      Keep distinct
                    </span>
                  )}
                </div>
                {row.warnings.map((warning) => <div key={warning} className="mt-1 text-amber-700">{warning}</div>)}
                {candidates.length > 0 && (
                  <div className="mt-3 space-y-2" data-testid={`candidate-comparison-${row.index}`}>
                    <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                      Compare credible matches before importing
                    </div>
                    {candidates.map((candidate) => {
                      const candidateTeams = candidate.teamNames ?? [];
                      const normalizedTeams = new Set(teams.map((team) => team.trim().toLowerCase()));
                      const teamMismatch =
                        normalizedTeams.size > 0 &&
                        candidateTeams.length > 0 &&
                        !candidateTeams.some((team) => normalizedTeams.has(team.trim().toLowerCase()));
                      return (
                        <div key={candidate.id} className="rounded border bg-muted/20 p-2" data-testid={`candidate-${row.index}-${candidate.id}`}>
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="font-semibold">{candidate.name}</div>
                            <div className="flex flex-wrap gap-1 text-xs">
                              <span className="rounded bg-primary/10 px-2 py-0.5 text-primary">{candidateLabel(candidate)}</span>
                              {candidate.claimed ?? candidate.hasOwner ? <span className="rounded bg-amber-100 px-2 py-0.5 text-amber-800">Claimed</span> : <span className="rounded bg-emerald-100 px-2 py-0.5 text-emerald-800">Ownerless</span>}
                              {candidateAlreadyIncluded(candidate) && <span className="rounded bg-muted px-2 py-0.5">Already included</span>}
                            </div>
                          </div>
                          <div className="text-xs text-muted-foreground">{candidateLocation(candidate)}</div>
                          {candidateTeams.length > 0 && <div className="mt-1 text-xs">Teams: {candidateTeams.join(", ")}</div>}
                          {candidateEvidence(candidate).map((evidence) => <div key={evidence} className="mt-1 text-xs text-muted-foreground">Evidence: {evidence}</div>)}
                          {teamMismatch && <div className="mt-1 font-semibold text-amber-700" role="alert">Team mismatch: uploaded teams do not match this organization.</div>}
                          {candidate.partnerPages && candidate.partnerPages.length > 0 && (
                            <div className="mt-1 text-xs text-muted-foreground">Partner pages: {candidate.partnerPages.map((page) => typeof page === "string" ? page : page.name ?? page.slug ?? page.id).join(", ")}</div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                <Label className="mt-3 block text-xs font-bold">
                  Choose what to do with this row
                  <select
                    className="mt-1 w-full rounded border bg-background p-2 font-normal"
                    aria-label={`Decision for ${row.name}`}
                    data-testid={`select-import-decision-${row.index}`}
                    value={action
                      ? `${action.action}:${action.candidateId ?? action.existingOrganizationId ?? ""}`
                      : needsDecision
                        ? ""
                        : "create:"}
                    onChange={(e) => {
                      const [nextAction, id] = e.target.value.split(":");
                      setRowActions((current) => ({
                        ...current,
                        [row.index]: {
                          action: nextAction as ImportAction["action"],
                          candidateId: id || undefined,
                          existingOrganizationId: id || undefined,
                        },
                      }));
                    }}
                  >
                    {needsDecision && <option value="">Select an explicit decision…</option>}
                    {!needsDecision && <option value="create:">Create a separate organization</option>}
                    <option value="create:">Create a new organization</option>
                    <option value="keep_distinct:">Keep distinct from the matches (create new)</option>
                    {candidates.map((match) => <option key={match.id} value={`attach:${match.id}`} disabled={candidateAlreadyIncluded(match)}>Attach {match.name} · {candidateLocation(match)}{candidateAlreadyIncluded(match) ? " · already included" : ""}</option>)}
                    <option value="skip:">Skip this row</option>
                  </select>
                </Label>
              </div>
                );
              })()
            ))}
            {previewRows.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">Every credible collision must have an explicit choice. Remembered decisions are shown for context and do not silently import a row.</p>
                <Button
                  onClick={runImport}
                  disabled={previewRows.some((row) => (row.requiresDecision === true || row.decisionRequired === true || candidateList(row).length > 0) && !rowActions[row.index])}
                  data-testid="btn-run-partner-import"
                >
                  Import {previewRows.length} rows
                </Button>
              </div>
            )}
            {importSummary && (
              <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm" data-testid="partner-import-summary">
                <div className="font-bold">Import complete</div>
                <div>{String(importSummary.createdCount ?? importSummary.created ?? 0)} created · {String(importSummary.attachedCount ?? importSummary.attached ?? 0)} attached · {String(importSummary.skippedCount ?? importSummary.skipped ?? 0)} skipped</div>
              </div>
            )}
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
                  <div>
                    <div className="flex flex-wrap items-center gap-1 font-bold">
                      <span>{result.name}</span>
                      {result.matchKind && <span className="rounded bg-primary/10 px-2 py-0.5 text-xs font-normal text-primary">{candidateLabel(result)}</span>}
                      {candidateAlreadyIncluded(result) && <span className="rounded bg-muted px-2 py-0.5 text-xs font-normal">Already included</span>}
                    </div>
                    <div className="text-muted-foreground">{candidateLocation(result)} · {result.claimed ?? result.hasOwner ? "Claimed" : "Ownerless"}</div>
                    {candidateEvidence(result).map((evidence) => <div key={evidence} className="text-xs text-muted-foreground">Evidence: {evidence}</div>)}
                    {result.teamNames && result.teamNames.length > 0 && <div className="text-xs text-muted-foreground">Teams: {result.teamNames.join(", ")}</div>}
                  </div>
                  <Button size="sm" variant="outline" disabled={candidateAlreadyIncluded(result)} onClick={() => attachOrganization(result.id)}>{candidateAlreadyIncluded(result) ? "Included" : "Attach"}</Button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Step>

      <Step number={3} title="Review duplicate swap requests">
        {duplicateSwapRequests.length === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            No partner directory correction requests for this page.
          </p>
        ) : (
          <div className="space-y-3">
            {duplicateSwapRequests.map((request) => (
              <div key={request.id} className="rounded-lg border p-3" data-testid={`duplicate-swap-request-${request.id}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="font-black">
                      {request.sourceOrganization?.name ?? "Imported staging organization"}{" "}
                      <span className="font-normal text-muted-foreground">→</span>{" "}
                      {request.targetOrganization?.name ?? "Existing organization"}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      Requested by {request.requester?.name ?? request.requestedByUserId}
                      {request.requester?.email ? ` (${request.requester.email})` : ""}
                    </div>
                  </div>
                  <span className={`rounded-full px-2 py-1 text-xs font-bold ${
                    request.status === "pending"
                      ? "bg-amber-100 text-amber-800"
                      : request.status === "approved"
                        ? "bg-emerald-100 text-emerald-800"
                        : "bg-slate-100 text-slate-700"
                  }`}>
                    {request.status}
                  </span>
                </div>
                {request.status === "pending" && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      disabled={swapDecisionLoading === request.id}
                      onClick={() => void decideDuplicateSwap(request, "approved")}
                    >
                      {swapDecisionLoading === request.id ? "Saving…" : "Approve directory swap"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={swapDecisionLoading === request.id}
                      onClick={() => void decideDuplicateSwap(request, "denied")}
                    >
                      Deny
                    </Button>
                  </div>
                )}
                {request.status === "approved" && (
                  <p className="mt-2 text-xs text-emerald-700">Only this page membership was replaced; organization data was not merged.</p>
                )}
              </div>
            ))}
          </div>
        )}
      </Step>

      <Step number={4} title="Review and clean up the directory" done={members.length > 0}>
        <div className="space-y-3">
          <div
            className="sticky top-20 z-20 rounded-lg border border-primary/25 bg-background/95 p-3 shadow-md backdrop-blur supports-[backdrop-filter]:bg-background/90"
            data-testid="team-bulk-actions"
          >
            <div className="font-bold">Bulk team management</div>
            <p className="mt-1 text-sm text-muted-foreground">
              Select team pages below to delete them or move them to another ownerless organization on this partner page.
            </p>
            <div className="relative mt-3">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                type="search"
                className="pl-9"
                value={directoryOrganizationSearch}
                onChange={(event) =>
                  setDirectoryOrganizationSearch(event.target.value)
                }
                placeholder="Search organizations by name"
                aria-label="Search organizations in this directory"
                data-testid="input-directory-organization-search"
              />
            </div>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
              <Button
                type="button"
                size="sm"
                variant="destructive"
                disabled={selectedTeamIds.length === 0 || bulkActionLoading}
                onClick={() => setDeleteTeamsDialogOpen(true)}
                data-testid="button-delete-selected-teams"
              >
                <Trash2 className="mr-1 h-3.5 w-3.5" />
                Delete selected ({selectedTeamIds.length})
              </Button>
              <select
                className="min-h-9 min-w-0 flex-1 rounded-md border bg-background px-3 py-2 text-sm"
                value={bulkTargetOrganizationId}
                onChange={(event) => setBulkTargetOrganizationId(event.target.value)}
                disabled={selectedTeamIds.length === 0 || bulkMoveEligible.length === 0 || bulkActionLoading}
                aria-label="Move selected teams to organization"
                data-testid="select-move-selected-teams-target"
              >
                <option value="">
                  {selectedTeamIds.length === 0
                    ? "Select teams to move"
                    : bulkMoveEligible.length === 0
                      ? "No eligible target organizations"
                      : "Choose target organization"}
                </option>
                {bulkMoveEligible.map((member) => (
                  <option key={member.organization.id} value={member.organization.id}>
                    {member.organization.name}
                  </option>
                ))}
              </select>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!bulkTargetOrganizationId || selectedTeamIds.length === 0 || bulkActionLoading}
                onClick={() => void runTeamBulkAction("move")}
                data-testid="button-move-selected-teams"
              >
                {bulkActionLoading ? "Working…" : "Move selected"}
              </Button>
            </div>
            {selectedTeamIds.length > 0 && bulkMoveEligible.length === 0 && (
              <p className="mt-2 text-xs text-muted-foreground" data-testid="team-bulk-move-help">
                No other ownerless organizations on this partner page can receive the selected teams.
              </p>
            )}
          </div>
          <AlertDialog open={deleteTeamsDialogOpen} onOpenChange={setDeleteTeamsDialogOpen}>
            <AlertDialogContent data-testid="dialog-delete-selected-teams">
              <AlertDialogHeader>
                <AlertDialogTitle>
                  Permanently delete {selectedTeamIds.length} selected team
                  {selectedTeamIds.length === 1 ? "" : "s"}?
                </AlertDialogTitle>
                <AlertDialogDescription asChild>
                  <div className="space-y-2">
                    <p>
                      This permanent deletion removes the selected team pages and
                      their rosters, schedules, recaps/highlights, invitations,
                      followers, and related team data.
                    </p>
                    <p className="font-semibold text-destructive">
                      This action cannot be undone.
                    </p>
                  </div>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel data-testid="button-cancel-delete-selected-teams">
                  Cancel
                </AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  data-testid="button-confirm-delete-selected-teams"
                  disabled={bulkActionLoading || selectedTeamIds.length === 0}
                  onClick={() => void runTeamBulkAction("delete")}
                >
                  Permanently delete selected teams
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          {filteredMembers.length === 0 && (
            <div
              className="rounded-lg border border-dashed p-5 text-center text-sm text-muted-foreground"
              data-testid="empty-directory-organization-search"
            >
              No organizations match “{directoryOrganizationSearch.trim()}”.
            </div>
          )}
          {filteredMembers.map((member) => (
            <div key={member.id} className="grid gap-3 rounded-lg border p-3 lg:grid-cols-[1fr_300px_auto] lg:items-center">
              <div>
                <div className="flex flex-wrap items-center gap-2 font-black">{member.organization.name}{member.duplicateName && <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">Duplicate name</span>}</div>
                <div className="text-xs text-muted-foreground">{member.sourceColumn ?? "No import source"} · {member.teamCount} teams · {member.contentCount} posts · {member.hasOwner ? "Claimed organization" : "Ownerless import"}</div>
                <div className="mt-3 space-y-1 rounded-md border border-dashed p-2" data-testid={`member-teams-${member.id}`}>
                  {(member.teams ?? []).length === 0 ? (
                    <div className="text-xs text-muted-foreground">No team pages in this organization.</div>
                  ) : (
                    <>
                      {!member.hasOwner && member.teams.length > 1 && (
                        <label className="flex min-h-9 items-center gap-2 rounded border-b px-1 pb-1 text-xs font-bold">
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border"
                            checked={member.teams.every((team) =>
                              selectedTeamIds.includes(team.id),
                            )}
                            onChange={(event) =>
                              setSelectedTeamIds((current) =>
                                event.target.checked
                                  ? Array.from(
                                      new Set([
                                        ...current,
                                        ...member.teams.map((team) => team.id),
                                      ]),
                                    )
                                  : current.filter(
                                      (id) =>
                                        !member.teams.some((team) => team.id === id),
                                    ),
                              )
                            }
                            aria-label={`Select all teams in ${member.organization.name}`}
                          />
                          Select all teams
                        </label>
                      )}
                      {(member.teams ?? []).map((team) => (
                      <label key={team.id} className="flex min-h-9 items-center gap-2 rounded px-1 text-sm hover:bg-muted/50">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border"
                          checked={selectedTeamIds.includes(team.id)}
                          disabled={member.hasOwner}
                          onChange={(event) =>
                            setSelectedTeamIds((current) =>
                              event.target.checked
                                ? current.includes(team.id)
                                  ? current
                                  : [...current, team.id]
                                : current.filter((id) => id !== team.id),
                            )
                          }
                          aria-label={`Select team ${team.name}`}
                          data-testid={`checkbox-team-${team.id}`}
                        />
                        <span>{team.name}</span>
                        {member.hasOwner && (
                          <span className="ml-auto text-xs text-muted-foreground">
                            Claimed
                          </span>
                        )}
                      </label>
                      ))}
                    </>
                  )}
                </div>
                {member.protected === true && (
                  <div className="mt-1 text-xs font-semibold text-amber-700">
                    Protected: {protectionLabel(member.protection)}
                  </div>
                )}
                {member.cleanup && (
                  <div className="mt-1 text-xs text-muted-foreground">
                    Cleanup: {member.cleanup.summary ?? member.cleanup.reason ?? (member.cleanup.allowed === false ? "Not available" : "Available")}
                  </div>
                )}
                <div className="mt-3 space-y-2" data-testid={`member-duplicate-candidates-${member.id}`}>
                  <Label htmlFor={`replacement-search-${member.id}`} className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                    Search claimed replacement organizations
                  </Label>
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      id={`replacement-search-${member.id}`}
                      className="pl-9"
                      value={replacementSearch.memberId === member.id ? replacementSearch.query : ""}
                      placeholder="Type an organization name"
                      onFocus={() =>
                        setReplacementSearch((current) => ({
                          memberId: member.id,
                          query: current.memberId === member.id ? current.query : "",
                        }))
                      }
                      onChange={(event) =>
                        setReplacementSearch({
                          memberId: member.id,
                          query: event.target.value,
                        })
                      }
                    />
                  </div>
                  {replacementSearch.memberId === member.id &&
                    replacementSearch.query.trim().length > 0 &&
                    replacementSearch.query.trim().length < 2 && (
                      <div className="text-xs text-muted-foreground">Type at least 2 characters.</div>
                    )}
                  {replacementSearch.memberId === member.id &&
                    replacementSearch.query.trim().length >= 2 &&
                    replacementSearchResults.isLoading && (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Searching claimed organizations…
                      </div>
                    )}
                  {(() => {
                    const suggested = member.duplicateCandidates ?? [];
                    const searched =
                      replacementSearch.memberId === member.id
                        ? (replacementSearchResults.data?.data ?? []).filter(
                            (candidate) =>
                              candidate.hasOwner &&
                              candidate.id !== member.organization.id,
                          )
                        : [];
                    const candidates =
                      replacementSearch.memberId === member.id &&
                      replacementSearch.query.trim().length >= 2
                        ? searched
                        : suggested;
                    const uniqueCandidates = candidates.filter(
                      (candidate, index, all) =>
                        all.findIndex((item) => item.id === candidate.id) === index,
                    );
                    if (
                      replacementSearch.memberId === member.id &&
                      replacementSearch.query.trim().length >= 2 &&
                      !replacementSearchResults.isLoading &&
                      uniqueCandidates.length === 0
                    ) {
                      return (
                        <div className="rounded border border-dashed p-3 text-sm text-muted-foreground">
                          No claimed organizations match this search.
                        </div>
                      );
                    }
                    return uniqueCandidates.map((candidate) => (
                      <div key={candidate.id} className="flex flex-wrap items-center justify-between gap-2 rounded border bg-muted/20 p-2 text-sm">
                        <div>
                          <div className="font-semibold">{candidate.name}</div>
                          <div className="text-xs text-muted-foreground">{candidateLocation(candidate)} · {candidateLabel(candidate)}{candidate.claimed ?? candidate.hasOwner ? " · claimed" : ""}</div>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={
                            !candidate.id ||
                            candidateAlreadyIncluded(candidate) ||
                            (replacement?.loading &&
                              replacement.member.id === member.id &&
                              replacement.candidate.id === candidate.id)
                          }
                          onClick={() => void previewReplacement(member, candidate)}
                          data-testid={`btn-preview-replace-${member.id}-${candidate.id}`}
                        >
                          {replacement?.loading &&
                          replacement.member.id === member.id &&
                          replacement.candidate.id === candidate.id ? (
                            <>
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              Opening preview…
                            </>
                          ) : (
                            "Preview replacement"
                          )}
                        </Button>
                      </div>
                    ));
                  })()}
                </div>
              </div>
              <div className="space-y-3">
                <BrandImageField label="Organization logo" value={member.organization.logoUrl ?? ""} onChange={(value) => void updateOrgLogo(member, value)} kind="logo" idPrefix={`member-logo-${member.id}`} />
                <div className="grid grid-cols-2 gap-2" data-testid={`member-brand-colors-${member.id}`}>
                  {([
                    ["Primary", "primary"],
                    ["Secondary", "secondary"],
                  ] as const).map(([label, key]) => {
                    const value = orgBrandDraft(member)[key];
                    return (
                      <label key={key} className="text-xs font-semibold">
                        {label}
                        <div className="mt-1 flex items-center gap-2">
                          <Input
                            type="color"
                            value={value}
                            onChange={(event) =>
                              setOrgBrandColor(member, key, event.target.value)
                            }
                            className="h-9 w-12 cursor-pointer p-1"
                            aria-label={`${member.organization.name} ${label.toLowerCase()} color`}
                          />
                          <Input
                            value={value}
                            onChange={(event) =>
                              setOrgBrandColor(member, key, event.target.value)
                            }
                            className="h-9 font-mono text-xs"
                            aria-label={`${member.organization.name} ${label.toLowerCase()} color hex`}
                          />
                        </div>
                      </label>
                    );
                  })}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={savingOrgBrand === member.organization.id}
                  onClick={() => void saveOrgBrandColors(member)}
                  data-testid={`btn-save-member-brand-${member.id}`}
                >
                  {savingOrgBrand === member.organization.id ? "Saving…" : "Save organization colors"}
                </Button>
              </div>
              <div className="flex flex-wrap gap-1">
                <Button size="sm" variant="outline" onClick={() => updateMember(member, "visibility")}>{member.visible ? <EyeOff className="mr-1 h-3.5 w-3.5" /> : <Eye className="mr-1 h-3.5 w-3.5" />}{member.visible ? "Hide" : "Show"}</Button>
                <Button size="sm" variant="outline" onClick={() => updateMember(member, "remove")}>Remove from page</Button>
                <Button size="sm" variant="destructive" disabled={!member.canDeleteStaleImport} title={!member.canDeleteStaleImport ? "Claimed or content-bearing organizations must be hidden or removed instead" : undefined} onClick={() => updateMember(member, "delete")}><Trash2 className="mr-1 h-3.5 w-3.5" /> Delete stale import</Button>
              </div>
            </div>
          ))}
        </div>
        {replacementSummary && (
          <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm" data-testid="partner-replacement-summary">
            <div className="font-bold">Replacement complete</div>
            <div>{String(replacementSummary.summary ?? "The organization and its partner membership were updated.")}</div>
            {replacementSummary.affectedTeams !== undefined && <div className="text-muted-foreground">{String(replacementSummary.affectedTeams)} teams · {String(replacementSummary.affectedPosts ?? 0)} posts updated</div>}
          </div>
        )}
        {replacement && (
          <div
            ref={replacementPanelRef}
            className="rounded-lg border border-amber-300 bg-amber-50 p-4 shadow-lg ring-2 ring-amber-200"
            role="dialog"
            aria-label="Confirm organization replacement"
            data-testid="dialog-partner-replacement"
          >
            <div className="font-bold">Review replacement</div>
            <p className="mt-1 text-sm">
              Replace <strong>{replacement.member.organization.name}</strong> with <strong>{replacement.candidate.name}</strong>?
              This preview includes the affected teams and content before anything is changed.
            </p>
            {replacement.member.protected && (
              <p className="mt-2 rounded border border-amber-300 bg-amber-100 p-2 text-sm font-semibold text-amber-900">
                This source organization and its protected data remain in place. Only the partner directory membership will be replaced.
              </p>
            )}
            {replacement.loading && <p className="mt-2 text-sm text-muted-foreground">Loading impact preview…</p>}
            {replacement.impact && (
              <div className="mt-3 space-y-2 rounded border bg-background p-3 text-sm" data-testid="replacement-impact-preview">
                {replacement.impact.summary && <div>{String(replacement.impact.summary)}</div>}
                <div className="grid gap-2 sm:grid-cols-3">
                  {replacement.impact.affectedTeams !== undefined && <div><strong>{String(replacement.impact.affectedTeams)}</strong><span className="ml-1 text-muted-foreground">teams</span></div>}
                  {replacement.impact.affectedPosts !== undefined && <div><strong>{String(replacement.impact.affectedPosts)}</strong><span className="ml-1 text-muted-foreground">posts</span></div>}
                  {replacement.impact.affectedHighlights !== undefined && <div><strong>{String(replacement.impact.affectedHighlights)}</strong><span className="ml-1 text-muted-foreground">highlights</span></div>}
                </div>
                {(replacement.impact.warnings ?? []).map((warning) => <div key={warning} className="font-semibold text-amber-700">{warning}</div>)}
                {replacement.impact.cleanup && <div className="text-muted-foreground">Cleanup: {Array.isArray(replacement.impact.cleanup) ? replacement.impact.cleanup.join(", ") : replacement.impact.cleanup}</div>}
                {replacement.impact.stale && replacement.impact.stale.length > 0 && (
                  <div className="space-y-1 border-t pt-2">
                    <div className="font-semibold">Current import cleanup impact</div>
                    {replacement.impact.stale.map((item) => (
                      <div key={item.name} className={item.safe ? "text-emerald-700" : "text-amber-700"}>
                        {item.name}: {item.safe ? "safe to remove" : `preserved (${(item.reasons ?? []).join(", ") || "protected data"})`}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => setReplacement(null)}>Cancel</Button>
              <Button type="button" disabled={replacement.loading || !replacement.impact || replacement.impact.canReplace === false} onClick={() => void confirmReplacement()} data-testid="btn-confirm-partner-replacement">Confirm replacement</Button>
            </div>
          </div>
        )}
      </Step>

      <Step number={4} title="Feature competitions" done={selectedCompetitions.length > 0}>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Feature any number of tournaments or leagues on this partner page. Linking does not change their owner, hub, branding, or schedule.
          </p>
          {selectedCompetitions.map((selectedCompetition) => (
            <div key={selectedCompetition.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 p-4" data-testid={`featured-competition-current-${selectedCompetition.id}`}>
              <div className="flex min-w-0 items-start gap-3">
                <Trophy className="mt-1 h-5 w-5 shrink-0 text-primary" />
                <div className="min-w-0">
                  <div className="font-black">{selectedCompetition.name}</div>
                  <div className="text-sm capitalize text-muted-foreground">
                    {selectedCompetition.type} · {selectedCompetition.startDate} – {selectedCompetition.endDate}
                    {selectedCompetition.location ? ` · ${selectedCompetition.location}` : ""}
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link href={`/competitions/${selectedCompetition.id}`}>
                  <Button size="sm" variant="outline" className="font-bold">Open console</Button>
                </Link>
                <Button size="sm" variant="ghost" onClick={() => void removeFeaturedCompetition(selectedCompetition.id)}>Remove</Button>
              </div>
            </div>
          ))}
          <div className="space-y-2 rounded-lg border p-3">
            <Label>Search existing competitions</Label>
            <div className="relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Competition name or location"
                value={competitionSearch}
                onChange={(e) => setCompetitionSearch(e.target.value)}
                data-testid="input-partner-competition-search"
              />
            </div>
            {(competitionResults.data?.data ?? []).map((result) => (
              <div key={result.id} className="flex items-center justify-between gap-2 rounded border p-2 text-sm" data-testid={`row-partner-competition-${result.id}`}>
                <div className="min-w-0">
                  <div className="truncate font-bold">{result.name}</div>
                  <div className="truncate text-muted-foreground capitalize">
                    {result.type} · {result.startDate} – {result.endDate}{result.location ? ` · ${result.location}` : ""}
                  </div>
                </div>
                <Button size="sm" variant="outline" disabled={result.linkedToPage} onClick={() => void updateFeaturedCompetition(result.id)}>
                  {result.linkedToPage ? "Featured" : "Feature"}
                </Button>
              </div>
            ))}
          </div>
          <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
            <div className="font-bold">Create a competition and feature it</div>
            <div className="flex gap-2">
              {(["tournament", "league"] as const).map((type) => (
                <button key={type} type="button" className={`rounded-full border px-3 py-1 text-sm font-bold capitalize ${newCompetition.type === type ? "border-primary bg-primary text-primary-foreground" : ""}`} onClick={() => setNewCompetition({ ...newCompetition, type })}>
                  {type}
                </button>
              ))}
            </div>
            <Input aria-label="New competition name" placeholder="Competition name" value={newCompetition.name} onChange={(e) => setNewCompetition({ ...newCompetition, name: e.target.value })} />
            <div className="grid gap-2 sm:grid-cols-2">
              <Input aria-label="New competition start date" type="date" value={newCompetition.startDate} onChange={(e) => setNewCompetition({ ...newCompetition, startDate: e.target.value })} />
              <Input aria-label="New competition end date" type="date" min={newCompetition.startDate || undefined} value={newCompetition.endDate} onChange={(e) => setNewCompetition({ ...newCompetition, endDate: e.target.value })} />
            </div>
            <Input aria-label="New competition location" placeholder="Location (optional)" value={newCompetition.location} onChange={(e) => setNewCompetition({ ...newCompetition, location: e.target.value })} />
            <Textarea aria-label="New competition description" rows={2} placeholder="Description (optional)" value={newCompetition.description} onChange={(e) => setNewCompetition({ ...newCompetition, description: e.target.value })} />
            <Button onClick={() => void createFeaturedCompetition()} disabled={!newCompetition.name.trim() || !newCompetition.startDate || !newCompetition.endDate || newCompetition.endDate < newCompetition.startDate}>
              <Plus className="mr-2 h-4 w-4" /> Create and feature
            </Button>
          </div>
        </div>
      </Step>

      <Step number={5} title="Preview, publish, and share" done={draft.published}>
        <Card className="border-primary/25 bg-primary/5" data-testid="partner-outreach-card">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Copy outreach message</CardTitle>
            <p className="text-sm font-normal text-muted-foreground">
              This message is personalized for {draft.officialName.trim() || "this partnership"} and includes its current public page link.
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea
              readOnly
              rows={18}
              value={outreachMessage}
              aria-label="Partner outreach message"
              data-testid="textarea-partner-outreach-message"
              className="bg-background font-sans leading-6"
            />
            <Button
              type="button"
              variant="outline"
              disabled={!draft.officialName.trim() || !canonicalSlug}
              onClick={() => {
                void copyToClipboard(outreachMessage)
                  .then(() => {
                    setOutreachCopied(true);
                    toast({ title: "Outreach message copied", description: "Paste it into your email or messaging app." });
                    window.setTimeout(() => setOutreachCopied(false), 3000);
                  })
                  .catch(() => {
                    toast({ title: "Couldn't copy outreach message", description: "Select the message above and copy it manually.", variant: "destructive" });
                  });
              }}
              data-testid="btn-copy-partner-outreach-message"
            >
              {outreachCopied ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
              {outreachCopied ? "Copied!" : "Copy outreach message"}
            </Button>
          </CardContent>
        </Card>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2"><Switch checked={draft.published} onCheckedChange={(published) => void savePage(published)} /><span className="font-semibold">{draft.published ? "Published" : "Unpublished"}</span></div>
          <Link href={`/partners/${canonicalSlug}`}><Button variant="outline" disabled={!draft.published || !!slugError}>Preview public page</Button></Link>
          <Button variant="outline" disabled={!draft.published || !!slugError} onClick={() => { void navigator.clipboard.writeText(shareUrl(canonicalSlug)); toast({ title: "Partner URL copied" }); }}><Copy className="mr-2 h-4 w-4" /> Copy shareable URL</Button>
        </div>
        <div className="break-all rounded-lg bg-muted p-3 text-sm">{canonicalSlug ? shareUrl(canonicalSlug) : "Enter a valid partner URL segment to preview the shareable address."}</div>
      </Step>
    </div>
  );
}