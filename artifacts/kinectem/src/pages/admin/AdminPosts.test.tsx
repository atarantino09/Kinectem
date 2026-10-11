import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const hook = vi.fn();
vi.mock("@/hooks/useAdminPosts", async (orig) => ({
  ...(await orig<object>()),
  useAdminPosts: (f: unknown, p: number) => hook(f, p),
}));
vi.mock("@/components/AdminLayout", () => ({ AdminLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));

import AdminPosts from "./AdminPosts";

const base = {
  data: {
    data: [{ id: "article-1", sourceId: "1", type: "game_recap", title: "Win", excerpt: "x", createdAt: "2024-01-01T00:00:00Z", status: "published", hidden: false, sport: "Soccer", location: null, author: { id: "u1", name: "Ann" }, team: null, organization: { id: "o1", name: "Club" } }],
    pagination: { totalCount: 30, limit: 25, offset: 0, hasMore: true },
    facets: { sports: ["Soccer"], locations: [], organizations: [{ id: "o1", name: "Club" }], postTypes: [] },
  },
  isLoading: false, isError: false, refetch: vi.fn(), isFetching: false,
};

describe("AdminPosts", () => {
  beforeEach(() => hook.mockReset().mockReturnValue(base));
  it("renders links", () => {
    render(<AdminPosts />);
    expect(screen.getByText("Ann").getAttribute("href")).toContain("/users/u1");
    expect(screen.getByRole("link", { name: "Club" }).getAttribute("href")).toContain("/organizations/o1");
    expect(screen.getByText("View post").getAttribute("href")).toContain("/posts/article-1");
  });
  it("resets page on filter change", () => {
    render(<AdminPosts />);
    fireEvent.click(screen.getByTestId("btn-posts-next"));
    expect(hook).toHaveBeenLastCalledWith(expect.anything(), 1);
    fireEvent.change(screen.getByTestId("select-post-sport"), { target: { value: "Soccer" } });
    expect(hook).toHaveBeenLastCalledWith(expect.objectContaining({ sport: "Soccer" }), 0);
  });
  it("clears sorting as well as filters and returns to the first page", () => {
    render(<AdminPosts />);
    const clear = screen.getByTestId("btn-reset-post-filters");
    expect(clear).toBeDisabled();
    fireEvent.change(screen.getByTestId("select-post-sort"), { target: { value: "oldest" } });
    expect(clear).toBeEnabled();
    fireEvent.change(screen.getByTestId("select-post-sport"), { target: { value: "Soccer" } });
    fireEvent.click(screen.getByTestId("btn-posts-next"));
    fireEvent.click(clear);
    expect(hook).toHaveBeenLastCalledWith(expect.objectContaining({
      sort: "newest", sport: undefined, location: undefined,
      organizationId: undefined, postType: undefined, q: undefined,
    }), 0);
    expect(screen.getByTestId("select-post-sort")).toHaveValue("newest");
    expect(clear).toBeDisabled();
  });
  it("shows error and empty", () => {
    hook.mockReturnValue({ ...base, data: undefined, isError: true });
    const { unmount } = render(<AdminPosts />);
    fireEvent.click(screen.getByTestId("btn-retry-posts"));
    expect(base.refetch).toHaveBeenCalled();
    unmount();
    hook.mockReturnValue({ ...base, data: { ...base.data, data: [] } });
    render(<AdminPosts />);
    expect(screen.getByTestId("posts-empty")).toBeTruthy();
  });
});
