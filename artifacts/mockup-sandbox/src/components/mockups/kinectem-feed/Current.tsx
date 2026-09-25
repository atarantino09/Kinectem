import {
  Bell, Bookmark, CalendarDays, ChevronDown, ChevronRight, Heart,
  Home, Mail, MessageCircle, MoreHorizontal, Plus, Search, Share2,
  Users, Trophy, Video,
} from "lucide-react";
import "./_group.css";

const orgs = [
  { name: "Northstar Athletics", initials: "NA", color: "from-sky-500 to-blue-700", teams: ["Northstar U15", "Northstar U17"] },
  { name: "Eastside Soccer Club", initials: "ES", color: "from-emerald-500 to-teal-700", teams: ["Eastside Eagles"] },
  { name: "Summit Sports", initials: "SS", color: "from-orange-400 to-rose-600", teams: ["Summit 2012 Boys"] },
];

const posts = [
  {
    team: "Northstar U15", org: "Northstar Athletics", author: "Coach Jordan Lee", age: "2 hours ago",
    title: "A hard-fought finish under the lights",
    description: "Proud of the way this group stayed together and kept pushing. Three goals, a clean sheet in the second half, and an incredible team effort from start to finish.",
    score: "Northstar U15  3 — 1  River City FC", date: "SAT, APR 19 · HOME",
    reactionCount: 24, comments: 6, featured: false,
  },
  {
    team: "Eastside Eagles", org: "Eastside Soccer Club", author: "Maya Chen", age: "Yesterday",
    title: "Weekend tournament highlights",
    description: "Some favorite moments from a memorable weekend. Thank you to all the families who cheered us on!",
    score: "Spring Classic · Finalists", date: "SUN, APR 20",
    reactionCount: 18, comments: 3, featured: true,
  },
];

function Avatar({ label, className = "" }: { label: string; className?: string }) {
  return <div className={`flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-700 font-bold text-white ${className}`}>{label}</div>;
}

function BrandPageHeader() {
  return (
    <header className="app-page-header">
      <div className="app-page-header-content">
        <div className="app-kicker">Your community pulse</div>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-3xl font-black tracking-tight sm:text-4xl">Latest <span className="brand-gradient-text">Activity</span></h1>
            <p className="mt-2 max-w-2xl text-sm font-medium leading-relaxed text-muted-foreground">
              The latest highlights, recaps, and updates from the people and teams you follow.
            </p>
          </div>
        </div>
      </div>
    </header>
  );
}

function PostCard({ post }: { post: (typeof posts)[number] }) {
  return (
    <article className="app-surface app-surface-interactive overflow-hidden">
      {post.featured && (
        <div className="flex items-center gap-2 px-5 py-2 text-xs font-black uppercase tracking-widest text-white" style={{ background: "linear-gradient(120deg,#6d28d9,#2563eb)" }}>
          <Trophy className="h-4 w-4" /> Featured by Spring Classic
        </div>
      )}
      <div className="relative flex items-center justify-between border-b border-border/60 px-5 py-4">
        <div className="flex w-full min-w-0 items-center gap-3 sm:w-auto">
          <Avatar label={post.org.split(" ").map((word) => word[0]).join("")} className="h-10 w-10 rounded-lg text-xs" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs text-muted-foreground">{post.org}</p>
            <p className="truncate text-sm font-bold">{post.team}</p>
            <p className="mt-0.5 truncate text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              {post.author} <span>•</span> {post.age}
            </p>
          </div>
        </div>
        <div className="absolute right-4 top-2 flex shrink-0 items-center gap-2 sm:static">
          <span className="brand-pill"><Video className="h-3 w-3" /> Game Recap</span>
          <button className="rounded-md p-1.5 text-muted-foreground hover:bg-muted" aria-label="Post actions"><MoreHorizontal className="h-4 w-4" /></button>
        </div>
      </div>
      <div className="px-5 py-4">
        <div className="mb-2 flex items-start gap-2">
          <h3 className="flex-1 text-xl font-black leading-tight tracking-tight">{post.title}</h3>
        </div>
        <hr className="mb-3 border-border" />
        <p className="mb-4 text-sm leading-relaxed text-muted-foreground">{post.description}</p>
        <div className="brand-gradient-dark relative overflow-hidden rounded-xl p-5 text-white">
          <div className="absolute -right-8 -top-12 h-40 w-40 rounded-full border-[28px] border-white/5" />
          <div className="relative flex items-center justify-between gap-3">
            <div>
              <p className="mb-2 text-[10px] font-black uppercase tracking-[.2em] text-white/65">Final score</p>
              <p className="text-lg font-black tracking-tight">{post.score}</p>
              <p className="mt-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-white/65"><CalendarDays className="h-3 w-3" />{post.date}</p>
            </div>
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-white/15"><Trophy className="h-6 w-6 text-amber-300" /></div>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 border-t border-border/60 px-5 py-3">
        <button className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-sm font-bold hover:bg-muted"><Heart className="h-3.5 w-3.5" />{post.reactionCount}</button>
        <button className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-sm font-semibold text-muted-foreground hover:bg-muted"><MessageCircle className="h-3.5 w-3.5" />{post.comments}</button>
        <button className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-sm font-semibold text-muted-foreground hover:bg-muted"><Share2 className="h-4 w-4" /><span className="hidden sm:inline">Share</span></button>
      </div>
    </article>
  );
}

function LeftSidebar() {
  return (
    <aside className="hidden space-y-4 lg:sticky lg:top-20 lg:block lg:max-h-[calc(100vh-6rem)] lg:self-start lg:overflow-y-auto">
      <section className="app-surface overflow-hidden">
        <div className="brand-gradient-cover relative h-16"><div aria-hidden="true" className="brand-banner-pattern absolute inset-0" /></div>
        <div className="-mt-8 p-4">
          <Avatar label="AM" className="h-16 w-16 border-4 border-white text-xl shadow-sm" />
          <h3 className="mt-3 text-base font-black tracking-tight">Alex Morgan</h3>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Soccer parent · Seattle, WA</p>
          <button className="mt-4 w-full rounded-lg border border-border py-2 text-sm font-bold hover:bg-muted">View Profile</button>
        </div>
      </section>
      <section className="app-surface p-4">
        <h4 className="app-section-heading mb-3 text-muted-foreground">Your Orgs and Teams</h4>
        <div className="space-y-1">
          {orgs.map((org, index) => (
            <div key={org.name}>
              <div className="group flex items-center gap-1 rounded-md px-1 py-1.5 hover:bg-muted/50">
                {index === 0 ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                <div className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-gradient-to-br ${org.color} text-[8px] font-black text-white`}>{org.initials}</div>
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">{org.name}</span>
                {index === 0 && <Bookmark className="h-3.5 w-3.5 text-primary" />}
              </div>
              {index === 0 && <div className="mb-2 ml-5 space-y-0.5 border-l-2 border-border pl-3">{org.teams.map((team) => <p key={team} className="truncate rounded-md px-1.5 py-1.5 text-xs font-semibold text-muted-foreground">{team}</p>)}</div>}
            </div>
          ))}
        </div>
      </section>
      <section className="app-surface p-4">
        <h4 className="app-section-heading mb-3 text-muted-foreground">Competitions You Follow</h4>
        <div className="flex items-center gap-2.5 rounded-lg px-2 py-1.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-amber-100 text-amber-700"><Trophy className="h-4 w-4" /></div>
          <div><p className="text-sm font-bold">Spring Classic</p><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Tournament</p></div>
        </div>
      </section>
    </aside>
  );
}

function SuggestionsPanel({ heading, items }: { heading: string; items: string[] }) {
  return (
    <section className="app-surface p-4">
      <h4 className="app-section-heading mb-3 text-muted-foreground">{heading}</h4>
      <div className="space-y-3">
        {items.map((name, index) => (
          <div className="flex items-center gap-2.5" key={name}>
            <Avatar label={name.split(" ").map((word) => word[0]).join("")} className="h-8 w-8 text-[10px]" />
            <div className="min-w-0 flex-1"><p className="truncate text-xs font-bold">{name}</p><p className="text-[10px] text-muted-foreground">{index === 0 ? "Seattle, WA" : "Youth soccer"}</p></div>
            <button className="rounded-md border border-border px-2 py-1 text-[10px] font-bold text-primary hover:bg-muted">Follow</button>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function Current() {
  return (
    <div className="min-h-screen text-foreground">
      <header className="app-shell-header sticky top-0 z-30 border-b border-border bg-card/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 md:gap-6">
          <a href="#" className="flex shrink-0 items-center" aria-label="Kinectem home">
            <img src="/__mockup/logo-horizontal.png" alt="Kinectem" className="block h-9 w-auto" />
          </a>
          <div className="relative hidden max-w-md flex-1 md:block">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input type="search" placeholder="Search athletes, teams, organizations..." className="h-10 w-full rounded-lg border border-transparent bg-muted/80 py-2 pl-9 pr-3 text-sm outline-none focus:border-primary/30 focus:bg-card" />
          </div>
          <nav className="hidden items-center gap-1 lg:flex">
            <a className="flex items-center gap-2 rounded-lg bg-secondary px-3 py-2 text-sm font-semibold" href="#"><Home className="h-4 w-4" />Home</a>
            <a className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-muted-foreground hover:bg-muted" href="#"><Users className="h-4 w-4" />Teams</a>
            <a className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-muted-foreground hover:bg-muted" href="#"><CalendarDays className="h-4 w-4" />Games</a>
          </nav>
          <button className="ml-auto flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-bold text-primary-foreground"><Plus className="h-4 w-4" />Create</button>
          <button className="relative rounded-lg p-2 text-muted-foreground hover:bg-muted" aria-label="Notifications"><Bell className="h-5 w-5" /><span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-pink-500 ring-2 ring-white" /></button>
          <Avatar label="AM" className="h-9 w-9 text-xs" />
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[260px_minmax(0,1fr)_300px]">
          <LeftSidebar />
          <section className="min-w-0 space-y-4">
            <BrandPageHeader />
            {posts.map((post) => <PostCard key={post.title} post={post} />)}
          </section>
          <aside className="hidden space-y-4 lg:sticky lg:top-20 lg:block lg:max-h-[calc(100vh-6rem)] lg:self-start lg:overflow-y-auto">
            <SuggestionsPanel heading="People to follow" items={["Taylor Robinson", "Sam Patel", "Jamie Wilson"]} />
            <SuggestionsPanel heading="Organizations to follow" items={["Westlake Youth Sports", "City United"]} />
            <SuggestionsPanel heading="Teams to follow" items={["River City FC", "Lakeside Stars"]} />
          </aside>
        </div>
      </main>
      <div className="fixed bottom-4 right-4 hidden items-center gap-2 rounded-full border border-border bg-card px-3 py-2 text-xs text-muted-foreground shadow-lg xl:flex">
        <Mail className="h-4 w-4" /> Inbox <span className="h-1.5 w-1.5 rounded-full bg-primary" />
      </div>
    </div>
  );
}