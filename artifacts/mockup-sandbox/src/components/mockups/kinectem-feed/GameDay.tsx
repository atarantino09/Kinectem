import { useState } from "react";
import {
  Bell, Bookmark, CalendarDays, ChevronDown, ChevronRight, Heart,
  Home, Mail, MessageCircle, MoreHorizontal, Plus, Search, Share2,
  Users, Trophy, Video, ArrowUpRight, Star, Sparkles,
} from "lucide-react";
import "./_group.css";
import "./GameDay.css";

const orgs = [
  { name: "Northstar Athletics", initials: "NA", color: "from-sky-500 to-blue-700", teams: ["Northstar U15", "Northstar U17"] },
  { name: "Eastside Soccer Club", initials: "ES", color: "from-emerald-500 to-teal-700", teams: ["Eastside Eagles"] },
  { name: "Summit Sports", initials: "SS", color: "from-orange-400 to-rose-600", teams: ["Summit 2012 Boys"] },
];

const feedPosts = [
  {
    team: "Northstar U15", org: "Northstar Athletics", author: "Coach Jordan Lee", age: "2 hours ago",
    title: "A hard-fought finish under the lights",
    description: "Proud of the way this group stayed together and kept pushing. Three goals, a clean sheet in the second half, and an incredible team effort from start to finish.",
    score: "Northstar U15  3 — 1  River City FC", date: "SAT, APR 19 · HOME", reactions: 24, comments: 6,
  },
  {
    team: "Eastside Eagles", org: "Eastside Soccer Club", author: "Maya Chen", age: "Yesterday",
    title: "Weekend tournament highlights",
    description: "Some favorite moments from a memorable weekend. Thank you to all the families who cheered us on!",
    score: "Spring Classic · Finalists", date: "SUN, APR 20", reactions: 18, comments: 3,
  },
];

function Avatar({ label, className = "" }: { label: string; className?: string }) {
  return <div className={`gday-avatar ${className}`}>{label}</div>;
}

function LeftSidebar() {
  return (
    <aside className="gday-left">
      <section className="app-surface overflow-hidden">
        <div className="brand-gradient-cover gday-cover"><div className="brand-banner-pattern absolute inset-0" /></div>
        <div className="gday-profile">
          <Avatar label="AM" className="gday-profile-avatar" />
          <h3>Alex Morgan</h3><p>Soccer parent · Seattle, WA</p>
          <button className="gday-outline-button">View Profile</button>
        </div>
      </section>
      <section className="app-surface gday-side-card">
        <h4 className="app-section-heading">Your Orgs and Teams</h4>
        {orgs.map((org, index) => <div key={org.name}>
          <div className="gday-org-row">
            {index === 0 ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <span className={`gday-org-mark bg-gradient-to-br ${org.color}`}>{org.initials}</span>
            <span className="truncate">{org.name}</span>{index === 0 && <Bookmark size={14} className="ml-auto text-primary" />}
          </div>
          {index === 0 && <div className="gday-team-list">{org.teams.map(team => <p key={team}>{team}</p>)}</div>}
        </div>)}
      </section>
      <section className="app-surface gday-side-card">
        <h4 className="app-section-heading">Competitions You Follow</h4>
        <div className="gday-competition"><span><Trophy size={15} /></span><div><b>Spring Classic</b><small>Tournament</small></div></div>
      </section>
    </aside>
  );
}

function SuggestionsPanel({ heading, items }: { heading: string; items: string[] }) {
  const [following, setFollowing] = useState<string[]>([]);
  return <section className="app-surface gday-suggestion-card">
    <h4 className="app-section-heading">{heading}</h4>
    {items.map((name, index) => {
      const isFollowing = following.includes(name);
      return <div className="gday-suggestion" key={name}>
        <Avatar label={name.split(" ").map(word => word[0]).join("")} />
        <div className="min-w-0 flex-1"><p>{name}</p><small>{index === 0 ? "Seattle, WA" : "Youth soccer"}</small></div>
        <button onClick={() => setFollowing(old => isFollowing ? old.filter(item => item !== name) : [...old, name])} className={`gday-follow ${isFollowing ? "is-following" : ""}`}>{isFollowing ? "Following" : "Follow"}</button>
      </div>;
    })}
  </section>;
}

function FeedPost({ post }: { post: typeof feedPosts[number] }) {
  const [liked, setLiked] = useState(false);
  return <article className="app-surface app-surface-interactive gday-feed-post">
    <div className="gday-post-header">
      <Avatar label={post.org.split(" ").map(word => word[0]).join("")} className="gday-org-avatar" />
      <div className="min-w-0 flex-1"><p className="gday-org-name">{post.org}</p><p className="gday-team-name">{post.team}</p><small>{post.author} <span>·</span> {post.age}</small></div>
      <span className="brand-pill"><Video size={12} /> Game Recap</span><button className="gday-icon-button" aria-label="Post actions"><MoreHorizontal size={17} /></button>
    </div>
    <div className="gday-post-body"><h3>{post.title}</h3><p>{post.description}</p>
      <div className="gday-score"><div><small>Final score</small><strong>{post.score}</strong><em><CalendarDays size={12} /> {post.date}</em></div><span><Trophy size={23} /></span></div>
    </div>
    <div className="gday-post-actions">
      <button className={liked ? "liked" : ""} onClick={() => setLiked(!liked)}><Heart size={15} fill={liked ? "currentColor" : "none"} />{post.reactions + (liked ? 1 : 0)}</button>
      <button><MessageCircle size={15} />{post.comments}</button><button className="gday-share"><Share2 size={15} /> <span>Share</span></button>
    </div>
  </article>;
}

function LeadStory() {
  const [saved, setSaved] = useState(false);
  return <article className="gday-lead app-surface">
    <div className="gday-lead-image"><img src="/__mockup/images/under-lights.jpg" alt="Youth soccer players celebrating under stadium lights" /><div className="gday-lead-overlay" /><div className="gday-lead-tag"><Star size={13} /> Spotlight recap</div></div>
    <div className="gday-lead-copy">
      <div className="gday-lead-meta"><span className="gday-team-dot">NA</span><span>Northstar Athletics</span><i>•</i><span>Northstar U15</span><span className="gday-live-note">From your teams</span></div>
      <h2>They found another gear<br className="hidden sm:block" /> under the lights.</h2>
      <p>Northstar U15 stayed composed through a thrilling second half. Read the coach’s recap and relive the moments that brought the sideline to its feet.</p>
      <div className="gday-lead-footer"><span><b>Coach Jordan Lee</b><small>2 hours ago · Game recap</small></span><button className={`gday-save ${saved ? "is-saved" : ""}`} onClick={() => setSaved(!saved)}><Bookmark size={15} fill={saved ? "currentColor" : "none"} /> {saved ? "Saved" : "Save story"}</button><button className="gday-read">Read recap <ArrowUpRight size={15} /></button></div>
    </div>
  </article>;
}

export default function GameDay() {
  return <div className="gday-page">
    <header className="app-shell-header sticky top-0 z-30">
      <div className="gday-header-inner">
        <a href="#" className="gday-logo" aria-label="Kinectem home"><img src="/__mockup/logo-horizontal.png" alt="Kinectem" /></a>
        <div className="gday-search"><Search size={16} /><input type="search" placeholder="Search athletes, teams, organizations..." /></div>
        <nav className="gday-nav"><a className="active" href="#"><Home size={16} />Home</a><a href="#"><Users size={16} />Teams</a><a href="#"><CalendarDays size={16} />Games</a></nav>
        <button className="gday-create"><Plus size={16} />Create</button><button className="gday-notification" aria-label="Notifications"><Bell size={19} /><i /></button><Avatar label="AM" />
      </div>
    </header>
    <main className="gday-main">
      <div className="gday-grid">
        <LeftSidebar />
        <section className="gday-center">
          <div className="gday-page-intro"><div><span className="gday-eyebrow"><Sparkles size={13} /> Your community pulse</span><h1>Game day, <span>together.</span></h1><p>Recaps, highlights, and the moments your teams will talk about all week.</p></div><button className="gday-filter">Latest <ChevronDown size={15} /></button></div>
          <LeadStory />
          <div className="gday-feed-heading"><div><span className="gday-eyebrow">Keep up with your teams</span><h2>Latest activity</h2></div><button>View all <ArrowUpRight size={14} /></button></div>
          {feedPosts.map(post => <FeedPost key={post.title} post={post} />)}
        </section>
        <aside className="gday-right"><SuggestionsPanel heading="People to follow" items={["Taylor Robinson", "Sam Patel", "Jamie Wilson"]} /><SuggestionsPanel heading="Organizations to follow" items={["Westlake Youth Sports", "City United"]} /><SuggestionsPanel heading="Teams to follow" items={["River City FC", "Lakeside Stars"]} /></aside>
      </div>
    </main>
    <div className="gday-inbox"><Mail size={15} /> Inbox <i /></div>
  </div>;
}