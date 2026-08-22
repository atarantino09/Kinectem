import { render, screen } from "@testing-library/react";
import type { PostResponse } from "@workspace/api-client-react";
import { describe, expect, it } from "vitest";
import { ShareRecapCanvas } from "./ShareRecapCanvas";

function makePost(
  orgAvatarUrl: string | null,
  extras: Record<string, unknown> = {},
): PostResponse {
  return {
    id: "post-1",
    title: "Cup final",
    body: "A memorable game recap.",
    gameDate: "2026-08-01",
    author: {
      displayName: "Coach Dutton",
      authorRole: "Coach",
    },
    context: {
      type: "team",
      name: "NJ Nationals 2012/13 Boys NAL",
      orgName: "NJ National FC",
      orgAvatarUrl,
    },
    ...extras,
  } as unknown as PostResponse;
}

describe("ShareRecapCanvas organization badge", () => {
  it("shows the organization logo before the organization name", () => {
    render(
      <ShareRecapCanvas
        post={makePost("data:image/png;base64,organization-logo")}
        ctaMode="bio"
        recapUrl="https://example.com/app/posts/post-1"
      />,
    );

    const logo = screen.getByTestId("share-image-org-logo");
    const orgName = screen.getByText("NJ NATIONAL FC");

    expect(logo).toHaveAttribute(
      "src",
      "data:image/png;base64,organization-logo",
    );
    expect(logo.parentElement).toBe(orgName.parentElement);
  });

  it("keeps the organization name when no logo is available", () => {
    render(
      <ShareRecapCanvas
        post={makePost(null)}
        ctaMode="bio"
        recapUrl="https://example.com/app/posts/post-1"
      />,
    );

    expect(screen.getByText("NJ NATIONAL FC")).toBeInTheDocument();
    expect(screen.queryByTestId("share-image-org-logo")).not.toBeInTheDocument();
  });

  it("adds competition identity and a continuous competition frame", () => {
    render(
      <ShareRecapCanvas
        post={makePost("data:image/png;base64,organization-logo", {
          competition: {
            name: "Greystone Cup",
            logoUrl: "data:image/png;base64,competition-logo",
            brandColor: "#7E22CE",
            secondaryColor: "#2563EB",
          },
        })}
        ctaMode="bio"
        recapUrl="https://example.com/app/posts/post-1"
      />,
    );

    expect(screen.getByText("Greystone Cup")).toBeInTheDocument();
    expect(screen.getByTestId("share-image-competition-logo")).toHaveAttribute(
      "src",
      "data:image/png;base64,competition-logo",
    );
    const frame = screen.getByTestId("share-image-competition-frame");
    expect(frame.children).toHaveLength(4);
    expect(frame.children[0]).toHaveStyle({
      background: "linear-gradient(135deg, #7E22CE 0%, #2563EB 100%)",
    });
    expect(frame.children[1]).toHaveStyle({ background: "#2563EB" });
    expect(frame.children[3]).toHaveStyle({ background: "#7E22CE" });
  });

  it("keeps the refreshed partnership chrome on the approved 135 degree ramp", () => {
    render(
      <ShareRecapCanvas
        post={makePost(null)}
        ctaMode="bio"
        recapUrl="https://example.com/app/posts/post-1"
      />,
    );

    expect(screen.getByTestId("share-image-kinectem-logo")).toHaveAttribute(
      "src",
      expect.stringContaining("logo-horizontal-dark.png"),
    );
    expect(screen.getByTestId("share-image-game-recap-badge")).toHaveStyle({
      background:
        "linear-gradient(rgba(20,8,44,0.62), rgba(20,8,44,0.62)) padding-box, linear-gradient(135deg, #C084FC 0%, #7C3AED 48%, #2563EB 100%) border-box",
    });
    expect(screen.getByTestId("share-image-cta")).toHaveStyle({
      background:
        "linear-gradient(135deg,#7E22CE 0%,#6A2BF8 45%,#4A34F5 68%,#2563EB 100%)",
    });
  });
});