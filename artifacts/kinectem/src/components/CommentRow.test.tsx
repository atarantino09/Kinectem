import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CommentResponse } from "@workspace/api-client-react";

vi.mock("@/components/ReportDialog", () => ({
  ReportDialog: () => null,
}));

import { CommentRow } from "./PostInteractions";

function makeComment(body: string): CommentResponse {
  return {
    id: "comment-1",
    postId: "post-1",
    body,
    author: {
      id: "user-1",
      displayName: "Alex",
      avatarUrl: null,
    } as CommentResponse["author"],
    reactionCount: 0,
    hasReacted: false,
    recentReactorName: null,
    createdAt: new Date().toISOString(),
  };
}

describe("CommentRow", () => {
  it("renders pasted URLs in the body as clickable anchors", () => {
    render(
      <CommentRow
        comment={makeComment("check this https://example.com/foo great")}
        canDelete={false}
        onDelete={() => {}}
      />,
    );
    const link = screen.getByRole("link", { name: "https://example.com/foo" });
    expect(link).toBeInstanceOf(HTMLAnchorElement);
    expect(link.getAttribute("href")).toBe("https://example.com/foo");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("does not bubble link clicks up to a surrounding clickable container", async () => {
    const parentClick = vi.fn();
    render(
      <div onClick={parentClick} data-testid="parent">
        <CommentRow
          comment={makeComment("see https://example.com")}
          canDelete={false}
          onDelete={() => {}}
        />
      </div>,
    );
    const link = screen.getByRole("link", { name: "https://example.com" });
    const user = userEvent.setup();
    await user.click(link);
    expect(parentClick).not.toHaveBeenCalled();
  });

  it("requires confirmation before deleting a server-authorized comment", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    render(
      <CommentRow
        comment={makeComment("Please remove this")}
        canDelete
        onDelete={onDelete}
      />,
    );

    await user.click(screen.getByTestId("button-delete-comment-comment-1"));
    expect(screen.getByTestId("dialog-delete-comment-comment-1")).toBeInTheDocument();
    expect(onDelete).not.toHaveBeenCalled();

    await user.click(
      screen.getByTestId("button-confirm-delete-comment-comment-1"),
    );
    expect(onDelete).toHaveBeenCalledOnce();
  });
});
