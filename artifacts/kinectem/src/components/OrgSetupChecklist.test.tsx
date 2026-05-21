import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders } from "@/test";
import { OrgSetupChecklist } from "./OrgSetupChecklist";

// ---------------------------------------------------------------------------
// The generated react-query hooks call `customFetch` from the source file
// (not the package barrel), so stubbing the global `fetch` is the single
// reliable interception point — same approach used by
// OrganizationPage.test.tsx (Task #538).
// ---------------------------------------------------------------------------

const ORG_ID = "org-setup-1";

type StepKey =
  | "logoSet"
  | "hasTeam"
  | "hasStaffOrInvite"
  | "hasCoAdmin"
  | "hasRosterEntry"
  | "hasGuardianLinkOrInvite";

const ALL_STEPS: StepKey[] = [
  "logoSet",
  "hasTeam",
  "hasStaffOrInvite",
  "hasCoAdmin",
  "hasRosterEntry",
  "hasGuardianLinkOrInvite",
];

function buildStatus(opts: {
  done?: Partial<Record<StepKey, boolean>>;
  dismissedAt?: string | null;
}) {
  const steps: Record<StepKey, boolean> = {
    logoSet: false,
    hasTeam: false,
    hasStaffOrInvite: false,
    hasCoAdmin: false,
    hasRosterEntry: false,
    hasGuardianLinkOrInvite: false,
    ...opts.done,
  };
  const completedCount = Object.values(steps).filter(Boolean).length;
  return {
    orgId: ORG_ID,
    steps,
    completedCount,
    totalSteps: ALL_STEPS.length,
    allComplete: completedCount === ALL_STEPS.length,
    dismissedAt: opts.dismissedAt ?? null,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// Tests own a mutable status object so the dismiss/reopen mutations can
// flip the server-returned shape and re-renders pick up the new value.
let currentStatus = buildStatus({});
let fetchMock: ReturnType<typeof vi.fn>;

function installFetchMock() {
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === "string" ? input : (input as Request).url;
    const path = raw.split("?")[0];
    const method = (init?.method ?? "GET").toUpperCase();
    const statusPath = `/api/v1/organizations/${ORG_ID}/setup-status`;
    const dismissPath = `/api/v1/organizations/${ORG_ID}/setup-checklist/dismiss`;

    if (method === "GET" && path === statusPath) {
      return jsonResponse(currentStatus);
    }
    if (method === "POST" && path === dismissPath) {
      currentStatus = { ...currentStatus, dismissedAt: new Date().toISOString() };
      return jsonResponse(currentStatus);
    }
    if (method === "DELETE" && path === dismissPath) {
      currentStatus = { ...currentStatus, dismissedAt: null };
      return jsonResponse(currentStatus);
    }
    return new Response(
      JSON.stringify({ error: "Unhandled in test", method, path }),
      { status: 404, headers: { "content-type": "application/json" } },
    );
  });
  vi.stubGlobal("fetch", fetchMock);
}

function makeActions() {
  return {
    onEditLogo: vi.fn(),
    onCreateTeam: vi.fn(),
    onManageMembers: vi.fn(),
    onPromoteAdmin: vi.fn(),
    onGoToTeams: vi.fn(),
  };
}

beforeEach(() => {
  currentStatus = buildStatus({});
  installFetchMock();
});

describe("OrgSetupChecklist (Task #548 / verified by Task #550)", () => {
  it("renders all six steps with an action button when nothing is done", async () => {
    const actions = makeActions();
    renderWithProviders(
      <OrgSetupChecklist orgId={ORG_ID} actions={actions} />,
    );

    // Card shell + progress badge.
    await screen.findByTestId("card-org-setup-checklist");
    expect(screen.getByTestId("badge-org-setup-progress")).toHaveTextContent(
      `0 of ${ALL_STEPS.length} done`,
    );

    // Every step has a row, an empty Circle, and an action button.
    for (const key of ALL_STEPS) {
      expect(screen.getByTestId(`row-org-setup-${key}`)).toBeInTheDocument();
      expect(
        screen.getByTestId(`icon-org-setup-todo-${key}`),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId(`btn-org-setup-action-${key}`),
      ).toBeInTheDocument();
    }
    expect(screen.getByText("Get your org set up")).toBeInTheDocument();
  });

  it("renders completed rows with the done icon and no action button", async () => {
    currentStatus = buildStatus({
      done: { logoSet: true, hasTeam: true },
    });
    renderWithProviders(
      <OrgSetupChecklist orgId={ORG_ID} actions={makeActions()} />,
    );

    await screen.findByTestId("card-org-setup-checklist");

    expect(screen.getByTestId("badge-org-setup-progress")).toHaveTextContent(
      `2 of ${ALL_STEPS.length} done`,
    );
    expect(screen.getByTestId("icon-org-setup-done-logoSet")).toBeInTheDocument();
    expect(
      screen.queryByTestId("btn-org-setup-action-logoSet"),
    ).not.toBeInTheDocument();
    // Incomplete steps still expose their action.
    expect(
      screen.getByTestId("btn-org-setup-action-hasCoAdmin"),
    ).toBeInTheDocument();
  });

  it("shows the 'Setup complete' confirmation when every step is done", async () => {
    currentStatus = buildStatus({
      done: Object.fromEntries(ALL_STEPS.map((k) => [k, true])) as Record<
        StepKey,
        boolean
      >,
    });
    renderWithProviders(
      <OrgSetupChecklist orgId={ORG_ID} actions={makeActions()} />,
    );

    await screen.findByTestId("text-org-setup-complete");
    // The all-complete view replaces the per-step list entirely.
    expect(
      screen.queryByTestId("row-org-setup-logoSet"),
    ).not.toBeInTheDocument();
  });

  it("renders the collapsed re-open card when the checklist is dismissed", async () => {
    currentStatus = buildStatus({
      dismissedAt: new Date("2026-05-21T00:00:00Z").toISOString(),
    });
    renderWithProviders(
      <OrgSetupChecklist orgId={ORG_ID} actions={makeActions()} />,
    );

    await screen.findByTestId("card-org-setup-checklist-dismissed");
    expect(
      screen.getByTestId("btn-org-setup-checklist-reopen"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("card-org-setup-checklist"),
    ).not.toBeInTheDocument();
  });

  it("dismisses the checklist via POST and swaps to the collapsed card", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <OrgSetupChecklist orgId={ORG_ID} actions={makeActions()} />,
    );

    await screen.findByTestId("card-org-setup-checklist");
    await user.click(screen.getByTestId("btn-org-setup-checklist-dismiss"));

    await screen.findByTestId("card-org-setup-checklist-dismissed");

    const dismissCall = fetchMock.mock.calls.find(([, init]) => {
      return (init as RequestInit | undefined)?.method === "POST";
    });
    expect(dismissCall).toBeDefined();
    expect(String(dismissCall![0])).toContain(
      `/api/v1/organizations/${ORG_ID}/setup-checklist/dismiss`,
    );
  });

  it("re-opens the checklist via DELETE and restores the full card", async () => {
    currentStatus = buildStatus({
      dismissedAt: new Date("2026-05-21T00:00:00Z").toISOString(),
    });
    const user = userEvent.setup();
    renderWithProviders(
      <OrgSetupChecklist orgId={ORG_ID} actions={makeActions()} />,
    );

    await screen.findByTestId("card-org-setup-checklist-dismissed");
    await user.click(screen.getByTestId("btn-org-setup-checklist-reopen"));

    await screen.findByTestId("card-org-setup-checklist");

    const reopenCall = fetchMock.mock.calls.find(([, init]) => {
      return (init as RequestInit | undefined)?.method === "DELETE";
    });
    expect(reopenCall).toBeDefined();
    expect(String(reopenCall![0])).toContain(
      `/api/v1/organizations/${ORG_ID}/setup-checklist/dismiss`,
    );
  });

  it("invokes the matching action callback when a step's button is clicked", async () => {
    const actions = makeActions();
    const user = userEvent.setup();
    renderWithProviders(
      <OrgSetupChecklist orgId={ORG_ID} actions={actions} />,
    );

    await screen.findByTestId("card-org-setup-checklist");

    await user.click(screen.getByTestId("btn-org-setup-action-logoSet"));
    expect(actions.onEditLogo).toHaveBeenCalledTimes(1);

    await user.click(screen.getByTestId("btn-org-setup-action-hasTeam"));
    expect(actions.onCreateTeam).toHaveBeenCalledTimes(1);

    await user.click(
      screen.getByTestId("btn-org-setup-action-hasStaffOrInvite"),
    );
    expect(actions.onManageMembers).toHaveBeenCalledTimes(1);

    await user.click(screen.getByTestId("btn-org-setup-action-hasCoAdmin"));
    expect(actions.onPromoteAdmin).toHaveBeenCalledTimes(1);

    await user.click(screen.getByTestId("btn-org-setup-action-hasRosterEntry"));
    await user.click(
      screen.getByTestId("btn-org-setup-action-hasGuardianLinkOrInvite"),
    );
    expect(actions.onGoToTeams).toHaveBeenCalledTimes(2);
  });

  it("expands and collapses the roles & permissions accordion", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <OrgSetupChecklist orgId={ORG_ID} actions={makeActions()} />,
    );

    await screen.findByTestId("card-org-setup-checklist");
    const toggle = screen.getByTestId("btn-roles-permissions-toggle");

    // Radix Collapsible keeps the region in the DOM but hidden when closed.
    const region = screen.getByTestId("region-roles-permissions");
    expect(region).toHaveAttribute("data-state", "closed");

    await user.click(toggle);
    await waitFor(() => {
      expect(
        screen.getByTestId("region-roles-permissions"),
      ).toHaveAttribute("data-state", "open");
    });
    // Spot-check the reference content is rendered.
    expect(screen.getByText("Organization roles")).toBeInTheDocument();
    expect(screen.getByText("Team roles (roster)")).toBeInTheDocument();
  });
});
