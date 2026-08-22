import { describe, expect, it } from "vitest";
import {
  groupCoachInviteAssignments,
  stagedIdsForSuccessfulCoachInvite,
} from "./coach-invite-grouping";

describe("groupCoachInviteAssignments", () => {
  it("normalizes one coach email and keeps every distinct team assignment", () => {
    const groups = groupCoachInviteAssignments([
      { teamId: "a", teamName: "Falcons", email: " Coach@Example.com " },
      { teamId: "b", teamName: "Hawks", email: "coach@example.com" },
      { teamId: "a", teamName: "Falcons", email: "coach@example.com" },
      { teamId: "c", teamName: "Tigers", email: "other@example.com" },
    ]);

    expect(groups).toEqual([
      {
        email: "coach@example.com",
        assignments: [
          { teamId: "a", teamName: "Falcons", email: "coach@example.com" },
          { teamId: "b", teamName: "Hawks", email: "coach@example.com" },
        ],
      },
      {
        email: "other@example.com",
        assignments: [
          { teamId: "c", teamName: "Tigers", email: "other@example.com" },
        ],
      },
    ]);
  });

  it("returns only the staged draft ids belonging to a successful group", () => {
    expect(
      stagedIdsForSuccessfulCoachInvite([
        { teamId: "a", teamName: "Falcons", email: "coach@example.com", stagedId: "draft-a" },
        { teamId: "b", teamName: "Hawks", email: "coach@example.com", stagedId: "draft-b" },
        { teamId: "b", teamName: "Hawks", email: "coach@example.com", stagedId: "draft-b" },
        { teamId: "c", teamName: "Tigers", email: "coach@example.com" },
      ]),
    ).toEqual(["draft-a", "draft-b"]);
  });
});