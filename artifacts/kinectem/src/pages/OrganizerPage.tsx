import { useEffect, useState } from "react";
import { Link, useLocation, useRoute } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch, useGetLoggedInUser } from "@workspace/api-client-react";
import { BrandColorField } from "@/components/BrandColorField";
import { BrandImageField } from "@/components/BrandImageField";
import { CompetitionAdminsPanel } from "@/components/CompetitionAdminsPanel";
import { CompetitionBrandStrip } from "@/components/CompetitionBrandStrip";
import { OrganizerSidebar } from "@/components/OrganizerSidebar";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useToast } from "@/hooks/use-toast";
import {
  CalendarDays,
  Check,
  ChevronDown,
  Link2,
  MapPin,
  Pencil,
  Star,
  Trash2,
  Trophy,
} from "lucide-react";
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

// Task #723 — PUBLIC organizer hub page: the parent company's home base.
// Branded hero (mirrors CompetitionPage), its competitions grouped by
// status, and featured recaps pulled from across all of them. Matched both
// standalone (`/organizers/<slug>`) and inside the AppShell
// (`/competitions/o/<slug>`). customFetch — routes are outside the locked
// openapi.yaml.

type OrganizerMeta = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  logoUrl: string | null;
  brandColor: string | null;
  secondaryColor: string | null;
  tertiaryColor: string | null;
  bannerUrl: string | null;
  websiteUrl: string | null;
  // Task #818 — referral promo code; server includes it only for hub
  // owners/admins.
  promoCode?: string | null;
  isFollowing?: boolean;
  // Task #745 — server-derived management flags: admins get the manage
  // surface, only the owner sees owner-only controls (admin removal).
  viewerCanManage?: boolean;
  viewerIsOwner?: boolean;
};

type OrganizerCompetition = {
  id: string;
  slug: string;
  name: string;
  type: "tournament" | "league";
  startDate: string;
  endDate: string;
  location: string | null;
  logoUrl: string | null;
  brandColor: string | null;
  isActive: boolean;
  isEnded: boolean;
  matchCount: number;
  participantCount: number;
};

type OrganizerFeaturedRecap = {
  id: string;
  title: string;
  summary: string | null;
  coverImageUrl: string | null;
  gameDate: string | null;
  teamName: string;
  competitionName: string | null;
  competition: {
    slug: string;
    name: string;
    logoUrl: string | null;
    brandColor: string | null;
    secondaryColor: string | null;
  } | null;
};

type OrganizerResponse = {
  organizer: OrganizerMeta;
  competitions: OrganizerCompetition[];
  featuredRecaps: OrganizerFeaturedRecap[];
};

function contrastText(hex: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "#ffffff";
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 160 ? "#111111" : "#ffffff";
}

const DEFAULT_BRAND = "#1e293b";

function fmtDate(d: string): string {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, day ?? 1).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// Task #846 — owner-only hub delete. Type-to-confirm; the server blocks the
// delete (409) while any competition is still attached, so the dialog warns
// up front when the hub isn't empty.
function DeleteHubButton({
  organizer,
  competitionCount,
}: {
  organizer: OrganizerMeta;
  competitionCount: number;
}) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  useEffect(() => {
    if (!open) setConfirm("");
  }, [open]);

  const del = useMutation({
    mutationFn: () =>
      customFetch<{ ok: true }>(`/api/v1/organizers/${organizer.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm }),
      }),
    onSuccess: () => {
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["my", "organizers"] });
      qc.invalidateQueries({ queryKey: ["organizer"] });
      toast({ title: "Hub deleted" });
      navigate("/competitions");
    },
    onError: (err) =>
      toast({
        title: "Couldn't delete the hub",
        description:
          err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      }),
  });

  const blocked = competitionCount > 0;
  const matches =
    confirm.trim().replace(/\s+/g, " ").toLowerCase() ===
    organizer.name.trim().replace(/\s+/g, " ").toLowerCase();

  return (
    <>
      <Button
        variant="outline"
        className="font-bold rounded-full border-destructive/50 text-destructive hover:bg-destructive hover:text-destructive-foreground"
        onClick={() => setOpen(true)}
        data-testid="btn-delete-hub"
      >
        <Trash2 className="w-3.5 h-3.5 mr-1.5" />
        Delete hub
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent data-testid="dialog-delete-hub">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {blocked
                ? "This hub still has competitions"
                : `Delete "${organizer.name}"?`}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                {blocked ? (
                  <p>
                    <span className="font-bold text-foreground">
                      {competitionCount} competition
                      {competitionCount === 1 ? " is" : "s are"} still attached
                      to this hub.
                    </span>{" "}
                    Delete those competitions (or detach them from the hub)
                    first — then you can delete the hub itself.
                  </p>
                ) : (
                  <p>
                    This permanently removes the hub — its branding, admins,
                    followers, and pending admin invites. This can't be undone.
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          {!blocked ? (
            <div className="space-y-1.5">
              <Label htmlFor="delete-hub-confirm" className="text-xs font-bold">
                Type the hub name to confirm
              </Label>
              <Input
                id="delete-hub-confirm"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder={organizer.name}
                data-testid="input-delete-hub-confirm"
              />
            </div>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="btn-delete-hub-cancel">
              {blocked ? "Got it" : "Never mind"}
            </AlertDialogCancel>
            {!blocked ? (
              <AlertDialogAction
                disabled={!matches || del.isPending}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={(e) => {
                  e.preventDefault();
                  del.mutate();
                }}
                data-testid="btn-delete-hub-confirm"
              >
                {del.isPending ? "Deleting…" : "Delete forever"}
              </AlertDialogAction>
            ) : null}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// Owner-only inline edit panel (details + branding).
function EditHubPanel({ organizer }: { organizer: OrganizerMeta }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [name, setName] = useState(organizer.name);
  const [description, setDescription] = useState(organizer.description ?? "");
  const [websiteUrl, setWebsiteUrl] = useState(organizer.websiteUrl ?? "");
  const [brandColor, setBrandColor] = useState(organizer.brandColor ?? "");
  const [secondaryColor, setSecondaryColor] = useState(
    organizer.secondaryColor ?? "",
  );
  const [tertiaryColor, setTertiaryColor] = useState(
    organizer.tertiaryColor ?? "",
  );
  const [logoUrl, setLogoUrl] = useState(organizer.logoUrl ?? "");
  const [bannerUrl, setBannerUrl] = useState(organizer.bannerUrl ?? "");
  const [promoCode, setPromoCode] = useState(organizer.promoCode ?? "");

  useEffect(() => {
    setName(organizer.name);
    setDescription(organizer.description ?? "");
    setWebsiteUrl(organizer.websiteUrl ?? "");
    setBrandColor(organizer.brandColor ?? "");
    setSecondaryColor(organizer.secondaryColor ?? "");
    setTertiaryColor(organizer.tertiaryColor ?? "");
    setLogoUrl(organizer.logoUrl ?? "");
    setBannerUrl(organizer.bannerUrl ?? "");
    setPromoCode(organizer.promoCode ?? "");
  }, [organizer]);

  const save = useMutation({
    mutationFn: () =>
      customFetch(`/api/v1/organizers/${organizer.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          websiteUrl: websiteUrl.trim() || null,
          brandColor: brandColor.trim() || null,
          secondaryColor: secondaryColor.trim() || null,
          tertiaryColor: tertiaryColor.trim() || null,
          logoUrl: logoUrl.trim() || null,
          bannerUrl: bannerUrl.trim() || null,
          promoCode: promoCode.trim() || null,
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["organizer"] });
      qc.invalidateQueries({ queryKey: ["my", "organizers"] });
      toast({ title: "Hub saved" });
    },
    onError: (err) =>
      toast({
        title: "Couldn't save the hub",
        description:
          err instanceof Error ? err.message : "Check the values and try again.",
        variant: "destructive",
      }),
  });

  const hexOk = (v: string) =>
    v.trim() === "" || /^#[0-9a-fA-F]{6}$/.test(v.trim());
  const canSave =
    name.trim().length > 0 &&
    hexOk(brandColor) &&
    hexOk(secondaryColor) &&
    hexOk(tertiaryColor) &&
    !save.isPending;

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="hub-name" className="text-xs font-bold">
              Company name
            </Label>
            <Input
              id="hub-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={200}
              data-testid="input-hub-name"
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="hub-desc" className="text-xs font-bold">
              About <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <textarea
              id="hub-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder="What your company runs and where."
              className="w-full rounded-lg border border-border bg-background p-3 text-sm"
              data-testid="input-hub-description"
            />
          </div>
          <BrandImageField
            label="Logo"
            value={logoUrl}
            onChange={setLogoUrl}
            kind="logo"
            idPrefix="hub-logo"
          />
          <BrandColorField
            label="Primary color"
            value={brandColor}
            onChange={setBrandColor}
            logoUrl={logoUrl}
            idPrefix="hub-brand"
          />
          <BrandColorField
            label="Secondary color"
            value={secondaryColor}
            onChange={setSecondaryColor}
            logoUrl={logoUrl}
            idPrefix="hub-brand-secondary"
          />
          <BrandColorField
            label="Third color"
            value={tertiaryColor}
            onChange={setTertiaryColor}
            logoUrl={logoUrl}
            idPrefix="hub-brand-tertiary"
          />
          <BrandImageField
            label="Banner"
            value={bannerUrl}
            onChange={setBannerUrl}
            kind="banner"
            idPrefix="hub-banner"
          />
          <div className="space-y-1.5">
            <Label htmlFor="hub-site" className="text-xs font-bold">
              Official website
            </Label>
            <Input
              id="hub-site"
              value={websiteUrl}
              onChange={(e) => setWebsiteUrl(e.target.value)}
              placeholder="https://mycompany.com"
              data-testid="input-hub-website"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="hub-promo-code" className="text-xs font-bold">
              Promo code{" "}
              <span className="font-normal text-muted-foreground">
                (if you have one)
              </span>
            </Label>
            <Input
              id="hub-promo-code"
              value={promoCode}
              onChange={(e) => setPromoCode(e.target.value)}
              maxLength={64}
              placeholder="e.g. MYEVENTS25"
              data-testid="input-hub-promo-code"
            />
            <p className="text-xs text-muted-foreground">
              Auto-fills the ready-made referral messages on all of your
              competitions (each competition can override it with its own
              code).
            </p>
          </div>
        </div>
        <Button
          variant="brand"
          disabled={!canSave}
          onClick={() => save.mutate()}
          data-testid="btn-save-hub"
        >
          {save.isPending ? "Saving…" : "Save hub"}
        </Button>
      </CardContent>
    </Card>
  );
}

function CompetitionGroup({
  title,
  comps,
  brand,
  inApp,
}: {
  title: string;
  comps: OrganizerCompetition[];
  brand: string;
  inApp: boolean;
}) {
  if (comps.length === 0) return null;
  return (
    <section className="space-y-3" data-testid={`group-${title.toLowerCase().replace(/\s+/g, "-")}`}>
      <h2 className="text-sm font-black uppercase tracking-widest text-muted-foreground">
        {title}
      </h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {comps.map((c) => (
          <Link
            key={c.id}
            href={inApp ? `/competitions/c/${c.slug}` : `/c/${c.slug}`}
          >
            <Card
              className="rounded-xl border-border cursor-pointer transition-shadow hover:shadow-md h-full"
              style={{ borderTopColor: c.brandColor ?? brand, borderTopWidth: 3 }}
              data-testid={`card-organizer-competition-${c.id}`}
            >
              <CardContent className="p-4 space-y-2">
                <div className="flex items-center gap-2">
                  {c.logoUrl ? (
                    <img
                      src={c.logoUrl}
                      alt=""
                      className="h-8 w-8 rounded-lg object-contain bg-white shrink-0"
                    />
                  ) : (
                    <Trophy className="h-5 w-5 text-muted-foreground shrink-0" />
                  )}
                  <div className="min-w-0">
                    <p className="font-black tracking-tight truncate">{c.name}</p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant="outline" className="capitalize">
                        {c.type}
                      </Badge>
                      {c.isActive ? (
                        <Badge>{c.type === "league" ? "Season" : "Live"}</Badge>
                      ) : null}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                  <span className="flex items-center gap-1">
                    <CalendarDays className="w-3.5 h-3.5" />
                    {fmtDate(c.startDate)}
                    {c.endDate !== c.startDate ? ` – ${fmtDate(c.endDate)}` : ""}
                  </span>
                  {c.location ? (
                    <span className="flex items-center gap-1">
                      <MapPin className="w-3.5 h-3.5" />
                      {c.location}
                    </span>
                  ) : null}
                  {c.participantCount > 0 ? (
                    <span>{c.participantCount} teams</span>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </section>
  );
}

export default function OrganizerPage() {
  const [, publicParams] = useRoute("/organizers/:slug");
  const [, appParams] = useRoute("/competitions/o/:slug");
  const slug = publicParams?.slug ?? appParams?.slug ?? "";
  const inApp = !!appParams;
  const { data: me } = useGetLoggedInUser();
  const [editOpen, setEditOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  // Follow-style share link — the public hub URL is always /organizers/<slug>
  // (never the in-app /app/competitions/o/... path).
  const shareUrl = `${window.location.origin}/app/organizers/${slug}`;
  const copyShareLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({
        title: "Couldn't copy the link",
        description: shareUrl,
      });
    }
  };

  // Follow / unfollow — quick-access only (mirrors the competition page).
  const qcTop = useQueryClient();
  const followMutation = useMutation({
    mutationFn: (follow: boolean) =>
      customFetch<{ ok: true; isFollowing: boolean }>(
        `/api/v1/organizers/${encodeURIComponent(slug)}/follow`,
        { method: follow ? "POST" : "DELETE" },
      ),
    onSuccess: () => {
      qcTop.invalidateQueries({ queryKey: ["organizer", slug] });
      qcTop.invalidateQueries({ queryKey: ["my-followed-organizers"] });
    },
  });

  const q = useQuery<OrganizerResponse>({
    queryKey: ["organizer", slug],
    queryFn: () =>
      customFetch<OrganizerResponse>(
        `/api/v1/organizers/${encodeURIComponent(slug)}`,
        { method: "GET" },
      ),
    enabled: !!slug,
    retry: false,
  });

  if (q.isLoading) {
    return (
      <div className="min-h-screen max-w-4xl mx-auto p-6 space-y-4">
        <Skeleton className="h-48 rounded-xl" />
        <Skeleton className="h-48 rounded-xl" />
      </div>
    );
  }

  if (q.isError || !q.data) {
    return (
      <div className="min-h-screen max-w-xl mx-auto p-6">
        <Card className="rounded-xl border-border">
          <CardContent className="p-6 text-center space-y-2">
            <h1 className="text-xl font-black tracking-tight">
              Competition hub unavailable
            </h1>
            <p className="text-sm text-muted-foreground">
              This competition hub link is invalid or no longer available.
            </p>
            <Link href="/">
              <Button variant="outline" className="font-bold mt-2">
                Go home
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { organizer: o, competitions, featuredRecaps } = q.data;
  // Task #745 — manage rights come from the server: owner OR hub admin.
  // Owner-only distinctions (admin removal) live inside CompetitionAdminsPanel.
  const canManage = !!o.viewerCanManage;
  const brand = o.brandColor ?? DEFAULT_BRAND;
  const heroText = contrastText(brand);
  const heroBackground = o.secondaryColor
    ? `linear-gradient(135deg, ${brand} 0%, ${brand} 55%, ${o.secondaryColor} 100%)`
    : brand;

  const upcoming = competitions.filter((c) => !c.isActive && !c.isEnded);
  const active = competitions.filter((c) => c.isActive);
  const past = competitions.filter((c) => c.isEnded);

  const page = (
    <div className="min-h-screen">
      {/* Branded hero — same visual language as the competition page */}
      <div
        style={{ background: heroBackground, color: heroText }}
        data-testid="hero-organizer"
      >
        {o.bannerUrl ? (
          // Banner gets the majority of the hero; the branded strip below is
          // deliberately compact so the artwork isn't crowded out.
          <div className="h-56 sm:h-80 w-full overflow-hidden">
            <img src={o.bannerUrl} alt="" className="h-full w-full object-cover" />
          </div>
        ) : null}
        <div className="max-w-4xl mx-auto px-6 pt-5 pb-4 space-y-2">
          <div className="flex items-start gap-4">
            {o.logoUrl ? (
              <img
                src={o.logoUrl}
                alt={`${o.name} logo`}
                className="h-14 w-14 sm:h-16 sm:w-16 rounded-xl object-contain bg-white/90 p-1.5 shrink-0"
                data-testid="img-organizer-logo"
              />
            ) : null}
            <div className="min-w-0 space-y-1.5">
              <span
                className="inline-block rounded-full border px-2 py-0.5 text-[11px] font-black uppercase tracking-widest"
                style={{ borderColor: heroText, opacity: 0.9 }}
              >
                Competition hub
              </span>
              <h1
                className="text-2xl sm:text-3xl font-black tracking-tight"
                data-testid="text-organizer-name"
              >
                {o.name}
              </h1>
              {o.description ? (
                <p className="text-sm max-w-2xl opacity-90">{o.description}</p>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <span className="text-xs font-bold opacity-90">
              {competitions.length} competition
              {competitions.length === 1 ? "" : "s"}
            </span>
            {o.websiteUrl ? (
              <a
                href={o.websiteUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs underline opacity-85"
                data-testid="link-organizer-website"
              >
                Official website
              </a>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              className="font-bold border-white/70 bg-transparent hover:bg-white/10 rounded-full"
              style={{ color: heroText, borderColor: heroText }}
              onClick={copyShareLink}
              data-testid="btn-share-organizer"
            >
              {copied ? (
                <Check className="w-3.5 h-3.5 mr-1.5" />
              ) : (
                <Link2 className="w-3.5 h-3.5 mr-1.5" />
              )}
              {copied ? "Link copied" : "Share hub"}
            </Button>
            {me ? (
              <Button
                variant="outline"
                size="sm"
                className="font-bold border-white/70 bg-transparent hover:bg-white/10 rounded-full"
                style={{ color: heroText, borderColor: heroText }}
                onClick={() => followMutation.mutate(!o.isFollowing)}
                disabled={followMutation.isPending}
                data-testid="btn-follow-organizer"
              >
                <Star
                  className={`w-3.5 h-3.5 mr-1.5 ${o.isFollowing ? "fill-current" : ""}`}
                />
                {o.isFollowing ? "Following" : "Follow"}
              </Button>
            ) : null}
          </div>
          <p className="text-[11px] opacity-70 pt-1">Powered by Kinectem</p>
        </div>
      </div>

      <div className="max-w-4xl mx-auto p-6 space-y-8">
        {canManage && inApp ? (
          <Collapsible open={editOpen} onOpenChange={setEditOpen}>
            <div className="flex items-center gap-2 flex-wrap">
              <CollapsibleTrigger asChild>
                <Button
                  variant="outline"
                  className="font-bold rounded-full"
                  data-testid="btn-toggle-edit-hub"
                >
                  <Pencil className="w-3.5 h-3.5 mr-1.5" />
                  Edit hub
                  <ChevronDown
                    className={`w-3.5 h-3.5 ml-1.5 transition-transform ${editOpen ? "rotate-180" : ""}`}
                  />
                </Button>
              </CollapsibleTrigger>
              <Link href={`/competitions?organizer=${o.id}`}>
                <Button variant="brand" className="font-bold" data-testid="btn-create-from-hub">
                  <Trophy className="w-3.5 h-3.5 mr-1.5" />
                  Create a competition
                </Button>
              </Link>
              {o.viewerIsOwner ? (
                <DeleteHubButton
                  organizer={o}
                  competitionCount={competitions.length}
                />
              ) : null}
            </div>
            <CollapsibleContent className="pt-3">
              <EditHubPanel organizer={o} />
            </CollapsibleContent>
          </Collapsible>
        ) : null}

        {featuredRecaps.length > 0 && (
          <section className="space-y-3" data-testid="rail-organizer-featured-recaps">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-lg font-black tracking-tight">
                Featured game recaps
              </h2>
              <span
                className="text-[11px] font-black uppercase tracking-widest"
                style={{ color: brand }}
              >
                Across {o.name} events
              </span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {featuredRecaps.map((r) => (
                <Link key={r.id} href={`/posts/${r.id}`}>
                  <Card
                    className="rounded-xl border-border overflow-hidden cursor-pointer transition-shadow hover:shadow-md h-full"
                    style={
                      r.competition
                        ? undefined
                        : { borderTopColor: brand, borderTopWidth: 3 }
                    }
                    data-testid={`card-organizer-recap-${r.id}`}
                  >
                    {r.competition ? (
                      <CompetitionBrandStrip
                        name={r.competition.name}
                        logoUrl={r.competition.logoUrl}
                        brandColor={r.competition.brandColor}
                        secondaryColor={r.competition.secondaryColor}
                      />
                    ) : null}
                    {r.coverImageUrl ? (
                      <div className="h-32 w-full overflow-hidden">
                        <img
                          src={r.coverImageUrl}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      </div>
                    ) : null}
                    <CardContent className="p-4 space-y-1.5">
                      <p className="font-black tracking-tight leading-snug line-clamp-2">
                        {r.title}
                      </p>
                      {r.summary ? (
                        <p className="text-xs text-muted-foreground line-clamp-2">
                          {r.summary}
                        </p>
                      ) : null}
                      <p className="text-[11px] font-bold text-muted-foreground">
                        {r.teamName}
                        {r.competitionName ? ` · ${r.competitionName}` : ""}
                      </p>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </section>
        )}

        {competitions.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="p-8 text-center text-sm text-muted-foreground">
              No competitions here yet.
            </CardContent>
          </Card>
        ) : (
          <>
            <CompetitionGroup title="Happening now" comps={active} brand={brand} inApp={inApp} />
            <CompetitionGroup title="Upcoming" comps={upcoming} brand={brand} inApp={inApp} />
            <CompetitionGroup title="Past" comps={past} brand={brand} inApp={inApp} />
          </>
        )}

        {canManage && inApp ? (
          // Task #745 — hub admin management. Hub admins get rights over all
          // of the hub's competitions, including ones attached later.
          // Task #753 — listed after competitions, collapsed by default.
          <CompetitionAdminsPanel kind="hub" targetId={o.id} collapsible />
        ) : null}
      </div>
    </div>
  );

  // Task #745 — the organizer sidebar only makes sense inside the app shell;
  // the public fullscreen hub page (/organizers/:slug) stays sidebar-free.
  return inApp ? <OrganizerSidebar>{page}</OrganizerSidebar> : page;
}
