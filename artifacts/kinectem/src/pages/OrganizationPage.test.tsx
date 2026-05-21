import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { screen, waitFor } from "@testing-library/react";

import { renderWithProviders } from "@/test";
import { wouterMock } from "@/test/mocks/wouter";
import { useToastMock } from "@/test/mocks/toast";

// ---------------------------------------------------------------------------
// Module mocks. Hoisted by vitest, so safe to reference the imports above.
// `useParams` is overridden so the page reads a stable `orgId` regardless of
// what the wouter mock returns by default.
// ---------------------------------------------------------------------------

const ORG_ID = "org-1";
const ME_ID = "user-me";

vi.mock("wouter", () => ({
  ...wouterMock,
  useParams: () => ({ orgId: ORG_ID }),
}));
vi.mock("@/hooks/use-toast", () => useToastMock);
vi.mock("@/hooks/use-mobile", () => ({
  useIsLg: () => true,
}));
// The lightbox + sub-dialogs are irrelevant to the CTA assertion; stubbing
// them out keeps the test focused on the affordance Task #538 added.
vi.mock("@/components/AvatarLightbox", () => ({
  AvatarLightbox: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/CreateTeamDialog", () => ({
  CreateTeamDialog: () => null,
}));
vi.mock("@/components/EditOrgDialog", () => ({
  EditOrgDialog: () => null,
}));
vi.mock("@/components/FollowListDialog", () => ({
  FollowListDialog: () => null,
}));
vi.mock("@/components/NewOrgPostDialog", () => ({
  NewOrgPostDialog: () => null,
}));
vi.mock("@/components/ManageMembersDialog", () => ({
  ManageMembersDialog: () => null,
}));

const useGetLoggedInUserMock = vi.fn();

// The generated hooks import `customFetch` directly from the source file, so
// re-exporting our own copy from `@workspace/api-client-react` would be
// ignored. Patching the underlying `customFetch` module is the only path
// that intercepts every generated query.
vi.mock("@workspace/api-client-react", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@workspace/api-client-react")
  >();
  return {
    ...actual,
    useGetLoggedInUser: (...args: unknown[]) =>
      useGetLoggedInUserMock(...args),
  };
});

// Now safe to import the component under test.
import OrganizationPage from "./OrganizationPage";

// ---------------------------------------------------------------------------
// Fixture data + routing.
// ---------------------------------------------------------------------------

function baseOrg(role: "owner" | "admin" | "member" | null) {
  return {
    id: ORG_ID,
    name: "Westfield Athletic Club",
    slug: "westfield",
    logoUrl: null,
    description: null,
    website: null,
    city: null,
    state: null,
    zipCode: null,
    role,
    isFollowing: false,
    followerCount: 0,
  };
}

const emptyPage = {
  data: [],
  pagination: { nextCursor: null, hasMore: false, totalCount: 0 },
};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function installFetchMock(role: "owner" | "admin" | "member" | null) {
  // Route on the URL pathname (ignoring querystring) so paginated endpoints
  // with `?cursor=…` still match. Anything unrecognised returns a 404 so a
  // forgotten handler surfaces loudly instead of hanging the test.
  const handlers: Record<string, () => unknown> = {
    [`/api/v1/organizations/${ORG_ID}`]: () => baseOrg(role),
    [`/api/v1/organizations/${ORG_ID}/teams`]: () => emptyPage,
    [`/api/v1/organizations/${ORG_ID}/teams/archived`]: () => emptyPage,
    [`/api/v1/organizations/${ORG_ID}/posts`]: () => emptyPage,
    [`/api/v1/organizations/${ORG_ID}/members`]: () => ({
      data: [
        {
          userId: ME_ID,
          displayName: "Sam Owner",
          avatarUrl: null,
          role: role ?? "member",
        },
      ],
      pagination: { nextCursor: null, hasMore: false, totalCount: 1 },
    }),
    [`/api/v1/organizations/${ORG_ID}/join-requests`]: () => emptyPage,
    [`/api/v1/organizations/${ORG_ID}/post-approvals`]: () => emptyPage,
  };

  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const raw = typeof input === "string" ? input : (input as Request).url;
    const path = raw.split("?")[0];
    const handler = handlers[path];
    if (!handler) {
      return new Response(JSON.stringify({ error: "Unhandled in test", path }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    }
    return jsonResponse(handler());
  });

  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  useGetLoggedInUserMock.mockReturnValue({
    data: { id: ME_ID, role: "coach" },
    isLoading: false,
  });
});

describe("OrganizationPage — Manage admins & members CTA (Task #538)", () => {
  it("renders the top-level CTA when the viewer is the owner", async () => {
    installFetchMock("owner");
    renderWithProviders(<OrganizationPage />);

    const cta = await screen.findByTestId("btn-manage-admins-hero");
    expect(cta).toBeInTheDocument();
    expect(cta).toHaveTextContent(/Manage admins & members/i);
  });

  it("hides the top-level CTA for non-managers (member)", async () => {
    installFetchMock("member");
    renderWithProviders(<OrganizationPage />);

    await screen.findByRole("heading", { name: /Westfield Athletic Club/i });
    await waitFor(() => {
      expect(
        screen.queryByTestId("btn-manage-admins-hero"),
      ).not.toBeInTheDocument();
    });
    expect(screen.queryByTestId("btn-manage-members")).not.toBeInTheDocument();
  });

  it("hides the top-level CTA for non-members (no role)", async () => {
    installFetchMock(null);
    renderWithProviders(<OrganizationPage />);

    await screen.findByRole("heading", { name: /Westfield Athletic Club/i });
    await waitFor(() => {
      expect(
        screen.queryByTestId("btn-manage-admins-hero"),
      ).not.toBeInTheDocument();
    });
  });
});
