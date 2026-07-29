import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ChildNotificationsSection } from "./ChildNotificationsSection";
import type { ChildNotificationItem } from "@workspace/api-client-react";
import type { Child, ChildNotificationsState } from "./types";

// Task #826 — tag bells whose tag auto-approved (consent off) carry the
// extra-spec `requiresAction: false` flag and must render as
// informational: no Approve button, Remove kept, excluded from the
// pending group and the Approve-all button's visibility.

const child = {
  id: "child-1",
  firstName: "Georgia",
  name: "Georgia Tarantino",
} as unknown as Child;

function makeItem(
  overrides: Partial<ChildNotificationItem> & { itemKey: string },
): ChildNotificationItem {
  return {
    kind: "notification",
    title: 'You were tagged in "win"',
    body: null,
    link: "/posts/article-abc",
    isRead: false,
    decision: null,
    createdAt: new Date().toISOString(),
    actor: null,
    ...overrides,
  } as ChildNotificationItem;
}

function renderSection(items: ChildNotificationItem[]) {
  const notifState: ChildNotificationsState = {
    items,
    unreadCount: 0,
    loading: false,
    showDecided: false,
  } as ChildNotificationsState;
  return render(
    <ChildNotificationsSection
      child={child}
      notifState={notifState}
      decidingItem={null}
      revertingItemKey={null}
      approveAllForChild={null}
      onDecide={vi.fn()}
      onRevert={vi.fn()}
      onApproveAll={vi.fn()}
      onToggleShowDecided={vi.fn()}
    />,
  );
}

describe("ChildNotificationsSection — informational (auto-approved tag) rows", () => {
  it("renders informational rows with a Live badge and Remove, but no Approve", () => {
    renderSection([
      makeItem({
        itemKey: "notification:n1",
        requiresAction: false,
      } as Partial<ChildNotificationItem> & { itemKey: string }),
    ]);
    expect(screen.getByTestId("badge-live-notification:n1")).toBeInTheDocument();
    expect(
      screen.queryByTestId("btn-approve-notification:n1"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("btn-remove-notification:n1")).toBeInTheDocument();
    // Rendered under the informational strip, not the pending list
    expect(screen.getByTestId("section-informational-child-1")).toBeInTheDocument();
    expect(screen.getByTestId("text-no-pending-child-1")).toBeInTheDocument();
    // No pending items → no Approve all button
    expect(
      screen.queryByTestId("btn-approve-all-child-1"),
    ).not.toBeInTheDocument();
    // Informational rows are not styled as pending
    expect(
      screen.getByTestId("row-child-notif-notification:n1"),
    ).toHaveAttribute("data-decision", "informational");
  });

  it("keeps actionable rows pending with Approve/Remove and shows Approve all", () => {
    renderSection([
      makeItem({ itemKey: "notification:n2" }),
      makeItem({
        itemKey: "notification:n3",
        requiresAction: false,
      } as Partial<ChildNotificationItem> & { itemKey: string }),
    ]);
    expect(screen.getByTestId("btn-approve-notification:n2")).toBeInTheDocument();
    expect(screen.getByTestId("btn-approve-all-child-1")).toBeInTheDocument();
    expect(
      screen.queryByTestId("btn-approve-notification:n3"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("row-child-notif-notification:n2"),
    ).toHaveAttribute("data-decision", "pending");
  });
});
