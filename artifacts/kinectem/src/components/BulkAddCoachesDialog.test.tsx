import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test";
import { customFetch } from "@workspace/api-client-react";
import { BulkAddCoachesDialog } from "./BulkAddCoachesDialog";

vi.mock("@workspace/api-client-react", async (importOriginal) => ({
  ...await importOriginal<typeof import("@workspace/api-client-react")>(),
  customFetch: vi.fn(),
}));

const teams = [{ id: "one", name: "Team One" }, { id: "two", name: "Team Two" }];
const fetchMock = vi.mocked(customFetch);

beforeEach(() => {
  fetchMock.mockReset();
});

describe("bulk coach email reminders", () => {
  it("uses the dedicated resend endpoint for an already-pending one-team invite", async () => {
    fetchMock.mockImplementation(async (url, options) => {
      if (options?.method === "GET") return { data: [] };
      if (String(url).endsWith("/resend"))
        return { emailSent: true, acceptUrl: "/app/invites/existing" };
      return { outcome: "already_pending", inviteId: "pending-id", emailSent: null };
    });
    renderWithProviders(<BulkAddCoachesDialog orgId="org" teams={teams} open onOpenChange={vi.fn()} />);
    fireEvent.change(screen.getByTestId("input-bulk-coach-one"), { target: { value: "coach@example.com" } });
    fireEvent.click(screen.getByTestId("btn-bulk-coaches-send"));
    await screen.findByText("Reminder email sent for the pending invitation");
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/teams/one/invites/pending-id/resend", { method: "POST" });
    expect(screen.queryByText(/no new invitation was sent/i)).not.toBeInTheDocument();
  });

  it("asks the multi-team endpoint to resend pending emails and shows reminder outcomes", async () => {
    let payload: unknown;
    fetchMock.mockImplementation(async (_url, options) => {
      if (options?.method === "GET") return { data: [] };
      payload = JSON.parse(String(options?.body));
      return { data: [{
        outcome: "reminded", emailSent: true,
        teamOutcomes: teams.map((team) => ({ teamId: team.id, outcome: "reminded" })),
      }] };
    });
    renderWithProviders(<BulkAddCoachesDialog orgId="org" teams={teams} open onOpenChange={vi.fn()} />);
    for (const team of teams)
      fireEvent.change(screen.getByTestId(`input-bulk-coach-${team.id}`), { target: { value: "coach@example.com" } });
    fireEvent.click(screen.getByTestId("btn-bulk-coaches-send"));
    await screen.findByText("Reminder email sent for the pending invitation");
    expect(payload).toEqual({
      assignments: teams.map((team) => ({ teamId: team.id, email: "coach@example.com" })),
      resendPending: true,
    });
    expect(screen.getAllByText(/Reminder email sent — no new invitation created/)).toHaveLength(2);
  });

  it("shows email failure and every team link instead of claiming an in-app nudge was an email", async () => {
    fetchMock.mockImplementation(async (_url, options) => {
      if (options?.method === "GET") return { data: [] };
      return { data: [{
        outcome: "reminded", emailSent: false, notified: true,
        teamOutcomes: teams.map((team) => ({ teamId: team.id, outcome: "reminded" })),
        acceptUrls: teams.map((team) => ({ teamId: team.id, url: `/app/invites/${team.id}` })),
      }] };
    });
    renderWithProviders(<BulkAddCoachesDialog orgId="org" teams={teams} open onOpenChange={vi.fn()} />);
    for (const team of teams)
      fireEvent.change(screen.getByTestId(`input-bulk-coach-${team.id}`), { target: { value: "coach@example.com" } });
    fireEvent.click(screen.getByTestId("btn-bulk-coaches-send"));
    await waitFor(() => expect(screen.getByText(/One or more emails didn't send/)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Team One link" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Team Two link" })).toBeInTheDocument();
    expect(screen.queryByText("Reminder email sent for the pending invitation")).not.toBeInTheDocument();
  });
});