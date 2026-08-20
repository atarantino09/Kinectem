import { render, screen } from "@testing-library/react";
import type { PostResponse } from "@workspace/api-client-react";
import { describe, expect, it } from "vitest";
import { ShareRecapCanvas } from "./ShareRecapCanvas";

function makePost(orgAvatarUrl: string | null): PostResponse {
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
});