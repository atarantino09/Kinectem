# Kinectem ↔ Tournament Director — Integration Contract

Purpose: the tournament registration flow (the "Tournament Director" app / public
registration form) must talk to the live Kinectem app so that **club pages and team
pages are actually created**, and **coach invites are actually sent**, at the right
moments. In the prototype these are simulated (localStorage + confirmation copy).
This doc is the contract the real backend (Replit / John) implements.

---

## 1. The core rule: invites fire when PAYMENT IS CHOSEN, not at trial end

A coach is invited to their team page **the moment a payment method is committed in the
registration flow** — not 90 days later when the free trial converts to a charge.

Two "payment is chosen" moments trigger it:

1. **New club creation** (the "Build my club" path): invites fire when the club admin
   finishes the plan step — i.e. starts the 90-day free period / plan and a card is on
   file. Being on a free trial does NOT delay invites.
2. **Tournament registration submit** (any path — new club, signed-in club, guest):
   invites fire for any team carrying a coach email when the registrant submits the
   Payment step (card authorized or check selected). The director still accepts the
   team later; the coach invite does not wait on acceptance.

Invites are idempotent per (clubId, teamId, coachEmail): re-submitting or re-saving
must not send a second invite to a coach already invited for that team.

---

## 1a. Guest checkout STILL builds real (provisional) club + team pages

A **guest** registrant is not a paying/claimed Kinectem club — they pay the per-team
processing fee ($25 outdoor / $10 indoor) instead of a subscription, and they register
one team at a time. **But the club and team pages must still be created on Kinectem**,
so that the coach invite (§1, which fires for guests too) lands on a real, working team
page rather than a dead link.

How guest page creation differs from a claimed club:

- On guest submit, emit `club.upsert` (for the guest's `club`/organization name) and
  one `team.upsert` per registered team, **with `status: "provisional"`** (see §2). If
  the guest didn't type a club name, create a provisional club from the enroller's name
  (e.g. "Andrew T's teams") so the team still has a parent — don't skip the club.
- A **provisional** club/team page is **live for this tournament**: the invited coach can
  set up the roster and **post game recaps during the event**. What's withheld until the
  club **claims** the pages (joins Kinectem) is the paid, season-long side — the
  **persistent all-season storybooks**, full club admin, logo/branding controls, and
  additional teams beyond what was registered. (Confirmed: post recaps during the event,
  loses the persistent storybook until claimed.)
- A provisional club does **not** start a plan and does **not** consume the once-per-
  email free trial (see §4). The free-trial clock starts only when the club actually
  joins (plan start), so a guest this weekend still gets their full 90 days free if they
  build their club later.
- **No new-club login handoff** for a guest (that CTA is for the Build-my-club path). The
  guest's path back in is the invite link (coach) and the claim-by-email sign-in (§1b).

### Claiming / promoting a provisional club → active
A provisional club becomes a normal, active Kinectem club when its admin joins Kinectem —
either via the in-registration **"Build your Kinectem club — 90 days free"** upsell (the
guest-to-club carryover, delta 57), or a later signup / first sign-in with the same email
(§1b). Reconcile by the club's `externalRef` and the admin email so the existing
provisional pages, rosters and any recaps are **claimed in place** (not duplicated): flip
`status` to `active`, attach the plan, start the free clock, and do **not** re-send
invites to coaches already invited.

---

## 1b. The email is the identity — returning registrant & claim-by-email sign-in

The enroller/admin email is the stable identity key **across sessions and into live
Kinectem**. Three behaviors ride on it.

**(a) Enroller info is saved for a returning registrant.** The flow persists the
enroller's name / email / club / phone. Same session: the "Register another team"
loop-back pre-fills it (delta 60). Later session (e.g. the next day): the returning
registrant is recognized by that email — they don't re-enter their info, and a signed-in
club just signs in.

**(b) New teams attach to the EXISTING club & pages — never a duplicate club.** When a
registrant comes back and registers more teams (guest or club), the new `team.upsert`
events must resolve to the **same `clubId`** created before — matched by `externalRef` /
admin email — and attach new team pages under that existing club. The new teams inherit
the club's current `status` (provisional if it's still an unclaimed guest club, active if
it's been claimed). Coach invites fire for the **new** teams only (existing teams are
idempotent, §1). Never create a second club for the same admin email.

**(c) First Kinectem sign-in with that email lands them on the pages they created.** When
the person creates their first live Kinectem account — or signs in — using the **same
email** they used at tournament signup, Kinectem matches by email and takes them **right
to their existing org + team pages** (not an empty state, not a fresh org). For a
provisional (guest) club this is the **claim** moment: promote in place (status → active,
attach plan, start the free clock now), preserve the rosters/recaps already there, and
don't re-invite coaches already invited. For an already-active club, sign-in simply
resolves to their club. This is why the admin email is the club's natural key in §2/§4 —
Kinectem must reconcile on it rather than minting a new org.

---

## 2. Events the tournament app must emit → Kinectem

All events are server-to-server, keyed by a stable `externalRef` so the tournament app
and Kinectem can reconcile without duplicating records. Use the org-creating email as
the club's natural key (see §4).

### `club.upsert`
Fires when a new club is created in-flow ("Build my club"), when a signed-in club
registers (no-op if it already exists), **and on guest checkout (provisional)**. A
returning registrant's `club.upsert` must resolve to the existing `clubId` by
`externalRef` / `adminEmail` — never a duplicate (§1b).
```
{
  "event": "club.upsert",
  "externalRef": "tourn:<tournamentId>:club:<slug>",
  "status": "active" | "provisional",   // provisional = guest checkout, not yet claimed/paying
  "club": {
    "name": "Roxbury SC",
    "adminName": "Andrew T",
    "adminEmail": "andrew@roxburysc.com",   // natural key — see §4; the identity for §1b
    "logoDataUrl": "<optional base64>",
    "createdVia": "tournament-registration",
    "tournamentId": "<id>",
    "plan": "<planId|null>",              // null for provisional (no plan started)
    "freeTrial": { "eligible": true, "endsOn": "2026-04-xx" }  // omit/ignore for provisional
  }
}
```
Kinectem returns the canonical `clubId` (creates the club + its public club page if new).
A provisional club is created but flagged unclaimed/limited until it joins.

### `team.upsert`
One per team added to the club roster (build-club grid rows) AND per team registered
into a tournament. Team pages are created here. Guest teams are created with
`status: "provisional"`. A returning registrant's new teams attach under the existing
`clubId` (§1b-b).
```
{
  "event": "team.upsert",
  "externalRef": "tourn:<tournamentId>:team:<slug>",
  "clubId": "<from club.upsert>",
  "status": "active" | "provisional",   // inherits the club's current status
  "team": {
    "name": "Roxbury 2015 Boys",
    "groupSuggestion": "U11 Boys",      // the app's suggestion; director sets real division
    "level": "", "league": "", "flight": "",
    "coachEmails": ["coach1@roxburysc.com"],  // 1+; drives invites
    "kinectem": true,                    // already a Kinectem team vs new
    "logoUrl": "",                       // club/team crest once Kinectem has one — the prototype shows
                                         // a monogram crest (club initials + deterministic color) as a
                                         // stand-in; pass the real club logo URL here so the Tournament
                                         // Director can show it next to the team on cards, the grid,
                                         // the public scoreboard, and printed game cards.
    "temp": false, "linkedTeamRef": null // temp/split teams roll up to linkedTeamRef
  }
}
```
Kinectem returns `teamId` and creates the team page if new. When Kinectem has a real club
logo, it should return `logoUrl` on the team/club so the director UI renders it in place
of the monogram crest everywhere a team is shown.

### `coach.invite`
Fires per coach email on a team, at the payment-chosen moment (§1) — **including guest
checkout**. Kinectem sends the email with a join link that lands the coach on THAT team's
page (provisional or active) to build the roster and post recaps.
```
{
  "event": "coach.invite",
  "idempotencyKey": "<clubId>:<teamId>:<coachEmailLower>",
  "clubId": "<id>", "teamId": "<id>",
  "coachEmail": "coach1@roxburysc.com",
  "context": { "tournamentName": "Full360 Spring Classic 2026", "invitedBy": "Roxbury SC", "provisional": true }
}
```

---

## 3. Where the registrant goes next (the login handoff)

After a **new-club** registrant finishes the tournament registration, the confirmation
page shows a primary CTA: **"Log in to Kinectem & finish setup"** →
`https://app.kinectem.com/login` (prefilled/expecting the signup email). **This CTA is
for the Build-my-club path only — a guest does not get it** (a guest hasn't created an
account; their re-entry is the coach invite link and the claim-by-email sign-in, §1b-c).

Requirements on the Kinectem side:
- The club + team pages created via §2 must already exist when the admin lands, so they
  arrive on their **new club page**, not an empty state.
- Login with the org-creating email must resolve to that club (§1b-c). If Kinectem
  supports a deep link, prefer landing directly on the club page
  (e.g. `https://app.kinectem.com/c/<clubId>?welcome=1`); until then, generic login is
  fine and the club is their default org.
- "Finish setup" there = add players to each roster, upload/confirm logo, invite any
  remaining coaches. Those are Kinectem-native actions, not duplicated in this app.

---

## 4. Free-trial / once-per-email enforcement (BACKEND-OWNED)

The 90-day free trial is **one per club, tied to the org-creating email**. The prototype
tracks this in the browser (`localStorage["kin_free_used"]`) — that is NOT authoritative.

Backend must enforce server-side:
- The free period follows the **email that created the org/club with a plan**. First time
  that email starts a plan → free. Any later re-signup with the same email (even after
  cancel + recreate) → **bill immediately, no free period**.
- **A provisional (guest) club does NOT consume the free trial** — no plan was started.
  The clock begins at plan start (claim / Build-my-club / first Kinectem sign-in, §1b-c),
  so a guest who later joins still gets their full first 90 days.
- This check happens at `club.upsert` with a plan / plan start. Return
  `freeTrial.eligible` so the UI shows the correct banner ("first 90 days free" vs "no
  free period this time").
- Do not let a client claim eligibility; the server decides.

---

## 5. Field mapping notes
- `status` = `provisional` for guest-created clubs/teams (live for the event, unclaimed),
  `active` for Build-my-club and signed-in clubs. Promotion to `active` happens on claim
  (§1a / §1b-c) — reconcile in place, never duplicate.
- `adminEmail` is the **identity key** (§1b): returning registrations and first Kinectem
  sign-in all reconcile to the same club by this email. Match case-insensitively.
- `logoUrl` on a team/club is the real crest; the Tournament Director falls back to a
  monogram (club initials + deterministic color) when it's empty.
- `groupSuggestion` / `level` are **suggestions only**; the tournament director sets the
  real division. Kinectem should store them as the team's self-reported level, not as a
  binding bracket.
- Temp/split teams (`temp: true`) represent one real team split for small-sided play.
  If `linkedTeamRef` is set, roll their games/recaps up to the linked team's page.
- Kinectem teams registering into a tournament already have `clubId`/`teamId`; emit
  `team.upsert` as a no-op reconcile and still fire `coach.invite` if a coach email was
  added during registration and that coach isn't already on the team.

---

## 6. Prototype parity checklist (what the live app must reproduce)
- [ ] Build-club grid = team name + coach email only (fast entry); group/level set later.
- [ ] Invites fire at payment-chosen, confirmation says "X coach(es) emailed an invite … not 90 days from now."
- [ ] **Guest checkout builds provisional club + team pages (status: provisional) and still fires coach invites;** confirmation tells the guest their pages are set up with a temporary tournament status (recaps live for the event; persistent storybook withheld until claimed).
- [ ] **Enroller info is saved; a returning registrant (same email) adds more teams that attach to the EXISTING Kinectem club + pages — no duplicate club.** (§1b-a/b)
- [ ] **First Kinectem sign-in with the same email lands the admin on the org + team pages created during tournament signup, claiming provisional pages in place.** (§1b-c)
- [ ] **Provisional guest club does not consume the once-per-email free trial; claiming/joining later promotes the pages in place and starts the free clock then.**
- [ ] New-club confirmation shows "Log in to Kinectem & finish setup" → app.kinectem.com/login (Build-my-club path only, not guest).
- [ ] $25 (outdoor) / $10 (indoor) processing fee waived for Kinectem clubs; charged to guests in lieu of a subscription.
- [ ] Once-per-email free trial enforced server-side.
- [ ] **Team/club `logoUrl` returned by Kinectem renders in the director UI (cards, grid, scoreboard, printed game cards); monogram crest is the fallback.**
- [ ] **Partial (saved-but-unpaid) registrations are captured and fed back to the director (see §7).**

---

## 7. Partial registrations (saved-but-unpaid) feed → director follow-up

The director wants to see people who **entered their contact info and at least one team
but never finished checking out**, so they can follow up and nudge them back in. In the
prototype this is a **Partial registrations** tab on the Teams page (seeded demo data).
The backend must make it real:

- **Capture a partial** when a registrant has supplied the enroller contact (name/email,
  optionally phone/club) and at least one team, but has **not** completed the Payment
  step. Persist it (don't rely on browser draft state) keyed by enroller email + event.
- **Record how far they got** (last step reached, e.g. "left on the coaches step",
  "never chose a payment method") and `startedAt` / `lastSeenAt` timestamps.
- **Feed it to the director** as a list per event: enroller name, email, phone, club, the
  team name(s) and suggested group, how long ago they started, last step. Suggested shape:
  ```
  registration.partial = {
    id, competitionId, enrollerName, enrollerEmail, enrollerPhone, club,
    teams: [{ name, groupSuggestion }], lastStep, startedAt, lastSeenAt,
    nudgedAt (nullable), resolved (bool)
  }
  ```
- **Director actions:** "Send reminder" (SendGrid email to the enroller with a resume
  link back into their half-finished registration; stamp `nudgedAt`), "Copy email", and
  "Dismiss" (`resolved = true`, hide from the list).
- **Auto-clear** a partial when that enroller completes checkout for those teams, or when
  the director registers them manually — it should drop off the list (becomes a real
  registration) rather than linger.
- Privacy: this is the director's own prospective registrants for their event; no
  cross-org exposure.
