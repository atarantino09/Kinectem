import { useMemo, useState } from "react";
import { Link, useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { customFetch, useGetLoggedInUser } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { OrgLogo } from "@/components/OrgLogoFallback";
import { formatOrgName } from "@/lib/format";
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  MapPin,
  Search,
  Sparkles,
} from "lucide-react";

type PartnerOrganization = {
  id: string;
  name: string;
  location: string | null;
  city: string | null;
  state: string | null;
  logoUrl: string | null;
  canRequestClaim: boolean;
  teams: Array<{ id: string; name: string }>;
};

type PartnerResponse = {
  data: {
    page: {
      slug: string;
      officialName: string;
      associationLabel: string;
      introduction: string;
      logoUrl: string | null;
      bannerUrl: string | null;
      primaryColor: string;
      secondaryColor: string;
    };
    organizations: PartnerOrganization[];
  };
};

function readableText(hex: string) {
  const n = Number.parseInt(hex.slice(1), 16);
  const lum = 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
  return lum > 155 ? "#111827" : "#ffffff";
}

function locationOf(org: PartnerOrganization) {
  return [org.city, org.state].filter(Boolean).join(", ") || org.location || "Location coming soon";
}

export default function PartnerLandingPage() {
  const [, params] = useRoute("/partners/:slug");
  const slug = params?.slug ?? "";
  const [tab, setTab] = useState<"why" | "clubs">("why");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<PartnerOrganization | null>(null);
  const [form, setForm] = useState({ organizationName: "", fullName: "", title: "", confirmCorrect: false, confirmAuthorized: false });
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const { data: me } = useGetLoggedInUser();
  const partner = useQuery<PartnerResponse>({
    queryKey: ["partner-page", slug],
    queryFn: () => customFetch(`/api/v1/partner-pages/${encodeURIComponent(slug)}`, { method: "GET" }),
    enabled: !!slug,
    retry: false,
  });
  const data = partner.data?.data;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.organizations ?? []).filter((org) =>
      !q || `${org.name} ${locationOf(org)}`.toLowerCase().includes(q),
    );
  }, [data, query]);

  if (partner.isLoading) {
    return <div className="mx-auto max-w-6xl space-y-4 p-5"><Skeleton className="h-80 rounded-3xl" /><Skeleton className="h-60 rounded-3xl" /></div>;
  }
  if (!data) {
    return <div className="mx-auto max-w-xl p-8 text-center"><h1 className="text-2xl font-black">Partner page unavailable</h1><p className="mt-2 text-muted-foreground">This page may be unpublished or the URL may be incorrect.</p></div>;
  }
  const { page } = data;
  const foreground = readableText(page.primaryColor);
  const intro = page.introduction || `Kinectem is the youth-sports platform where the story of your season comes to life. Explore the clubs across ${page.officialName}.`;

  const beginClaim = (org: PartnerOrganization) => {
    setSelected(org);
    setSubmitted(false);
    setForm({
      organizationName: "",
      fullName: me ? [me.firstName, me.lastName].filter(Boolean).join(" ") : "",
      title: "",
      confirmCorrect: false,
      confirmAuthorized: false,
    });
  };

  const submitClaim = async () => {
    if (!selected) return;
    setSubmitting(true);
    try {
      await customFetch(`/api/v1/partner-pages/${encodeURIComponent(slug)}/claims`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId: selected.id, ...form }),
      });
      setSubmitted(true);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-50">
      <section
        className="relative overflow-hidden px-5 py-16 md:py-24"
        style={{
          color: foreground,
          background: page.bannerUrl
            ? `linear-gradient(110deg, ${page.primaryColor}f2, ${page.secondaryColor}cc), url("${page.bannerUrl}") center/cover`
            : `linear-gradient(125deg, ${page.primaryColor}, ${page.secondaryColor})`,
        }}
      >
        <div className="absolute inset-0 opacity-20" style={{ backgroundImage: "radial-gradient(circle at 80% 10%, white 0, transparent 32%), radial-gradient(circle at 10% 90%, white 0, transparent 26%)" }} />
        <div className="relative mx-auto max-w-6xl">
          <div className="mb-8 flex items-center gap-4">
            {page.logoUrl ? <img src={page.logoUrl} alt={`${page.officialName} logo`} className="h-32 w-32 rounded-3xl bg-white/95 object-contain p-3 shadow-xl md:h-40 md:w-40" /> : <div className="grid h-32 w-32 place-items-center rounded-3xl bg-white/20 md:h-40 md:w-40"><Building2 className="h-16 w-16 md:h-20 md:w-20" /></div>}
            <div><div className="text-sm font-black uppercase tracking-[0.22em] opacity-80">{page.associationLabel}</div><div className="text-xl font-black md:text-2xl">{page.officialName}</div></div>
          </div>
          <h1 className="max-w-4xl text-4xl font-black leading-[0.98] tracking-tight md:text-7xl">They run your season. Kinectem makes it last.</h1>
          <p className="mt-6 max-w-3xl text-lg font-semibold leading-relaxed opacity-90 md:text-xl">
            Kinectem is not another registration, scheduling, or communication app. It complements TeamSnap, Byga, PlayMetrics, GotSport, Stack, and whatever your club already uses.
          </p>
          <Button className="mt-8 rounded-full px-6 font-black" style={{ background: foreground, color: page.primaryColor }} onClick={() => { setTab("clubs"); document.getElementById("partner-content")?.scrollIntoView({ behavior: "smooth" }); }}>
            Find your club <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </section>

      <section id="partner-content" className="mx-auto max-w-6xl px-5 py-10 md:py-16">
        <div className="mb-8 inline-flex w-full rounded-2xl border bg-white p-1 shadow-sm md:w-auto">
          {(["why", "clubs"] as const).map((value) => (
            <button key={value} onClick={() => setTab(value)} className={`flex-1 rounded-xl px-6 py-3 text-sm font-black md:flex-none ${tab === value ? "text-white shadow" : "text-slate-600"}`} style={tab === value ? { background: page.primaryColor } : undefined}>
              {value === "why" ? "Why Kinectem" : "Find Your Club"}
            </button>
          ))}
        </div>

        {tab === "why" ? (
          <div className="grid gap-6 lg:grid-cols-[1.1fr_.9fr]">
            <div className="space-y-8 rounded-3xl bg-white p-7 shadow-sm md:p-10">
              <p className="text-xl font-semibold leading-relaxed text-slate-700">{intro}</p>
              <div><h2 className="text-2xl font-black">You already have software that runs your season.</h2><p className="mt-3 leading-relaxed text-slate-600">TeamSnap, Byga, PlayMetrics, GotSport, Stack — whichever one your club uses, it gets you to kickoff. None of that changes when you add Kinectem.</p></div>
              <div><h2 className="text-2xl font-black">Kinectem starts where those platforms stop.</h2><p className="mt-3 leading-relaxed text-slate-600">After every game, a coach jots down a few notes. AI Assist turns those notes into a complete game recap, auto-tags the roster, and creates a lasting written history on every team and player page.</p></div>
              <div><h2 className="text-2xl font-black">Your club page brings every team's story together.</h2><p className="mt-3 leading-relaxed text-slate-600">Every team, every game recap, and every player appears under your crest. Every game from every team in your club shows up in one place, on its own, as it happens.</p></div>
              <div className="rounded-2xl p-5 text-white" style={{ background: page.primaryColor }}><h2 className="text-2xl font-black">Your club page is already built.</h2><p className="mt-2 opacity-90">We've built the organization page and every team page for the clubs across {page.officialName}. Yours is sitting there waiting.</p></div>
            </div>
            <div className="space-y-4">
              {["Two-minute game recaps with AI Assist", "Permanent player histories that grow every season", "One living club page for every team's story"].map((text) => (
                <Card key={text} className="rounded-2xl border-0 shadow-sm"><CardContent className="flex gap-4 p-6"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-white" style={{ background: page.secondaryColor }}><Sparkles className="h-5 w-5" /></span><div className="font-black text-slate-800">{text}</div></CardContent></Card>
              ))}
              <Button className="w-full rounded-xl font-black" style={{ background: page.primaryColor }} onClick={() => setTab("clubs")}>Find your club</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="relative max-w-xl"><Search className="absolute left-4 top-3.5 h-5 w-5 text-slate-400" /><Input className="h-12 rounded-xl bg-white pl-12" placeholder="Search club name or location" value={query} onChange={(e) => setQuery(e.target.value)} /></div>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {filtered.map((org) => (
                <Card key={org.id} className="rounded-2xl border-0 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
                  <CardContent className="flex h-full flex-col p-5">
                    <div className="flex items-start gap-3"><OrgLogo name={org.name} logoUrl={org.logoUrl} className="h-14 w-14 rounded-xl" /><div className="min-w-0"><h3 className="font-black text-slate-900">{formatOrgName(org.name)}</h3><p className="mt-1 flex items-center gap-1 text-sm text-slate-500"><MapPin className="h-3.5 w-3.5" />{locationOf(org)}</p></div></div>
                    <div className="mt-4 text-sm text-slate-500">{org.teams.slice(0, 3).map((team) => team.name).join(" · ") || "Team pages are ready to explore"}{org.teams.length > 3 ? ` +${org.teams.length - 3} more` : ""}</div>
                    <div className="mt-auto flex flex-wrap gap-2 pt-5">
                      <Link href={`/organizations/${org.id}`}><Button variant="outline" size="sm" className="font-bold">View club page</Button></Link>
                      {org.canRequestClaim && <Button size="sm" className="font-bold" style={{ background: page.primaryColor }} onClick={() => beginClaim(org)}>Request access</Button>}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
            {filtered.length === 0 && <div className="rounded-2xl border border-dashed bg-white p-10 text-center text-slate-500">No clubs match that search.</div>}
          </div>
        )}

        {selected && (
          <Card className="mt-10 overflow-hidden rounded-3xl border-2" style={{ borderColor: page.primaryColor }}>
            <CardContent className="p-6 md:p-9">
              {submitted ? (
                <div className="text-center">
                  <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-600" />
                  <h2 className="mt-3 text-2xl font-black">Request received for {selected.name}</h2>
                  <p className="mx-auto mt-2 max-w-xl text-muted-foreground">Kinectem platform administrators will verify your identity and authority before ownership changes. Submitting this request did not grant immediate access.</p>
                </div>
              ) : (
                <div className="grid gap-8 lg:grid-cols-[.8fr_1.2fr]">
                  <div><div className="flex items-center gap-3"><OrgLogo name={selected.name} logoUrl={selected.logoUrl} className="h-16 w-16 rounded-xl" /><div><div className="text-xs font-black uppercase tracking-wide" style={{ color: page.primaryColor }}>{page.officialName}</div><h2 className="text-2xl font-black">{selected.name}</h2><p className="text-sm text-muted-foreground">{locationOf(selected)}</p></div></div><p className="mt-5 text-sm leading-relaxed text-muted-foreground">Kinectem must authenticate every requester. Only an authorized leader of {selected.name} should continue. Your request will be reviewed; access is never granted immediately.</p></div>
                  {!me ? (
                    <div className="rounded-2xl bg-muted p-6"><h3 className="font-black">Sign in or create an account to continue</h3><p className="mt-2 text-sm text-muted-foreground">We'll preserve your selected organization when you return.</p><div className="mt-4 flex gap-2"><Link href={`/login?signup=1&returnTo=${encodeURIComponent(`/partners/${slug}`)}`}><Button>Create account</Button></Link><Link href={`/login?returnTo=${encodeURIComponent(`/partners/${slug}`)}`}><Button variant="outline">Sign in</Button></Link></div></div>
                  ) : (
                    <div className="space-y-4">
                      <div className="rounded-xl bg-muted p-3 text-sm">Signed in as <strong>{me.email}</strong>. This account identity will be included in the review.</div>
                      <div><Label>Organization name</Label><Input value={form.organizationName} onChange={(e) => setForm({ ...form, organizationName: e.target.value })} placeholder={`Type ${selected.name}`} /></div>
                      <div className="grid gap-3 md:grid-cols-2"><div><Label>Full name</Label><Input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} /></div><div><Label>Title at the organization</Label><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Club president, director…" /></div></div>
                      <label className="flex gap-3 text-sm"><Checkbox checked={form.confirmCorrect} onCheckedChange={(value) => setForm({ ...form, confirmCorrect: value === true })} />I selected the correct organization: {selected.name}.</label>
                      <label className="flex gap-3 text-sm"><Checkbox checked={form.confirmAuthorized} onCheckedChange={(value) => setForm({ ...form, confirmAuthorized: value === true })} />I am authorized to represent {selected.name} and understand Kinectem will verify this request.</label>
                      <Button className="font-black" style={{ background: page.primaryColor }} disabled={submitting || !form.organizationName || !form.fullName || !form.title || !form.confirmCorrect || !form.confirmAuthorized} onClick={submitClaim}>{submitting ? "Submitting…" : `Submit request for ${selected.name}`}</Button>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </section>
    </main>
  );
}