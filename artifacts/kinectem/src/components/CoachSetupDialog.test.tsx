import { describe, it, expect } from "vitest";
import { canReopenCoachSetup } from "./CoachSetupDialog";

// Task #836 regression — staged coach drafts must stay side-effect-free
// until the POST-CLAIM owner confirms them. The re-entry point into the
// invite-sending CoachSetupDialog must therefore never be offered on an
// unclaimed org, even to platform admins (who pass the manager check via
// the admin bypass and are the ones staging the drafts pre-handoff).
describe("canReopenCoachSetup", () => {
  const base = {
    isOrgManager: true,
    isUnclaimed: false,
    stagedCount: 2,
    teamsCount: 3,
  };

  it("offers re-entry to a post-claim manager with staged coaches and teams", () => {
    expect(canReopenCoachSetup(base)).toBe(true);
  });

  it("never offers re-entry on an unclaimed org (platform-admin view)", () => {
    expect(canReopenCoachSetup({ ...base, isUnclaimed: true })).toBe(false);
  });

  it("hides re-entry for non-managers", () => {
    expect(canReopenCoachSetup({ ...base, isOrgManager: false })).toBe(false);
  });

  it("hides re-entry when nothing is staged or the org has no teams", () => {
    expect(canReopenCoachSetup({ ...base, stagedCount: 0 })).toBe(false);
    expect(canReopenCoachSetup({ ...base, teamsCount: 0 })).toBe(false);
  });
});
