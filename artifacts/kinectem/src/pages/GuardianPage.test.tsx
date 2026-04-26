import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { createMockApi, renderWithProviders } from "@/test";
import { setMockSearch, wouterMock } from "@/test/mocks/wouter";
import { useToastMock } from "@/test/mocks/toast";

// ---------------------------------------------------------------------------
// Module mocks. vi.mock() is hoisted, but its factory runs lazily, so it can
// safely reference the imports above.
// ---------------------------------------------------------------------------

vi.mock("wouter", () => wouterMock);
vi.mock("@/hooks/use-toast", () => useToastMock);
vi.mock("@/components/EditProfileDialog", () => ({
  EditProfileDialog: () => null,
}));

const api = createMockApi();
const useGetLoggedInUserMock = vi.fn();

vi.mock("@workspace/api-client-react", () => ({
  customFetch: (...args: unknown[]) =>
    api.fetch(...(args as [string, RequestInit?])),
  useGetLoggedInUser: (...args: unknown[]) => useGetLoggedInUserMock(...args),
}));

// Now safe to import the component under test.
import GuardianPage from "./GuardianPage";

// ---------------------------------------------------------------------------
// Fixture data — shaped exactly like the responses GuardianPage consumes.
// ---------------------------------------------------------------------------

const PARENT_ID = "parent-1";
const CHILD_ID = "child-1";
const ENTRY_ID = "entry-1";
const TEAM_ID = "team-1";
const OTHER_ENTRY_ID = "entry-2";

const childrenFixture = [
  {
    id: CHILD_ID,
    firstName: "Samira",
    lastName: "Khan",
    nickname: null,
    role: "athlete",
    email: "samira@example.com",
    avatarUrl: null,
    requireTagConsent: false,
    guardianEmail: null,
    guardianConfirmedAt: null,
    confirmationStatus: "none" as const,
    confirmedByMe: false,
  },
];

const pendingFixture = {
  data: [
    {
      entryId: ENTRY_ID,
      teamId: TEAM_ID,
      teamName: "Varsity Football",
      teamLogoUrl: null,
      organization: { id: "org-1", name: "Westfield Athletic Club" },
      role: "athlete",
      position: "player",
      invitedAt: new Date().toISOString(),
      invitedBy: { id: "coach-1", displayName: "Coach Diaz", avatarUrl: null },
    },
    {
      entryId: OTHER_ENTRY_ID,
      teamId: "team-2",
      teamName: "JV Soccer",
      teamLogoUrl: null,
      organization: { id: "org-1", name: "Westfield Athletic Club" },
      role: "athlete",
      position: "player",
      invitedAt: new Date().toISOString(),
      invitedBy: null,
    },
  ],
};

function installDefaultHandlers() {
  api.reset();
  api.setHandlers({
    "GET /api/v1/users/me/children": () => ({
      data: structuredClone(childrenFixture),
    }),
    [`GET /api/v1/users/me/children/${CHILD_ID}/pending-team-invites`]: () =>
      structuredClone(pendingFixture),
    "GET /api/v1/notifications/email-preference": { emailOptOut: false },
    [`POST /api/v1/teams/${TEAM_ID}/members/${ENTRY_ID}/accept`]: { ok: true },
    [`POST /api/v1/teams/${TEAM_ID}/members/${ENTRY_ID}/decline`]: { ok: true },
  });
}

let scrollIntoViewSpy: MockInstance;

beforeEach(() => {
  scrollIntoViewSpy = vi
    .spyOn(Element.prototype, "scrollIntoView")
    .mockImplementation(() => {});
  useGetLoggedInUserMock.mockReturnValue({
    data: { id: PARENT_ID, role: "parent" },
    isLoading: false,
  });
  installDefaultHandlers();
});

afterEach(() => {
  scrollIntoViewSpy.mockRestore();
  setMockSearch("");
});

describe("GuardianPage — parent invite deep-link", () => {
  it("renders pending-invite rows and highlights the row matching the deep-link query", async () => {
    setMockSearch(`childId=${CHILD_ID}&entryId=${ENTRY_ID}&teamId=${TEAM_ID}`);

    renderWithProviders(<GuardianPage />);

    // Pending section appears once the children + invites resolve.
    const pendingSection = await screen.findByTestId(
      `section-pending-invites-${CHILD_ID}`,
    );
    const matchingRow = within(pendingSection).getByTestId(
      `row-pending-invite-${ENTRY_ID}`,
    );
    const otherRow = within(pendingSection).getByTestId(
      `row-pending-invite-${OTHER_ENTRY_ID}`,
    );

    // The deep-link effect schedules a setTimeout(120ms) before applying the
    // ring classes, so wait for the highlight to land on the matching row.
    await waitFor(() => {
      expect(matchingRow.className).toMatch(/ring-2/);
      expect(matchingRow.className).toMatch(/ring-primary/);
    });
    expect(otherRow.className).not.toMatch(/ring-2/);

    // Both action buttons render on the targeted row.
    expect(
      within(matchingRow).getByTestId(`btn-accept-pending-${ENTRY_ID}`),
    ).toBeInTheDocument();
    expect(
      within(matchingRow).getByTestId(`btn-decline-pending-${ENTRY_ID}`),
    ).toBeInTheDocument();

    // The deep-link effect should have asked the matching child card to
    // scroll into view.
    expect(scrollIntoViewSpy).toHaveBeenCalled();
  });

  it("removes the pending-invite row after Accept is clicked", async () => {
    setMockSearch(`childId=${CHILD_ID}&entryId=${ENTRY_ID}&teamId=${TEAM_ID}`);

    const user = userEvent.setup();
    renderWithProviders(<GuardianPage />);

    const acceptBtn = await screen.findByTestId(
      `btn-accept-pending-${ENTRY_ID}`,
    );
    await user.click(acceptBtn);

    // The accept call should have been dispatched.
    await waitFor(() => {
      expect(api.fetch).toHaveBeenCalledWith(
        `/api/v1/teams/${TEAM_ID}/members/${ENTRY_ID}/accept`,
        expect.objectContaining({ method: "POST" }),
      );
    });

    // The accepted row drops out of the DOM, but the other pending row stays.
    await waitFor(() => {
      expect(
        screen.queryByTestId(`row-pending-invite-${ENTRY_ID}`),
      ).not.toBeInTheDocument();
    });
    expect(
      screen.getByTestId(`row-pending-invite-${OTHER_ENTRY_ID}`),
    ).toBeInTheDocument();
  });

  it("keeps the row and re-enables Accept when the API call fails", async () => {
    setMockSearch(`childId=${CHILD_ID}&entryId=${ENTRY_ID}&teamId=${TEAM_ID}`);

    // Override the accept handler for this test so it rejects, mimicking a
    // server-side failure. Every other endpoint keeps its happy-path mock.
    const acceptUrl = `/api/v1/teams/${TEAM_ID}/members/${ENTRY_ID}/accept`;
    customFetchMock.mockImplementation(
      async (url: string, init?: RequestInit) => {
        const method = (init?.method ?? "GET").toUpperCase();
        if (url === "/api/v1/users/me/children" && method === "GET") {
          return { data: structuredClone(childrenFixture) };
        }
        if (
          url ===
            `/api/v1/users/me/children/${CHILD_ID}/pending-team-invites` &&
          method === "GET"
        ) {
          return structuredClone(pendingFixture);
        }
        if (
          url === "/api/v1/notifications/email-preference" &&
          method === "GET"
        ) {
          return { emailOptOut: false };
        }
        if (url === acceptUrl && method === "POST") {
          throw new Error("server exploded");
        }
        throw new Error(`Unexpected fetch in test: ${method} ${url}`);
      },
    );

    const user = userEvent.setup();
    renderPage();

    const acceptBtn = await screen.findByTestId(
      `btn-accept-pending-${ENTRY_ID}`,
    );
    await user.click(acceptBtn);

    // The accept call should have been dispatched even though it will reject.
    await waitFor(() => {
      expect(customFetchMock).toHaveBeenCalledWith(
        acceptUrl,
        expect.objectContaining({ method: "POST" }),
      );
    });

    // After the rejection settles, the optimistic removal must NOT have
    // happened — the row is still in the DOM and the button is interactive
    // again (i.e. actingOnEntryId was cleared in the finally block).
    await waitFor(() => {
      const stillThereBtn = screen.getByTestId(
        `btn-accept-pending-${ENTRY_ID}`,
      );
      expect(stillThereBtn).toBeEnabled();
      expect(stillThereBtn).toHaveTextContent(/^Accept$/);
    });
    expect(
      screen.getByTestId(`row-pending-invite-${ENTRY_ID}`),
    ).toBeInTheDocument();
    // The other row also remains untouched.
    expect(
      screen.getByTestId(`row-pending-invite-${OTHER_ENTRY_ID}`),
    ).toBeInTheDocument();
  });

  it("waits for a slow Accept call before removing the row", async () => {
    setMockSearch(`childId=${CHILD_ID}&entryId=${ENTRY_ID}&teamId=${TEAM_ID}`);

    // Hold the accept POST open until we explicitly resolve it. This proves
    // the test infrastructure waits for the eventual state change instead of
    // racing the mock and that the button stays disabled while in flight.
    const acceptUrl = `/api/v1/teams/${TEAM_ID}/members/${ENTRY_ID}/accept`;
    let resolveAccept: (value: unknown) => void = () => {};
    const acceptPromise = new Promise((resolve) => {
      resolveAccept = resolve;
    });
    customFetchMock.mockImplementation(
      async (url: string, init?: RequestInit) => {
        const method = (init?.method ?? "GET").toUpperCase();
        if (url === "/api/v1/users/me/children" && method === "GET") {
          return { data: structuredClone(childrenFixture) };
        }
        if (
          url ===
            `/api/v1/users/me/children/${CHILD_ID}/pending-team-invites` &&
          method === "GET"
        ) {
          return structuredClone(pendingFixture);
        }
        if (
          url === "/api/v1/notifications/email-preference" &&
          method === "GET"
        ) {
          return { emailOptOut: false };
        }
        if (url === acceptUrl && method === "POST") {
          await acceptPromise;
          return { ok: true };
        }
        throw new Error(`Unexpected fetch in test: ${method} ${url}`);
      },
    );

    const user = userEvent.setup();
    renderPage();

    const acceptBtn = await screen.findByTestId(
      `btn-accept-pending-${ENTRY_ID}`,
    );
    await user.click(acceptBtn);

    // While the mock is still pending, the button should be disabled and
    // show the in-flight label, and the row must still be visible.
    await waitFor(() => {
      expect(
        screen.getByTestId(`btn-accept-pending-${ENTRY_ID}`),
      ).toBeDisabled();
    });
    expect(
      screen.getByTestId(`btn-accept-pending-${ENTRY_ID}`),
    ).toHaveTextContent(/Working/);
    expect(
      screen.getByTestId(`row-pending-invite-${ENTRY_ID}`),
    ).toBeInTheDocument();

    // Now let the API call complete; the row should drop out without the
    // test having to fight a timing race.
    resolveAccept({ ok: true });

    await waitFor(() => {
      expect(
        screen.queryByTestId(`row-pending-invite-${ENTRY_ID}`),
      ).not.toBeInTheDocument();
    });
  });

  it("removes the pending-invite row after Decline is clicked", async () => {
    setMockSearch(`childId=${CHILD_ID}&entryId=${ENTRY_ID}&teamId=${TEAM_ID}`);

    const user = userEvent.setup();
    renderWithProviders(<GuardianPage />);

    const declineBtn = await screen.findByTestId(
      `btn-decline-pending-${ENTRY_ID}`,
    );
    await user.click(declineBtn);

    await waitFor(() => {
      expect(api.fetch).toHaveBeenCalledWith(
        `/api/v1/teams/${TEAM_ID}/members/${ENTRY_ID}/decline`,
        expect.objectContaining({ method: "POST" }),
      );
    });

    await waitFor(() => {
      expect(
        screen.queryByTestId(`row-pending-invite-${ENTRY_ID}`),
      ).not.toBeInTheDocument();
    });
    expect(
      screen.getByTestId(`row-pending-invite-${OTHER_ENTRY_ID}`),
    ).toBeInTheDocument();
  });
});
