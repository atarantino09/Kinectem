# Tournament Director — build handoff for Kinectem (Replit)

This folder is the complete handoff package for building the **Tournament Director** as a module inside the existing Kinectem app on Replit. It was produced from the clickable prototype (Version 165).

## What's here

- **`prototype/tournament-director-app.html`** — the single-file React prototype. The clickable blueprint for every screen and interaction. Open it in a browser. (Live version: https://claude.ai/artifact/FBwtiXVkh2RETJ1BHjSpKr)
- **`docs/replit-kinectem-handoff.md`** — **START HERE.** The build spec: how it plugs into Kinectem, the data model, every screen, the design system, build phases, and a "Replit kickoff" section.
- **`docs/tournament-director-status.md`** — the living, authoritative record of exactly what the prototype does (behavior checklist to build + QA against). Carries the numbered "Spec deltas" (1–70). Where it and the handoff differ, this doc wins.
- **`docs/scheduler-engine.md`** — the deepest reference for the scheduler (capacity math, hard rules, strategies, travel model, Friday overflow, impossible-matchup detection).
- **`docs/kinectem-integration-contract.md`** — the backend contract for registration ↔ Kinectem: the `club.upsert` / `team.upsert` / `coach.invite` events, provisional (guest) pages, email-as-identity, the free-trial rule, the partial-registration feed, and the club `logoUrl`.

## How to get it going on Replit — the short version

1. **Read `docs/replit-kinectem-handoff.md` top to bottom**, then its **"Replit kickoff — first steps"** section.
2. **Open the prototype** (`prototype/tournament-director-app.html`) beside the spec — it's the reference for every screen.
3. **Build it as a module in the existing Kinectem Replit app** (not a new project): reuse the Competitions entity, auth, Postgres, SendGrid, Claude API, and the design system.
4. Work the phases in the handoff: **Phase 1** (import + schedule + public site for a real fall event), **Phase 2** (full registration + payments + the Kinectem page/invite contract), **Phase 3** (deeper Kinectem tie-in + the in-app assistant on the real backend).
5. Keep `docs/tournament-director-status.md` open as the QA checklist, and resolve the "Open items for Replit" list early (schema reuse, scheduler job placement, admin permission levels, club `logoUrl`, priority presets).

The docs are also kept current in the shared claude.ai Project "Tournament Schedule Tool" — if these files drift, the Project is the source of truth.
