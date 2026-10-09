import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { NotificationsBell } from "./NotificationsBell";

const mocks = vi.hoisted(() => ({
  markOwn: vi.fn(),
  markChild: vi.fn(),
  fetch: vi.fn(),
  toast: vi.fn(),
}));
const countKey = ["bell-count"];
const childrenKey = ["bell-children"];
const listKey = ["bell-list"];
let ownCount = 3;
let childCount = 2;
let coldSummary = false;
const summary = () => ({
  totalUnreadCount: childCount,
  data: [{ childId: "child-1", firstName: "Ava", unreadCount: childCount }],
});
const list = () => ({
  data: [{
    id: "invite-1",
    type: "roster_invite_for_child",
    title: "Coach invited Ava to join Team.",
    body: null,
    createdAt: new Date().toISOString(),
    isRead: ownCount > 0 ? false : true,
    data: { link: "/family?childId=child-1&entryId=entry-1&teamId=team-1" },
  }],
});

vi.mock("@workspace/api-client-react", () => ({
  customFetch: mocks.fetch,
  markAllChildNotificationsRead: mocks.markChild,
  useMarkAllNotificationsAsRead: () => ({ mutateAsync: mocks.markOwn }),
  getGetUnreadNotificationCountQueryKey: () => countKey,
  getGetChildrenNotificationsSummaryQueryKey: () => childrenKey,
  getListNotificationsQueryKey: () => listKey,
  useGetUnreadNotificationCount: () => useQuery({
    queryKey: countKey, queryFn: async () => ({ unreadCount: ownCount }),
  }),
  useGetChildrenNotificationsSummary: () => useQuery({
    queryKey: childrenKey, queryFn: async () => summary(), enabled: !coldSummary,
  }),
  useListNotifications: () => useQuery({
    queryKey: listKey, queryFn: async () => list(),
  }),
}));
vi.mock("wouter", () => ({ useLocation: () => ["/", vi.fn()] }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
// Test controlled open/close behavior without relying on Radix portal timing.
vi.mock("@/components/ui/dropdown-menu", async () => {
  const React = await import("react");
  const Context = React.createContext({ open: false, onOpenChange: (_open: boolean) => {} });
  return {
    DropdownMenu: ({ children, open, onOpenChange }: {
      children: ReactNode; open: boolean; onOpenChange: (open: boolean) => void;
    }) => <Context.Provider value={{ open, onOpenChange }}>{children}</Context.Provider>,
    DropdownMenuTrigger: ({ children }: { children: ReactNode }) => {
      const value = React.useContext(Context);
      return React.cloneElement(children as React.ReactElement<{ onClick: () => void }>, {
        onClick: () => value.onOpenChange(!value.open),
      });
    },
    DropdownMenuContent: ({ children }: { children: ReactNode }) =>
      React.useContext(Context).open ? <div>{children}</div> : null,
  };
});

function setup() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } },
  });
  qc.setQueryData(countKey, { unreadCount: ownCount });
  if (!coldSummary) qc.setQueryData(childrenKey, summary());
  qc.setQueryData(listKey, list());
  render(<QueryClientProvider client={qc}><NotificationsBell /></QueryClientProvider>);
  return qc;
}

beforeEach(() => {
  vi.clearAllMocks();
  ownCount = 3;
  childCount = 2;
  coldSummary = false;
  mocks.markOwn.mockImplementation(async () => { ownCount = 0; });
  mocks.markChild.mockImplementation(async () => { childCount = 0; });
  mocks.fetch.mockImplementation(async () => summary());
});

describe("notification bell acknowledgement", () => {
  it("automatically clears both streams on open, keeps notifications and pending invite actions, and does not mark on close", async () => {
    const user = userEvent.setup();
    const qc = setup();
    expect(screen.getByTestId("badge-bell-unread")).toHaveTextContent("5");
    expect(mocks.markOwn).not.toHaveBeenCalled();
    await user.click(screen.getByTestId("button-notifications"));
    expect(screen.queryByTestId("badge-bell-unread")).not.toBeInTheDocument();
    await waitFor(() => expect(mocks.markChild).toHaveBeenCalledWith("child-1"));
    await waitFor(() => expect(qc.isFetching()).toBe(0));
    expect(mocks.markOwn).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Coach invited Ava to join Team.")).toBeInTheDocument();
    expect(screen.getByTestId("button-accept-child-invite-invite-1")).toBeEnabled();
    expect(screen.getByTestId("button-decline-child-invite-invite-1")).toBeEnabled();
    await user.click(screen.getByTestId("button-notifications"));
    expect(mocks.markOwn).toHaveBeenCalledTimes(1);
    await user.click(screen.getByTestId("button-notifications"));
    await waitFor(() => expect(mocks.markOwn).toHaveBeenCalledTimes(2));
  });

  it("keeps the badge cleared immediately while server requests are still pending", async () => {
    const user = userEvent.setup();
    let finish!: () => void;
    mocks.markOwn.mockImplementation(() => new Promise<void>((resolve) => {
      finish = () => { ownCount = 0; resolve(); };
    }));
    setup();
    await user.click(screen.getByTestId("button-notifications"));
    expect(screen.queryByTestId("badge-bell-unread")).not.toBeInTheDocument();
    await waitFor(() => expect(mocks.markOwn).toHaveBeenCalledTimes(1));
    await user.click(screen.getByTestId("button-notifications"));
    await user.click(screen.getByTestId("button-notifications"));
    expect(mocks.markOwn).toHaveBeenCalledTimes(1);
    finish();
    await waitFor(() => expect(ownCount).toBe(0));
  });

  it("fetches child IDs when their summary was not loaded when the bell opened", async () => {
    const user = userEvent.setup();
    coldSummary = true;
    setup();
    await user.click(screen.getByTestId("button-notifications"));
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledWith("/api/v1/users/me/children-notifications-summary"));
    await waitFor(() => expect(mocks.markChild).toHaveBeenCalledWith("child-1"));
    expect(screen.queryByTestId("badge-bell-unread")).not.toBeInTheDocument();
  });

  it("reports a persistence failure and restores the remaining unread count", async () => {
    const user = userEvent.setup();
    mocks.markOwn.mockRejectedValue(new Error("offline"));
    setup();
    await user.click(screen.getByTestId("button-notifications"));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive" })));
    await waitFor(() => expect(screen.getByTestId("badge-bell-unread")).toHaveTextContent("3"));
    expect(screen.getByText("Coach invited Ava to join Team.")).toBeInTheDocument();
  });
});
