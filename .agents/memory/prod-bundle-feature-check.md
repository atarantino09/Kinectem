---
name: Verifying a feature exists in the published frontend
description: How to check whether prod is serving a stale bundle without admin credentials
---

When a UI feature "doesn't show in prod", verify statically before touching code:

1. `getDeploymentInfo()` → prod URL.
2. `curl <prod>/app/` → grab the hashed `index-*.js` asset; grep it for the lazy-chunk names (e.g. `AdminOrgQuickSetup-*.js`), then fetch those chunks and grep for feature strings/testids.
3. Probe the API route unauthenticated: 401 = route exists behind auth; 404 = missing from the deployed server.
4. Check prod schema via `executeSql({ environment: "production" })` — presence of the *newest* registered startup migration's column proves the current build ran its migrations in prod.

**Why:** a stale published build is the usual cause; this proves/disproves it in minutes with no prod admin login and no test data created.

**Gotcha:** claim-link outreach columns are `outreach_messaged_at` / `outreach_facebook_added_at` (not `messaged_at`) — querying wrong names makes prod look missing columns it has.
