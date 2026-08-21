import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test";
import { wouterMock } from "@/test/mocks/wouter";
import { useToastMock } from "@/test/mocks/toast";

const ORG_ID = "org-1";
const customFetchMock = vi.fn();
const useGetOrganizationByIdMock = vi.fn();

vi.mock("wouter", () => ({
  ...wouterMock,
  useParams: () => ({ orgId: ORG_ID }),
}));
vi.mock("@/hooks/use-toast", () => useToastMock);
vi.mock("@workspace/api-client-react", () => ({
  customFetch: (...args: unknown[]) => customFetchMock(...args),
  useGetOrganizationById: (...args: unknown[]) =>
    useGetOrganizationByIdMock(...args),
}));

import OrgRosterOutreachPage from "./OrgRosterOutreachPage";

describe("OrgRosterOutreachPage", () => {
  let sent = false;
  let writeText: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sent = false;
    customFetchMock.mockReset();
    useGetOrganizationByIdMock.mockReturnValue({
      data: { id: ORG_ID, name: "Westfield Athletic Club" },
      isLoading: false,
    });
    writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    Object.defineProperty(document, "execCommand", {
      value: vi.fn().mockReturnValue(true),
      configurable: true,
    });

    customFetchMock.mockImplementation(async (path: string, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (
        method === "GET" &&
        path === `/api/v1/organizations/${ORG_ID}/roster-outreach`
      ) {
        return {
          data: [
            {
              id: "team-blue",
              name: "12U Blue",
              sport: "Soccer",
              season: "Fall 2026",
              level: null,
              gender: null,
              sentAt: sent ? "2026-08-21T13:00:00.000Z" : null,
              sentBy: sent
                ? { id: "manager-1", displayName: "Morgan Manager" }
                : null,
            },
            {
              id: "team-red",
              name: "14U Red",
              sport: "Soccer",
              season: "Fall 2026",
              level: null,
              gender: null,
              sentAt: "2026-08-20T13:00:00.000Z",
              sentBy: { id: "manager-2", displayName: "Alex Admin" },
            },
          ],
        };
      }
      if (
        method === "POST" &&
        path === `/api/v1/organizations/${ORG_ID}/roster-outreach/team-blue/message`
      ) {
        return {
          teamId: "team-blue",
          joinLink: "https://kinectem.test/app/invites/join-blue",
          message:
            "Hi there,\n\nSet up your player's account → https://kinectem.test/app/invites/join-blue",
        };
      }
      if (
        method === "PATCH" &&
        path === `/api/v1/organizations/${ORG_ID}/roster-outreach/team-blue`
      ) {
        sent = JSON.parse(String(init?.body)).sent;
        return {
          teamId: "team-blue",
          sentAt: sent ? "2026-08-21T13:00:00.000Z" : null,
          sentBy: sent
            ? { id: "manager-1", displayName: "Morgan Manager" }
            : null,
        };
      }
      throw new Error(`Unhandled ${method} ${path}`);
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("prepares one selected team's message on demand and persists its shared checkbox", async () => {
    const user = userEvent.setup();
    renderWithProviders(<OrgRosterOutreachPage />);

    expect(await screen.findByText("1 of 2 teams contacted")).toBeInTheDocument();
    expect(screen.getByTestId("check-roster-outreach-team-blue")).not.toBeChecked();
    expect(screen.getByTestId("check-roster-outreach-team-red")).toBeChecked();

    expect(
      customFetchMock.mock.calls.some(([path]) =>
        String(path).includes("/message"),
      ),
    ).toBe(false);

    await user.click(screen.getByTestId("btn-copy-roster-message-team-blue"));
    expect(await screen.findByTestId("text-prepared-message")).toHaveTextContent(
      "join-blue",
    );
    expect(screen.getByTestId("dialog-message-team-blue")).toHaveClass(
      "max-h-[calc(100dvh-2rem)]",
      "!flex",
      "flex-col",
    );
    expect(screen.getByTestId("dialog-message-content")).toHaveClass(
      "overflow-y-auto",
    );
    expect(screen.getByTestId("text-prepared-message")).toHaveClass(
      "font-sans",
      "whitespace-pre-wrap",
    );
    expect(screen.getByTestId("dialog-message-footer")).toHaveClass(
      "shrink-0",
    );
    expect(customFetchMock).toHaveBeenCalledWith(
      `/api/v1/organizations/${ORG_ID}/roster-outreach/team-blue/message`,
      expect.objectContaining({ method: "POST" }),
    );
    await user.click(screen.getByTestId("btn-copy-message"));
    await waitFor(() =>
      expect(screen.getByText("Copied!")).toBeInTheDocument(),
    );
    expect(
      screen.getByText(/Open the roster message for this team in TeamSnap/),
    ).toBeInTheDocument();

    await user.keyboard("{Escape}");
    await user.click(screen.getByTestId("check-roster-outreach-team-blue"));
    await waitFor(() =>
      expect(customFetchMock).toHaveBeenCalledWith(
        `/api/v1/organizations/${ORG_ID}/roster-outreach/team-blue`,
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ sent: true }),
        }),
      ),
    );
    await waitFor(() =>
      expect(screen.getByTestId("check-roster-outreach-team-blue")).toBeChecked(),
    );
  });
});