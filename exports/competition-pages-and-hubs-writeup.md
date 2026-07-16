# Kinectem — Competition Pages & Organizer Hubs
### Feature breakdown + benefits write-up (for marketing planning)

Kinectem is a youth-sports social platform (team pages, game recaps, photos, followers, COPPA-compliant accounts for minors). On top of that foundation we built a full **competition layer** for the people who run leagues and tournaments. This document explains what a Competition Page is, what an Organizer Hub is, how branding works, every feature inside them, and why they matter to an organizer.

---

## 1. Competition Pages — a branded home for every event

Every league or tournament gets its own **public, shareable page** at a clean URL (e.g. `kinectem.com/app/competitions/c/spring-classic-2026`). No login required to view it.

### What's on the public page
- **Full event branding**: hero banner image, logo, and a three-color brand system (primary color drives the hero gradient, secondary completes it, tertiary colors the badges and accents). The page looks like *the organizer's event*, not a generic listing.
- **Event details**: name, league vs. tournament type, dates, location.
- **Complete schedule**: every match grouped by division/bracket with match number, date, time, venue, and field.
- **Live scores**: reported scores appear right on the schedule.
- **Team list**: every participating team slot, with links to claimed teams' pages.
- **Featured recap rail**: a curated feed of the best game recaps written by participating teams — the event page becomes a living highlight reel, not a static bracket.
- **Follow button**: parents, players, and fans can follow the competition and get it in their feed.

### The Operator Console (organizer-only)
- **CSV schedule import**: upload the schedule export straight from scheduling tools (e.g. GotSport-style exports work as-is — column headers are auto-aliased, only four columns required). Re-uploading updates matches in place, so schedule changes are painless.
- **Team claiming with an approval queue**: coaches claim their slot on the schedule. Organizers can approve each claim manually or flip on auto-approve. If a coach's team name doesn't match the slot name, they must explicitly confirm — protecting schedule integrity.
- **Recap curation**: organizers see every recap written about their games and choose which ones to feature on the public page.
- **Ready-made invites**: one click generates a pre-written invite message (with the public link) to paste into email or the team group chat, so getting teams onto the platform takes minutes.

### How teams plug in
- **Existing Kinectem teams** claim their slot and the competition's games flow directly onto their team schedule.
- **Teams not on Kinectem yet** can create a lightweight "solo team" on the spot — and they get a **free recap-posting window** (tournament start through 7 days after) so every team can participate in the content flywheel with zero friction and zero cost.
- Claiming is race-safe: one slot, one team, enforced server-side.

### Recaps carry the event's brand everywhere
When a team posts a recap for a competition game, the post carries a **competition brand block** — the event's badge, colors, and a link back to the competition page — wherever that post travels in feeds. Multi-game "combined" recaps are supported and labeled. Every recap a team shares is free marketing for the event.

### Automated content nudges
- A background scheduler sends team staff a **recap reminder ~2 hours after each game** if nothing has been written yet.
- **AI Assist** helps coaches draft polished recaps in seconds (admin-configured, with COPPA guardrails — minors can never trigger external AI).
- Players get ~24-hour game reminders; cancellations/postponements trigger immediate notices.
- All notifications to minors route to their linked guardians (COPPA-compliant by design).

---

## 2. Organizer Hubs — the "brand home" above the events

An **Organizer Hub** is the parent identity for anyone who runs more than one event — a tournament series, a league operator, a club that hosts an annual cup.

- **Own public page** (`/organizers/<slug>`) with its own logo, banner, and colors.
- **All competitions in one place**, grouped Active / Upcoming / Past — the hub becomes the permanent home fans bookmark year after year.
- **Branding inheritance**: create a competition under the hub and the wizard pre-fills the hub's logo and colors — every event launches on-brand in seconds (each event can still customize).
- **Cross-competition recap rail**: the hub surfaces the best featured recaps from *all* its events.
- **Hub followers**: fans follow the organizer itself, so next year's event launches to a built-in audience.
- **Multi-admin support**: invite staff by email as hub admins; they automatically get management rights over every competition under the hub.

---

## 3. The creation flow (how fast it is)

A three-step wizard:
1. **Details** — name, league/tournament, dates, location, optional hub (pulls in branding).
2. **Branding** — logo upload, three brand colors, banner image.
3. **Schedule** — paste or upload the CSV; matches and team slots are created instantly.

An organizer can go from nothing to a fully branded, fully scheduled public event page in under ten minutes.

---

## 4. Why this matters to someone who runs a competition

1. **Your event gets a real digital home, not a PDF schedule.** Branded page, live scores, shareable link — the professionalism of a big-league event at youth-sports scale.
2. **Marketing that writes itself.** Every recap a team posts carries your event's badge and colors into the feeds of parents, grandparents, and friends. The organizer curates the best onto the event page. Content compounds all weekend.
3. **Zero-friction team onboarding.** CSV import from the tools you already use, copy-paste invites, one-click slot claiming, and a free posting window for teams that aren't customers yet. No "everyone must sign up first" wall.
4. **Schedule changes stop being a fire drill.** Re-upload the CSV and matches update in place; cancellations and postponements notify affected families automatically.
5. **An audience you keep.** Followers on the competition and the hub persist — next year's registration announcement lands in front of every family who followed this year.
6. **Built for youth sports specifically.** COPPA-compliant minor accounts, guardian-routed notifications, and privacy-by-default profiles — the compliance story is handled, which most generic event platforms can't say.
7. **Delegate without losing control.** Hub admins, claim approval queues, and recap curation give operators exactly as much oversight as they want.

---

## 5. Quick positioning notes (for the marketing plan)

- **Audience**: tournament directors, league administrators, club event coordinators.
- **Core promise**: "Give your tournament the online presence of a professional event — and let the teams do your marketing."
- **Differentiators vs. scheduling tools (GotSport, TeamSnap Tournaments, etc.)**: they stop at schedules and brackets; Kinectem adds the social/content layer (branded recaps, followers, feeds) and imports their CSVs, so it complements rather than replaces existing workflows.
- **Land-and-expand motion**: one tournament brings dozens of teams and hundreds of families onto the platform via slot claiming and the free solo-team recap window; teams then convert to full org/team plans.
