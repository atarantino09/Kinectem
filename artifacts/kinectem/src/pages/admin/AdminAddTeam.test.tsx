import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { customFetch } from "@workspace/api-client-react";
import { renderWithProviders } from "@/test";
import { AdminAddTeam } from "./AdminAddTeam";

vi.mock("@workspace/api-client-react", () => ({ customFetch: vi.fn() }));
const fetchMock = vi.mocked(customFetch);

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ id: "team-1", name: "U14 Girls" } as never);
});

async function openForm(onCreated = vi.fn()) {
  const user = userEvent.setup();
  renderWithProviders(<AdminAddTeam organizationId="club-1" organizationName="Alpha Club" onCreated={onCreated} />);
  await user.click(screen.getByRole("button", { name: "Add team to Alpha Club" }));
  return { user, onCreated, input: screen.getByRole("textbox", { name: "Team name" }) };
}

describe("admin quick team creation", () => {
  it("creates a trimmed team in the selected organization and stays ready for another", async () => {
    const { user, input, onCreated } = await openForm();
    expect(input).toHaveFocus();
    expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();
    await user.type(input, "  U14 Girls  ");
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("status")).toHaveTextContent("Added U14 Girls.");
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/organizations/club-1/teams", expect.objectContaining({
      method: "POST", body: JSON.stringify({ name: "U14 Girls" }),
    }));
    expect(onCreated).toHaveBeenCalledWith({ id: "team-1", name: "U14 Girls" });
    expect(input).toHaveValue("");
    expect(input).toHaveFocus();
    fetchMock.mockResolvedValueOnce({ id: "team-2", name: "U16 Boys" } as never);
    await user.type(input, "U16 Boys");
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Added U16 Boys.");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps the name and shows server errors, then allows retry", async () => {
    fetchMock.mockRejectedValueOnce(new Error("Your Starter plan allows up to 15 teams."));
    const { user, input, onCreated } = await openForm();
    await user.type(input, "U14 Girls");
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("allows up to 15 teams");
    expect(input).toHaveValue("U14 Girls");
    expect(onCreated).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Added U14 Girls.");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("blocks duplicate submissions and closing while a request is pending", async () => {
    let finish!: (value: unknown) => void;
    fetchMock.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }) as never);
    const { user, input } = await openForm();
    await user.type(input, "U14 Girls");
    await user.click(screen.getByRole("button", { name: "Add" }));
    const button = screen.getByRole("button", { name: "Adding…" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(input).toBeDisabled();
    expect(screen.getByRole("button", { name: "Done" })).toBeDisabled();
    await user.click(button);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => finish({ id: "team-1", name: "U14 Girls" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Added U14 Girls.");
  });

  it("does not submit blank names and allows closing without saving", async () => {
    const { user, input } = await openForm();
    await user.type(input, "   ");
    await user.keyboard("{Enter}");
    expect(fetchMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add team to Alpha Club" }));
    expect(screen.getByRole("textbox", { name: "Team name" })).toHaveValue("");
  });
});
