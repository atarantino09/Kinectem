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
import kinectemIcon from "@assets/kinectem_icon_1788367110859.png";
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  MapPin,
  Search,
  Sparkles,
  Trophy,
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
    competition: {
      id: string;
      slug: string;
      name: string;
      type: "tournament" | "league" | string;
      startDate: string;
      endDate: string;
      location: string | null;
    } | null;
    organizations: PartnerOrganization[];
  };
};

function hexRgb(hex: string): [number, number, number] {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return [17, 24, 39];
  return [
    Number.parseInt(match[1].slice(0, 2), 16),
    Number.parseInt(match[1].slice(2, 4), 16),
    Number.parseInt(match[1].slice(4, 6), 16),
  ];
}

function relativeLuminance(hex: string) {
  return hexRgb(hex).reduce((total, value, index) => {
    const channel = value / 255;
    const linear = channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    return total + linear * [0.2126, 0.7152, 0.0722][index];
  }, 0);
}

function contrastRatio(first: string, second: string) {
  const lighter = Math.max(relativeLuminance(first), relativeLuminance(second));
  const darker = Math.min(relativeLuminance(first), relativeLuminance(second));
  return (lighter + 0.05) / (darker + 0.05);
}

function readableText(background: string) {
  const darkText = "#111827";
  const lightText = "#ffffff";
  return contrastRatio(background, darkText) >= contrastRatio(background, lightText) ? darkText : lightText;
}

function readableBrandInk(brandColor: string) {
  return contrastRatio(brandColor, "#ffffff") >= 4.5 ? brandColor : "#0f172a";
}

function locationOf(org: PartnerOrganization) {
  return [org.city, org.state].filter(Boolean).join(", ") || org.location || "Location coming soon";
}

const storyPoints = [
  {
    title: "You already have software that runs your season.",
    body: "TeamSnap, Byga, PlayMetrics, GotSport, Stack — whichever one your club uses, it gets you to kickoff. None of that changes when you add Kinectem.",
  },
  {
    title: "Kinectem starts where those platforms stop.",
    body: "After every game, a coach jots down a few notes. AI Assist turns those notes into a complete game recap, auto-tags the roster, and creates a lasting written history on every team and player page.",
  },
  {
    title: "Your club page brings every team's story together.",
    body: "Every team, every game recap, and every player appears under your crest. Every game from every team in your club shows up in one place, on its own, as it happens.",
  },
];

const valueProps = [
  {
    title: "Two-minute game recaps with AI Assist",
    body: "Turn a coach's quick notes into a story families want to read and share.",
  },
  {
    title: "Permanent player histories that grow every season",
    body: "Give every athlete a living archive of the moments that made their season.",
  },
  {
    title: "One living club page for every team's story",
    body: "Bring every team, recap, and player together under one recognizable home.",
  },
];

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
  const intro = page.introduction || "Kinectem is the youth-sports platform where the story of your season comes to life — a lasting home for every club, team, player, and game day.";
  const featuredCompetition = data.competition;
  const competitionDate = (value: string) =>
    new Date(`${value}T00:00:00`).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });

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
          color: "#ffffff",
          background: page.bannerUrl
            ? `linear-gradient(110deg, rgba(15,23,42,0.18), rgba(15,23,42,0.52)), linear-gradient(110deg, ${page.primaryColor}f2, ${page.secondaryColor}cc), url("${page.bannerUrl}") center/cover`
            : `linear-gradient(110deg, rgba(15,23,42,0.18), rgba(15,23,42,0.52)), linear-gradient(125deg, ${page.primaryColor}, ${page.secondaryColor})`,
        }}
      >
        <div className="absolute inset-0 opacity-20" style={{ backgroundImage: "radial-gradient(circle at 80% 10%, white 0, transparent 32%), radial-gradient(circle at 10% 90%, white 0, transparent 26%)" }} />
        <div className="relative mx-auto max-w-6xl">
          <div className="mb-8 text-center">
            <p className="mb-4 text-xs font-black uppercase tracking-[0.22em] opacity-80 md:text-sm">
              Proud partner with Kinectem
            </p>
            <div className="flex items-center justify-center gap-3 sm:gap-5">
              <div className="flex w-32 min-w-0 flex-col items-center text-center md:w-40">
                <div className="grid h-32 w-32 place-items-center rounded-3xl bg-white/95 shadow-xl md:h-40 md:w-40">
                  {page.logoUrl ? <img src={page.logoUrl} alt={`${page.officialName} logo`} className="h-full w-full rounded-3xl object-contain p-3" /> : <Building2 className="h-16 w-16 text-slate-500 md:h-20 md:w-20" />}
                </div>
                <div className="mt-3 flex min-h-[3.25rem] max-w-[10rem] flex-col justify-start">
                  <div className="text-[10px] font-black uppercase tracking-[0.18em] opacity-70">{page.associationLabel}</div>
                  <div className="mt-1 text-sm font-black leading-tight md:text-base">{page.officialName}</div>
                </div>
              </div>
              <span className="text-3xl font-light opacity-70 md:text-5xl" aria-hidden="true">×</span>
              <div className="flex w-32 min-w-0 flex-col items-center text-center md:w-40">
                <img
                  src={kinectemIcon}
                  alt="Kinectem logo"
                  className="h-32 w-32 rounded-3xl object-contain shadow-xl md:h-40 md:w-40"
                />
                <div className="mt-3 flex min-h-[3.25rem] items-start justify-center text-sm font-black leading-tight md:text-base">Kinectem</div>
              </div>
            </div>
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

      {featuredCompetition && (
        <section className="mx-auto -mt-8 max-w-6xl px-5" data-testid="featured-partner-competition">
          <Card className="overflow-hidden rounded-3xl border-0 shadow-xl">
            <CardContent className="flex flex-col gap-5 p-6 md:flex-row md:items-center md:justify-between md:p-8">
              <div className="flex items-start gap-4">
                <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl text-white" style={{ background: page.primaryColor }}>
                  <Trophy className="h-7 w-7" />
                </div>
                <div>
                  <div className="text-xs font-black uppercase tracking-[0.18em]" style={{ color: page.primaryColor }}>Featured competition</div>
                  <h2 className="mt-1 text-2xl font-black text-slate-900">{featuredCompetition.name}</h2>
                  <p className="mt-1 text-sm capitalize text-slate-600">
                    {featuredCompetition.type} · {competitionDate(featuredCompetition.startDate)} – {competitionDate(featuredCompetition.endDate)}
                    {featuredCompetition.location ? ` · ${featuredCompetition.location}` : ""}
                  </p>
                </div>
              </div>
              <Link href={`/c/${encodeURIComponent(featuredCompetition.slug)}`}>
                <Button className="w-full rounded-xl font-black md:w-auto" style={{ background: page.primaryColor }} data-testid="link-featured-partner-competition">
                  View competition <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
            </CardContent>
          </Card>
        </section>
      )}

      <section
        id="partner-content"
        className="relative overflow-hidden px-5 py-10 md:py-16"
        style={{
          backgroundImage: `radial-gradient(circle at 0% 8%, ${page.primaryColor}16 0, transparent 28%), radial-gradient(circle at 100% 44%, ${page.secondaryColor}18 0, transparent 30%)`,
        }}
      >
        <div className="relative mx-auto max-w-6xl">
        <div className="mb-8 inline-flex w-full rounded-2xl border bg-white p-1 shadow-sm md:w-auto">
          {(["why", "clubs"] as const).map((value) => (
            <button key={value} onClick={() => setTab(value)} className={`flex-1 rounded-xl px-6 py-3 text-sm font-black md:flex-none ${tab === value ? "shadow" : "text-slate-600"}`} style={tab === value ? { background: page.primaryColor, color: readableText(page.primaryColor) } : undefined}>
              {value === "why" ? "Why Kinectem" : "Find Your Club"}
            </button>
          ))}
        </div>

        {tab === "why" ? (
          <div
            className="relative isolate overflow-hidden rounded-[2rem] border p-2 shadow-[0_28px_90px_-42px_rgba(15,23,42,0.55)]"
            style={{
              backgroundImage: `linear-gradient(135deg, ${page.primaryColor}30, ${page.secondaryColor}42), linear-gradient(120deg, #ffffff, ${page.secondaryColor}12)`,
            }}
          >
            <div
              className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full opacity-30 blur-3xl"
              style={{ backgroundColor: page.primaryColor }}
            />
            <div
              className="pointer-events-none absolute -bottom-32 -right-20 h-80 w-80 rounded-full opacity-25 blur-3xl"
              style={{ backgroundColor: page.secondaryColor }}
            />
            <div className="relative grid gap-5 lg:grid-cols-2 lg:items-stretch">
              <div className="flex h-full flex-col rounded-[1.6rem] border border-white/80 bg-white/95 p-6 shadow-xl shadow-slate-900/5 backdrop-blur-xl md:p-8">
                <div className="flex items-center gap-3">
                  <span
                    className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-white shadow-lg"
                    style={{ background: page.primaryColor }}
                  >
                    <Sparkles className="h-5 w-5" />
                  </span>
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.2em]" style={{ color: readableBrandInk(page.primaryColor) }}>
                      The Kinectem difference
                    </p>
                    <p className="mt-1 text-sm font-bold text-slate-500">Built for what happens after kickoff</p>
                  </div>
                </div>
                <p className="mt-7 text-xl font-bold leading-relaxed text-slate-700 md:text-2xl">
                  {intro}
                </p>
                <div className="mt-7 grid gap-3">
                  {storyPoints.map((point, index) => (
                    <article
                      key={point.title}
                      className="group rounded-2xl border border-slate-200/80 bg-slate-50/80 p-4 transition duration-200 hover:-translate-y-0.5 hover:border-white hover:bg-white hover:shadow-lg md:p-5"
                    >
                      <div className="flex items-start gap-3">
                        <span
                          className="grid h-8 w-8 shrink-0 place-items-center rounded-xl text-xs font-black"
                          style={{
                            color: readableBrandInk(page.primaryColor),
                            backgroundColor: `${page.primaryColor}16`,
                          }}
                        >
                          {String(index + 1).padStart(2, "0")}
                        </span>
                        <div>
                          <h2 className="text-lg font-black leading-tight text-slate-900 md:text-xl">
                            {point.title}
                          </h2>
                          <p className="mt-2 text-sm leading-relaxed text-slate-600">
                            {point.body}
                          </p>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              </div>

              <div className="flex h-full flex-col gap-4">
                <div className="rounded-[1.6rem] border border-white/80 bg-white/75 p-6 shadow-lg shadow-slate-900/5 backdrop-blur-xl">
                  <div className="flex items-center justify-between gap-4">
                    <p className="text-xs font-black uppercase tracking-[0.2em]" style={{ color: readableBrandInk(page.primaryColor) }}>
                      Why organizations add Kinectem
                    </p>
                    <span className="rounded-full bg-white/80 px-3 py-1 text-xs font-black text-slate-500 shadow-sm">
                      01 — 03
                    </span>
                  </div>
                  <p className="mt-3 text-sm font-semibold leading-relaxed text-slate-600">
                    Keep the tools your teams already trust — and finally make
                    every game matter after the final whistle.
                  </p>
                </div>
                {valueProps.map((valueProp, index) => (
                  <Card
                    key={valueProp.title}
                    className="flex-1 rounded-[1.6rem] border border-white/80 bg-white/90 shadow-lg shadow-slate-900/5 transition duration-200 hover:-translate-y-0.5 hover:shadow-xl"
                  >
                    <CardContent className="flex h-full items-start gap-4 p-5 md:p-6">
                      <span
                        className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-white shadow-md"
                        style={{
                          background: page.secondaryColor,
                          color: readableText(page.secondaryColor),
                        }}
                      >
                        <Sparkles className="h-5 w-5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="mb-2 text-xs font-black uppercase tracking-[0.18em]" style={{ color: readableBrandInk(page.secondaryColor) }}>
                          {String(index + 1).padStart(2, "0")} / KINECTEM
                        </div>
                        <h3 className="text-lg font-black leading-tight text-slate-900">
                          {valueProp.title}
                        </h3>
                        <p className="mt-2 text-sm leading-relaxed text-slate-600">
                          {valueProp.body}
                        </p>
                      </div>
                      <CheckCircle2 className="h-5 w-5 shrink-0" style={{ color: readableBrandInk(page.primaryColor) }} />
                    </CardContent>
                  </Card>
                ))}
                <div
                  className="relative overflow-hidden rounded-[1.6rem] p-6 shadow-xl md:p-7"
                  style={{
                    color: "#ffffff",
                    backgroundImage: `linear-gradient(135deg, rgba(15,23,42,0.2), rgba(15,23,42,0.56)), linear-gradient(135deg, ${page.primaryColor}, ${page.secondaryColor})`,
                  }}
                >
                  <div className="pointer-events-none absolute -right-12 -top-16 h-40 w-40 rounded-full border-[22px] border-white/15" />
                  <div className="relative">
                    <p className="text-xs font-black uppercase tracking-[0.2em] opacity-75">
                      Ready when your next game ends?
                    </p>
                    <h2 className="mt-2 text-2xl font-black tracking-tight">
                      Your club page is already built.
                    </h2>
                    <p className="mt-2 max-w-lg text-sm font-semibold leading-relaxed opacity-80">
                      We&apos;ve built the organization page and every team page
                      for the clubs across {page.officialName}. Yours is
                      waiting.
                    </p>
                    <Button
                      className="mt-5 w-full rounded-xl px-5 font-black sm:w-auto"
                      style={{ background: foreground, color: page.primaryColor }}
                      onClick={() => setTab("clubs")}
                    >
                      Find your club <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
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
        </div>
      </section>
    </main>
  );
}