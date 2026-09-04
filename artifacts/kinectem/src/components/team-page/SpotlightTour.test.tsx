import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  const onFinish = vi.fn();
  render(
    <>
      {visibleTargetIds.map((targetId) => (
        <button key={targetId} data-testid={targetId}>
          {targetId}
        </button>
      ))}
      <SpotlightTour steps={[step]} onFinish={onFinish} />
    </>,
  );

  const rectSpies = new Map<string, ReturnType<typeof vi.spyOn>>();
  visibleTargetIds.forEach((targetId, index) => {
    const spy = vi
      .spyOn(screen.getByTestId(targetId), "getBoundingClientRect")
      .mockReturnValue(rect(20 + index * 120, 80, 100, 32));
    rectSpies.set(targetId, spy);
  });

  return { rectSpies, onFinish };
}

function setLayoutViewport(width: number, height: number): () => void {
  const root = document.documentElement;
  const previousWidth = Object.getOwnPropertyDescriptor(root, "clientWidth");
  const previousHeight = Object.getOwnPropertyDescriptor(root, "clientHeight");
  Object.defineProperty(root, "clientWidth", {
    configurable: true,
    value: width,
  });
  Object.defineProperty(root, "clientHeight", {
    configurable: true,
    value: height,
  });

  return () => {
    if (previousWidth) {
      Object.defineProperty(root, "clientWidth", previousWidth);
    } else {
      delete (root as { clientWidth?: number }).clientWidth;
    }
    if (previousHeight) {
      Object.defineProperty(root, "clientHeight", previousHeight);
    } else {
      delete (root as { clientHeight?: number }).clientHeight;
    }
  };
}

describe("SpotlightTour", () => {
  it("dismisses when the backdrop is clicked but not when the tour card is clicked", () => {
    const { onFinish } = renderTour(
      {
        targetTestId: "btn-target",
        title: "Tour step",
        body: "Tour details",
      },
      ["btn-target"],
    );

    fireEvent.click(screen.getByTestId("team-tour-card"));
    expect(onFinish).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("tour-backdrop"));
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

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

  it("uses the scrollbar-excluding layout viewport so rings do not scale away from targets", async () => {
    const restoreViewport = setLayoutViewport(980, 700);
    try {
      renderTour(
        {
          targetTestId: "btn-target",
          title: "Aligned target",
          body: "The ring should use the same coordinate system as the target.",
        },
        ["btn-target"],
      );

      await waitFor(() => {
        expect(screen.getByTestId("tour-spotlight-ring")).toHaveAttribute(
          "x",
          "12",
        );
      });

      const svg = document.querySelector("svg");
      expect(svg).toHaveAttribute("viewBox", "0 0 980 700");
    } finally {
      restoreViewport();
    }
  });

  it("re-centers every ring after a scroll-driven target reflow", async () => {
    const { rectSpies } = renderTour(
      {
        targetTestId: "btn-primary",
        additionalTargetTestIds: ["btn-secondary"],
        title: "Grouped controls",
        body: "Both controls should stay aligned.",
      },
      ["btn-primary", "btn-secondary"],
    );

    await waitFor(() => {
      expect(screen.getAllByTestId("tour-spotlight-ring")[0]).toHaveAttribute(
        "x",
        "12",
      );
    });

    rectSpies.get("btn-primary")?.mockReturnValue(rect(220, 180, 100, 32));
    rectSpies.get("btn-secondary")?.mockReturnValue(rect(400, 260, 100, 32));
    fireEvent.scroll(window);

    await waitFor(() => {
      const [primaryRing, secondaryRing] = screen.getAllByTestId(
        "tour-spotlight-ring",
      );
      expect(primaryRing).toHaveAttribute("x", "212");
      expect(primaryRing).toHaveAttribute("y", "172");
      expect(secondaryRing).toHaveAttribute("x", "392");
      expect(secondaryRing).toHaveAttribute("y", "252");
    });
  });
});