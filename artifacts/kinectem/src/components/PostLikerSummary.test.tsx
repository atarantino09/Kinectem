import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { likerPost } from "../../e2e/fixtures/post-liker";

vi.mock("@workspace/api-client-react", async (importOriginal) => ({
  ...await importOriginal<typeof import("@workspace/api-client-react")>(),
  useAddPostReaction: () => ({ mutate: vi.fn() }),
  useRemovePostReaction: () => ({ mutate: vi.fn() }),
  useSharePost: () => ({ mutate: vi.fn() }),
  useUnsharePost: () => ({ mutate: vi.fn() }),
  useGetLoggedInUser: () => ({ data: null }),
  useListPostComments: () => ({ data: { data: [] } }),
  useCreatePostComment: () => ({ mutate: vi.fn() }),
  useDeletePostComment: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("@/components/share-image/ShareRecapImageDialog", () => ({
  ShareRecapImageDialog: () => null,
}));

import { PostCard } from "./PostCard";
import { PostInteractions } from "./PostInteractions";

for (const detail of [false, true]) {
  describe(detail ? "Detail liker summary" : "Card liker summary", () => {
    const actionsId = detail ? "post-detail-actions" : "post-actions-article-layout";
    const summaryId = detail ? "post-detail-liker-summary" : "post-liker-summary-article-layout";
    function renderPost(name: string | null, count: number) {
      const post = likerPost({ recentReactorName: name, reactionCount: count });
      return render(
        <QueryClientProvider client={new QueryClient()}>
          {detail ? <PostInteractions post={post} /> : <PostCard post={post} />}
        </QueryClientProvider>,
      );
    }

    it.each([
      ["Alex", 1],
      ["Alex", 4],
      ["VeryLongUnbrokenName".repeat(30), 4],
    ])("keeps %s with %i likes below the complete buttons-only row", (name, count) => {
      renderPost(name, count);
      const actions = screen.getByTestId(actionsId);
      const summary = screen.getByTestId(summaryId);
      expect(actions).toHaveClass("flex", "flex-wrap");
      expect(actions).not.toContainElement(summary);
      expect(actions.nextElementSibling).toBe(summary);
      expect(summary).toHaveClass("text-xs", "text-muted-foreground", "[overflow-wrap:anywhere]");
      expect(summary).not.toHaveClass("ml-1", "ml-2");
      expect(summary.textContent).toBe(
        detail
          ? `${name}${count > 1 ? ` and ${count - 1} others reacted` : " reacted"}`
          : `${name}${count > 1 ? ` +${count - 1}` : ""}`,
      );
      if (!detail) {
        expect(actions).toContainElement(screen.getByTestId("button-album-article-layout"));
        expect(actions).toContainElement(screen.getByTestId("btn-share-image-article-layout"));
      }
    });

    it.each([[null, 4], ["", 4], ["   ", 4], ["Alex", 0]] as const)(
      "leaves no summary row with name %s and count %i",
      (name, count) => {
        renderPost(name, count);
        expect(screen.queryByTestId(summaryId)).not.toBeInTheDocument();
        expect(screen.getByTestId(actionsId).nextElementSibling).toBeNull();
      },
    );
  });
}
