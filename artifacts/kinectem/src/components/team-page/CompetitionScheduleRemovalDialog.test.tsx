import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/renderWithProviders";
import type { Query } from "@tanstack/react-query";
import { CompetitionScheduleRemovalDialog, type ScheduleRemovalTarget } from "./CompetitionScheduleRemovalDialog";
import { TournamentScheduleCard } from "./TournamentScheduleCard";

const { fetchMock, toast } = vi.hoisted(() => ({ fetchMock: vi.fn(), toast: vi.fn() }));
vi.mock("@workspace/api-client-react", () => ({ customFetch: fetchMock }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));
const base: ScheduleRemovalTarget = {
  competitionId: "cup-1", competitionSlug: "city-cup", competitionName: "City Cup", teamName: "United U12",
  assignments: [{ participantId: "slot-1", name: "Original CSV Team", claimedAt: "2026-10-01T12:00:00.000Z" }],
};

beforeEach(() => { fetchMock.mockReset().mockResolvedValue({ ok: true }); toast.mockReset(); });

describe("two-step competition schedule removal", () => {
  it.each([false, true])("requires review and exact typed confirmation before writing (individual game: %s)", async (game) => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const target = game ? { ...base, match: { id: "game-1", label: "Against Rovers · Oct 10 10:00 AM" } } : base;
    const { queryClient } = renderWithProviders(<CompetitionScheduleRemovalDialog teamId="team-1" target={target} onClose={onClose} />);
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    expect(screen.getByText("Original CSV Team")).toBeVisible();
    expect(screen.getByText("United U12")).toBeVisible();
    if (game) expect(screen.getByText(/Other games stay linked/)).toBeVisible();
    else expect(screen.getByText(/Unclaimed and can be claimed again/)).toBeVisible();
    expect(screen.queryByTestId("input-confirm-schedule-removal")).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    await user.click(screen.getByTestId("button-review-schedule-removal"));
    expect(fetchMock).not.toHaveBeenCalled();
    const final = screen.getByTestId("button-confirm-schedule-removal");
    expect(final).toBeDisabled();
    await user.type(screen.getByLabelText("Type REMOVE to confirm"), "remove");
    expect(final).toBeDisabled();
    await user.clear(screen.getByLabelText("Type REMOVE to confirm"));
    await user.type(screen.getByLabelText("Type REMOVE to confirm"), "REMOVE");
    await user.click(final);
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/v1/teams/team-1/competitions/cup-1/remove");
    expect(JSON.parse(options.body)).toEqual({
      reviewed: true, confirmation: "REMOVE",
      assignments: [{ participantId: "slot-1", claimedAt: "2026-10-01T12:00:00.000Z" }],
      ...(game ? { matchId: "game-1" } : {}),
    });
    expect(invalidate).toHaveBeenCalledOnce();
    const predicate = invalidate.mock.calls[0][0]?.predicate;
    expect(predicate?.({ queryKey: ["team-competition-photos", "team-1"] } as Query)).toBe(true);
    expect(predicate?.({ queryKey: ["competition-partner-team-options", "cup-1"] } as Query)).toBe(true);
    expect(predicate?.({ queryKey: ["/api/v1/users/me"] } as Query)).toBe(true);
    expect(predicate?.({ queryKey: ["team", "other-team"] } as Query)).toBe(false);
  });

  it("Back resets typed confirmation and Cancel never removes anything", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderWithProviders(<CompetitionScheduleRemovalDialog teamId="team-1" target={base} onClose={onClose} />);
    await user.click(screen.getByTestId("button-review-schedule-removal"));
    await user.type(screen.getByLabelText("Type REMOVE to confirm"), "REMOVE");
    await user.click(screen.getByRole("button", { name: "Back" }));
    await user.click(screen.getByTestId("button-review-schedule-removal"));
    expect(screen.getByLabelText("Type REMOVE to confirm")).toHaveValue("");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("retains the dialog and shows failures without claiming success", async () => {
    fetchMock.mockRejectedValue(new Error("This schedule assignment changed."));
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderWithProviders(<CompetitionScheduleRemovalDialog teamId="team-1" target={base} onClose={onClose} />);
    await user.click(screen.getByTestId("button-review-schedule-removal"));
    await user.type(screen.getByLabelText("Type REMOVE to confirm"), "REMOVE");
    await user.click(screen.getByTestId("button-confirm-schedule-removal"));
    expect(await screen.findByRole("alert")).toHaveTextContent("This schedule assignment changed.");
    expect(onClose).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });

  it.each([
    { canManage: false, serverCanManage: false },
    { canManage: true, serverCanManage: true },
    { canManage: false, serverCanManage: true },
  ])("uses server management permission even when client position labels differ ($canManage / $serverCanManage)", async ({ canManage, serverCanManage }) => {
    fetchMock.mockResolvedValue({ data: [{
      tournamentId: base.competitionId, tournamentSlug: base.competitionSlug, tournamentName: base.competitionName,
      startDate: "2026-10-01", endDate: "2026-10-31", recapFreeUntil: null, logoUrl: null, brandColor: null, secondaryColor: null,
      assignmentSnapshot: serverCanManage ? base.assignments : undefined, matches: [],
    }] });
    renderWithProviders(<TournamentScheduleCard teamId="team-1" teamName="United U12" canManage={canManage} />);
    await screen.findByTestId("card-tournament-schedule");
    if (serverCanManage) expect(screen.getByTestId("btn-remove-competition-cup-1")).toBeVisible();
    else expect(screen.queryByTestId("btn-remove-competition-cup-1")).not.toBeInTheDocument();
  });
});
