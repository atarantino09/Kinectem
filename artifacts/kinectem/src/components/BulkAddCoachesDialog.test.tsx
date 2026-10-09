import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
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
  it("separates each team and labels additional coaches within their own team", () => {
    fetchMock.mockResolvedValue({ data: [] });
    renderWithProviders(<BulkAddCoachesDialog orgId="org" teams={teams} open onOpenChange={vi.fn()} />);
    const firstTeam = within(screen.getByRole("group", { name: "Coaches for Team One" }));
    const secondTeam = within(screen.getByRole("group", { name: "Coaches for Team Two" }));
    expect(firstTeam.getByLabelText("Coach 1 email")).toBeInTheDocument();
    expect(secondTeam.getByLabelText("Coach 1 email")).toBeInTheDocument();
    fireEvent.change(firstTeam.getByLabelText("Coach 1 email"), { target: { value: "first@example.com" } });
    fireEvent.click(firstTeam.getByTestId("btn-bulk-coach-add-extra-one"));
    fireEvent.change(firstTeam.getByLabelText("Coach 2 email"), { target: { value: "second@example.com" } });
    expect(secondTeam.queryByLabelText("Coach 2 email")).not.toBeInTheDocument();
    fireEvent.click(firstTeam.getByRole("button", { name: "Remove coach 2 from Team One" }));
    expect(firstTeam.queryByLabelText("Coach 2 email")).not.toBeInTheDocument();
    expect(firstTeam.getByLabelText("Coach 1 email")).toHaveValue("first@example.com");
    expect(secondTeam.getByLabelText("Coach 1 email")).toHaveValue("");
  });

  it("does not send a second reminder when the one-team endpoint already resent it", async () => {
    fetchMock.mockImplementation(async (_url, options) => {
      if (options?.method === "GET") return { data: [] };
      return { outcome: "reminded", emailSent: true, acceptUrl: "/app/invites/existing" };
    });
    renderWithProviders(<BulkAddCoachesDialog orgId="org" teams={teams} open onOpenChange={vi.fn()} />);
    fireEvent.change(screen.getByTestId("input-bulk-coach-one"), { target: { value: "coach@example.com" } });
    fireEvent.click(screen.getByTestId("btn-bulk-coaches-send"));
    await screen.findByText("Reminder email sent for the pending invitation");
    const sends = fetchMock.mock.calls.filter(([, options]) => options?.method === "POST");
    expect(sends).toHaveLength(1);
    expect(sends[0][0]).toBe("/api/v1/teams/one/invites");
  });

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

  it("submits multi-team assignments and shows automatic reminder outcomes", async () => {
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