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
const TAG_ITEM_KEY = "tag:tag-1";
const COMMENT_ITEM_KEY = "comment:comment-1";

const childrenFixture = [
  {
    id: CHILD_ID,
    firstName: "Samira",
    lastName: "Khan",
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

const notificationsFixture = {
  data: [
    {
      itemKey: TAG_ITEM_KEY,
      kind: "tag" as const,
      title: "Coach Diaz tagged Samira in a photo",
      body: null,
      link: null,
      isRead: false,
      decision: null,
      createdAt: new Date().toISOString(),
      actor: { id: "coach-1", displayName: "Coach Diaz", avatarUrl: null },
    },
    {
      itemKey: COMMENT_ITEM_KEY,
      kind: "comment" as const,
      title: "Coach Diaz commented on Samira's post",
      body: "Nice play!",
      link: null,
      isRead: false,
      decision: null,
      createdAt: new Date().toISOString(),
      actor: { id: "coach-1", displayName: "Coach Diaz", avatarUrl: null },
    },
  ],
  unreadCount: 2,
};

function installDefaultHandlers() {
  api.reset();
  api.setHandlers({
    "GET /api/v1/users/me/children": () => ({
      data: structuredClone(childrenFixture),
    }),
    [`GET /api/v1/users/me/children/${CHILD_ID}/pending-team-invites`]: () =>
      structuredClone(pendingFixture),
    [`GET /api/v1/users/me/children/${CHILD_ID}/notifications`]: () =>
      structuredClone(notificationsFixture),
    "GET /api/v1/notifications/email-preference": { emailOptOut: false },
    [`POST /api/v1/teams/${TEAM_ID}/members/${ENTRY_ID}/accept`]: { ok: true },
    [`POST /api/v1/teams/${TEAM_ID}/members/${ENTRY_ID}/decline`]: { ok: true },
    [`POST /api/v1/users/me/children/${CHILD_ID}/notifications/decision`]: {
      ok: true,
    },
    [`POST /api/v1/users/me/children/${CHILD_ID}/notifications/approve-all`]: {
      ok: true,
    },
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

    // Override just the accept handler so it rejects, mimicking a server-side
    // failure. Every other endpoint keeps its happy-path mock.
    api.setHandler(
      `POST /api/v1/teams/${TEAM_ID}/members/${ENTRY_ID}/accept`,
      () => {
        throw new Error("server exploded");
      },
    );

    const user = userEvent.setup();
    renderWithProviders(<GuardianPage />);

    const acceptBtn = await screen.findByTestId(
      `btn-accept-pending-${ENTRY_ID}`,
    );
    await user.click(acceptBtn);

    // The accept call should have been dispatched even though it will reject.
    await waitFor(() => {
      expect(api.fetch).toHaveBeenCalledWith(
        `/api/v1/teams/${TEAM_ID}/members/${ENTRY_ID}/accept`,
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
    let resolveAccept: () => void = () => {};
    const acceptPromise = new Promise<void>((resolve) => {
      resolveAccept = resolve;
    });
    api.setHandler(
      `POST /api/v1/teams/${TEAM_ID}/members/${ENTRY_ID}/accept`,
      async () => {
        await acceptPromise;
        return { ok: true };
      },
    );

    const user = userEvent.setup();
    renderWithProviders(<GuardianPage />);

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
    resolveAccept();

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

describe("GuardianPage — per-item Approve / Remove", () => {
  it("posts the approved decision, drops the bell count, and removes the row", async () => {
    const user = userEvent.setup();
    renderWithProviders(<GuardianPage />);

    // Wait for the notifications section to mount with both items.
    await screen.findByTestId(`section-child-notifs-${CHILD_ID}`);
    expect(
      screen.getByTestId(`badge-child-notif-unread-${CHILD_ID}`),
    ).toHaveTextContent("2 new");
    expect(
      screen.getByTestId(`row-child-notif-${TAG_ITEM_KEY}`),
    ).toBeInTheDocument();

    await user.click(screen.getByTestId(`btn-approve-${TAG_ITEM_KEY}`));

    // POST hits the per-child decision endpoint with the right body.
    await waitFor(() => {
      expect(api.fetch).toHaveBeenCalledWith(
        `/api/v1/users/me/children/${CHILD_ID}/notifications/decision`,
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            itemKey: TAG_ITEM_KEY,
            decision: "approved",
          }),
        }),
      );
    });

    // Optimistic UI: the row flips to the "Approved" badge and the bell's
    // unread count decrements right away.
    expect(
      screen.getByTestId(`badge-decided-${TAG_ITEM_KEY}`),
    ).toHaveTextContent(/approved/i);
    expect(
      screen.getByTestId(`badge-child-notif-unread-${CHILD_ID}`),
    ).toHaveTextContent("1 new");

    // After the badge linger window the row is removed from the list, while
    // the other notification stays put.
    await waitFor(
      () => {
        expect(
          screen.queryByTestId(`row-child-notif-${TAG_ITEM_KEY}`),
        ).not.toBeInTheDocument();
      },
      { timeout: 3000 },
    );
    expect(
      screen.getByTestId(`row-child-notif-${COMMENT_ITEM_KEY}`),
    ).toBeInTheDocument();
  });

  it("posts the removed decision, drops the bell count, and removes the row", async () => {
    const user = userEvent.setup();
    renderWithProviders(<GuardianPage />);

    await screen.findByTestId(`section-child-notifs-${CHILD_ID}`);
    expect(
      screen.getByTestId(`badge-child-notif-unread-${CHILD_ID}`),
    ).toHaveTextContent("2 new");

    await user.click(screen.getByTestId(`btn-remove-${COMMENT_ITEM_KEY}`));

    await waitFor(() => {
      expect(api.fetch).toHaveBeenCalledWith(
        `/api/v1/users/me/children/${CHILD_ID}/notifications/decision`,
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            itemKey: COMMENT_ITEM_KEY,
            decision: "removed",
          }),
        }),
      );
    });

    // Optimistic "Removed" badge and decremented bell count.
    expect(
      screen.getByTestId(`badge-decided-${COMMENT_ITEM_KEY}`),
    ).toHaveTextContent(/removed/i);
    expect(
      screen.getByTestId(`badge-child-notif-unread-${CHILD_ID}`),
    ).toHaveTextContent("1 new");

    await waitFor(
      () => {
        expect(
          screen.queryByTestId(`row-child-notif-${COMMENT_ITEM_KEY}`),
        ).not.toBeInTheDocument();
      },
      { timeout: 3000 },
    );
    // The untouched item remains visible.
    expect(
      screen.getByTestId(`row-child-notif-${TAG_ITEM_KEY}`),
    ).toBeInTheDocument();
  });

  it("renders the helper copy that explains Approve vs Remove and the consent setting", async () => {
    renderWithProviders(<GuardianPage />);

    // The consent helper text mirrors the current value of requireTagConsent.
    // Default fixture has it OFF, so the helper should describe the
    // "tags appear automatically" path while still pointing at Remove.
    const consentHelper = await screen.findByTestId(
      `text-consent-helper-${CHILD_ID}`,
    );
    expect(consentHelper).toHaveTextContent(/appear automatically/i);
    expect(consentHelper).toHaveTextContent(/Remove/);

    // The notifications-section helper explains what Approve / Remove do
    // for the parent, anchoring the renamed bulk button alongside it.
    const notifHelper = await screen.findByTestId(
      `text-notif-section-helper-${CHILD_ID}`,
    );
    expect(notifHelper).toHaveTextContent(/Approve/);
    expect(notifHelper).toHaveTextContent(/Remove/);
  });

  it("posts to approve-all and clears every notification row for the child", async () => {
    const user = userEvent.setup();
    renderWithProviders(<GuardianPage />);

    const section = await screen.findByTestId(
      `section-child-notifs-${CHILD_ID}`,
    );
    expect(
      within(section).getByTestId(`row-child-notif-${TAG_ITEM_KEY}`),
    ).toBeInTheDocument();
    expect(
      within(section).getByTestId(`row-child-notif-${COMMENT_ITEM_KEY}`),
    ).toBeInTheDocument();

    await user.click(screen.getByTestId(`btn-approve-all-${CHILD_ID}`));

    await waitFor(() => {
      expect(api.fetch).toHaveBeenCalledWith(
        `/api/v1/users/me/children/${CHILD_ID}/notifications/approve-all`,
        expect.objectContaining({ method: "POST" }),
      );
    });

    // The whole notifications section disappears once items + unread count
    // are zeroed out optimistically.
    await waitFor(() => {
      expect(
        screen.queryByTestId(`section-child-notifs-${CHILD_ID}`),
      ).not.toBeInTheDocument();
    });
    expect(
      screen.queryByTestId(`row-child-notif-${TAG_ITEM_KEY}`),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId(`row-child-notif-${COMMENT_ITEM_KEY}`),
    ).not.toBeInTheDocument();
  });
});
