import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { buildTeamTourSteps } from "./teamTourSteps";

function buildSteps(overrides: Partial<Parameters<typeof buildTeamTourSteps>[0]> = {}) {
  return buildTeamTourSteps({
    isAdmin: true,
    canManage: true,
    canViewSchedule: true,
    canPostHighlight: true,
    canPostRecap: true,
    onExpand: vi.fn(),
    ...overrides,
  });
}

function bodyText(title: string, steps = buildSteps()): string {
  const step = steps.find((candidate) => candidate.title === title);
  if (!step) throw new Error(`Missing tour step: ${title}`);
  return render(<>{step.body}</>).container.textContent ?? "";
}

describe("buildTeamTourSteps", () => {
  it("explains all full-manager menu actions in one Other post options step", () => {
    const steps = buildSteps();
    const titles = steps.map((step) => step.title);
    const menuStep = steps.find((step) => step.title === "Other post options");
    const copy = bodyText("Other post options", steps);

    expect(titles.filter((title) => title === "Other post options")).toHaveLength(1);
    expect(titles).not.toContain("Post highlights");
    expect(titles).not.toContain("Combined recaps");
    expect(menuStep).toMatchObject({
      targetTestId: "btn-toggle-posts",
      additionalTargetTestIds: ["btn-open-post-options"],
    });
    expect(copy).toContain("Post Highlight");
    expect(copy).toContain("Combined Recap");
    expect(copy).toContain("Add News Article");
    expect((copy.match(/Post Highlight/g) ?? [])).toHaveLength(1);
    expect((copy.match(/Combined Recap/g) ?? [])).toHaveLength(1);
    expect((copy.match(/Add News Article/g) ?? [])).toHaveLength(1);
  });

  it("only names menu actions the current viewer can access", () => {
    const authorSteps = buildSteps({ isAdmin: false, canManage: false });
    const authorCopy = bodyText("Other post options", authorSteps);

    expect(authorCopy).toContain("Post Highlight");
    expect(authorCopy).toContain("Combined Recap");
    expect(authorCopy).not.toContain("Add News Article");

    const managerWithoutRecaps = buildSteps({
      isAdmin: false,
      canPostRecap: false,
    });
    const managerCopy = bodyText("Other post options", managerWithoutRecaps);
    const managerTitles = managerWithoutRecaps.map((step) => step.title);

    expect(managerCopy).toContain("Add News Article");
    expect(managerCopy).not.toContain("Post Highlight");
    expect(managerCopy).not.toContain("Combined Recap");
    expect(managerTitles).toContain("Post highlights");
  });
});