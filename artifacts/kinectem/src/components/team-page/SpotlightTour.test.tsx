import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SpotlightTour, type TourStep } from "./SpotlightTour";

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    toJSON: () => ({}),
  } as DOMRect;
}

function renderTour(step: TourStep, visibleTargetIds: string[]) {
  render(
    <>
      {visibleTargetIds.map((targetId) => (
        <button key={targetId} data-testid={targetId}>
          {targetId}
        </button>
      ))}
      <SpotlightTour steps={[step]} onFinish={vi.fn()} />
    </>,
  );

  visibleTargetIds.forEach((targetId, index) => {
    vi.spyOn(screen.getByTestId(targetId), "getBoundingClientRect").mockReturnValue(
      rect(20 + index * 120, 80, 100, 32),
    );
  });
}

describe("SpotlightTour", () => {
  it("renders a separate undimmed spotlight ring for every visible control in a grouped step", async () => {
    renderTour(
      {
        targetTestId: "btn-toggle-roster",
        additionalTargetTestIds: ["btn-invite-roster"],
        title: "Build your roster",
        body: "Open Roster, then select Invite.",
      },
      ["btn-toggle-roster", "btn-invite-roster"],
    );

    await waitFor(() => {
      expect(screen.getAllByTestId("tour-spotlight-ring")).toHaveLength(2);
    });

    const [rosterRing, inviteRing] = screen.getAllByTestId("tour-spotlight-ring");
    expect(rosterRing).toHaveAttribute("x", "12");
    expect(inviteRing).toHaveAttribute("x", "132");
  });

  it("keeps its primary spotlight when a companion control is not mounted", async () => {
    renderTour(
      {
        targetTestId: "btn-toggle-roster",
        additionalTargetTestIds: ["btn-invite-roster"],
        title: "Build your roster",
        body: "Open Roster, then select Invite.",
      },
      ["btn-toggle-roster"],
    );

    await waitFor(() => {
      expect(screen.getAllByTestId("tour-spotlight-ring")).toHaveLength(1);
    });
    expect(screen.getByText("Build your roster")).toBeInTheDocument();
  });
});