import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FamilySetup, type FamilySetupProps } from "./FamilySetup";

const fetchMock = vi.fn();
vi.mock("@workspace/api-client-react", () => ({ customFetch: (...a: unknown[]) => fetchMock(...a) }));
vi.mock("@/components/UserAvatar", () => ({ UserAvatar: () => <span /> }));

function setup(verifyAccount?: () => Promise<void>, props: Partial<FamilySetupProps> = {}) {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <FamilySetup userId="u1" mode="family" onDone={() => {}} verifyAccount={verifyAccount} {...props} />
    </QueryClientProvider>,
  );
}

describe("FamilySetup", () => {
  beforeEach(() => { sessionStorage.clear(); fetchMock.mockReset(); });
  it.each(["new", "existing"])("names the team and organization at optional parent, %s-child and completion steps", async (kind) => {
    const child = { id: "c1", firstName: "Ava", lastName: "Lee", avatarUrl: null };
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method === "POST" ? { child } : { data: kind === "existing" ? [child] : [] });
    setup(undefined, { mode: "team", token: "invite-a", teamName: "Team A", organizationName: "Club A" });
    expect(screen.getByTestId("team-setup-context")).toHaveTextContent("You are adding a child to Team A. Only add children who play on this team.");
    expect(screen.getByTestId("team-setup-context")).toHaveTextContent("Organization: Club A");
    fireEvent.click(screen.getByTestId("btn-coparent-skip"));
    expect(screen.getByTestId("step-player")).toHaveTextContent("Choose or create a child for Team A’s roster");
    const guidance = screen.getByTestId("other-team-guidance");
    expect(guidance).toHaveTextContent("Finish adding your child to this team, then open the other team’s invitation.");
    expect(guidance).toHaveTextContent("same parent account");
    expect(guidance).toHaveTextContent("Choose your child’s existing account");
    expect(guidance).toHaveTextContent("All your children appear together in Family");
    expect(guidance).toHaveTextContent("must accept a family invitation");
    expect(guidance.querySelectorAll("ol > li")).toHaveLength(3);
    expect(guidance).not.toHaveTextContent("Tap Done below");
    expect(screen.getByRole("link", { name: "Already created a duplicate child?" })).toHaveAttribute("href", "/family?help=duplicate-child");
    if (kind === "existing") {
      const select = await screen.findByTestId("btn-select-child-c1");
      expect(select).toHaveTextContent("Add to Team A’s roster");
      expect(screen.getByTestId("btn-show-create-child-form")).toHaveTextContent("Create a new child for Team A’s roster");
      fireEvent.click(select);
      await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/v1/invites/invite-a/children", expect.objectContaining({ body: JSON.stringify({ childId: "c1" }) })));
    } else {
      await screen.findByTestId("input-child-first");
      expect(screen.getByTestId("btn-add-child")).toHaveTextContent("Create child’s account & add to Team A’s roster");
      fireEvent.change(screen.getByTestId("input-child-first"), { target: { value: "Ava" } });
      fireEvent.change(screen.getByTestId("input-child-last"), { target: { value: "Lee" } });
      fireEvent.click(screen.getByTestId("btn-add-child"));
    }
    expect(await screen.findByTestId("row-added-child")).toHaveTextContent("Added to Team A’s roster");
    expect(screen.getByTestId("btn-finish-setup")).toHaveTextContent("Done, continue to Team A");
    expect(screen.getByTestId("other-team-guidance")).toHaveTextContent("Tap Done below, then open the other team’s invitation.");
    expect(screen.getByTestId("other-team-guidance")).toHaveTextContent("No new parent account needed.");
    expect(screen.getByTestId("other-team-guidance")).not.toHaveTextContent("Finish adding your child");
  });

  it("keeps standalone Family profile creation separate from roster enrollment", async () => {
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => init?.method === "POST"
      ? { child: { id: "c1", firstName: "Ava", lastName: "Lee" } } : { data: [] });
    setup();
    expect(screen.getByTestId("family-profile-only")).toHaveTextContent("does not add them to a team");
    fireEvent.click(screen.getByTestId("btn-coparent-skip"));
    await screen.findByTestId("input-child-first");
    fireEvent.change(screen.getByTestId("input-child-first"), { target: { value: "Ava" } });
    fireEvent.change(screen.getByTestId("input-child-last"), { target: { value: "Lee" } });
    fireEvent.click(screen.getByTestId("btn-add-child"));
    expect(await screen.findByTestId("row-added-child")).toHaveTextContent("Ready in Family — not added to a team");
  });

  it("does not submit to an unnamed team", async () => {
    fetchMock.mockResolvedValue({ data: [] });
    setup(undefined, { mode: "team", token: "unknown" });
    expect(screen.getByTestId("team-setup-context")).toHaveTextContent("has not been verified yet");
    fireEvent.click(screen.getByTestId("btn-coparent-skip"));
    expect(await screen.findByTestId("btn-add-child")).toBeDisabled();
  });
  it("blocks player creation if the adult session changes before submission", async () => {
    fetchMock.mockResolvedValue({ data: [] });
    const verify = vi.fn().mockRejectedValue(new Error("Your account changed"));
    setup(verify);
    fireEvent.click(screen.getByTestId("btn-coparent-skip"));
    await screen.findByTestId("input-child-first");
    fireEvent.change(screen.getByTestId("input-child-first"), { target: { value: "Ava" } });
    fireEvent.change(screen.getByTestId("input-child-last"), { target: { value: "Lee" } });
    fireEvent.click(screen.getByTestId("btn-add-child"));
    await screen.findByText("Your account changed");
    expect(verify).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });
  it("blocks selecting a child if the adult session is no longer verified", async () => {
    fetchMock.mockResolvedValue({ data: [{ id: "existing", firstName: "Ava", lastName: "Lee" }] });
    setup(vi.fn().mockRejectedValue(new Error("Your account changed")));
    fireEvent.click(screen.getByTestId("btn-coparent-skip"));
    fireEvent.click(await screen.findByTestId("btn-select-child-existing"));
    await screen.findByText("Your account changed");
    expect(screen.queryByTestId("step-done")).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });

  it("shows step 2 guidance without repeating the step 1 coordination reminder", () => {
    fetchMock.mockResolvedValue({ data: [] });
    setup();
    expect(screen.queryByTestId("note-coordinate-first")).not.toBeInTheDocument();
    expect(screen.getByTestId("step-coparent")).toBeInTheDocument();
    expect(screen.getByTestId("coparent-invite-explainer")).toHaveTextContent("does not create their account or send an invitation yet");
    expect(screen.getByTestId("coparent-invite-explainer")).toHaveTextContent("After you finish Step 3:");
    expect(screen.getByTestId("coparent-invite-explainer")).toHaveTextContent("the other parent you added in Step 2");
    expect(screen.queryByTestId("note-check-other-parent")).not.toBeInTheDocument();
    expect(screen.getByTestId("coparent-invite-explainer")).toHaveTextContent("separate logins connected to the same child");
    expect(screen.queryByTestId("step-checkpoint")).not.toBeInTheDocument();
    expect(screen.queryByTestId("btn-other-parent-yes")).not.toBeInTheDocument();
    expect(screen.getByTestId("input-coparent-first")).toBeInTheDocument();
  });

  it("only sends the other-parent invitation after the child account exists", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith("/family/setup/children")) return { child: { id: "c1", firstName: "Ava", lastName: "Lee", avatarUrl: null } };
      if (url.endsWith("/guardians/invite")) return { id: "g1", emailSent: true };
      return { data: [] };
    });
    setup();
    fireEvent.change(screen.getByTestId("input-coparent-first"), { target: { value: "Sam" } });
    fireEvent.change(screen.getByTestId("input-coparent-last"), { target: { value: "Lee" } });
    fireEvent.change(screen.getByTestId("input-coparent-email"), { target: { value: "sam@example.com" } });
    fireEvent.click(screen.getByTestId("btn-coparent-continue"));
    expect(await screen.findByTestId("input-child-first")).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/guardians/invite"))).toBe(false);
    fireEvent.change(screen.getByTestId("input-child-first"), { target: { value: "Ava" } });
    fireEvent.change(screen.getByTestId("input-child-last"), { target: { value: "Lee" } });
    fireEvent.click(screen.getByTestId("btn-add-child"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/v1/users/c1/guardians/invite", expect.objectContaining({
      method: "POST", body: expect.stringContaining("sam@example.com"),
    })));
    expect(screen.getByTestId("step-done")).toBeInTheDocument();
  });

  it("skips the other parent, then reuses one request id and shows duplicate warning", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    fetchMock.mockImplementation(async (url: string, init?: { body?: string }) => {
      if (url.includes("/me/children")) return { data: [] };
      bodies.push(JSON.parse(init!.body!));
      if (bodies.length === 1) throw Object.assign(new Error("dup"), { status: 409, data: { code: "POSSIBLE_DUPLICATE" } });
      return { child: { id: "c1", firstName: "Ava", lastName: "Lee", avatarUrl: null } };
    });
    setup();
    fireEvent.click(screen.getByTestId("btn-coparent-skip"));
    await screen.findByTestId("input-child-first");
    expect(screen.queryByTestId("note-check-other-parent")).not.toBeInTheDocument();
    fireEvent.change(screen.getByTestId("input-child-first"), { target: { value: "Ava" } });
    fireEvent.change(screen.getByTestId("input-child-last"), { target: { value: "Lee" } });
    fireEvent.click(screen.getByTestId("btn-add-child"));
    await screen.findByTestId("warning-possible-duplicate");
    fireEvent.click(screen.getByTestId("btn-confirm-distinct"));
    await waitFor(() => expect(screen.getByTestId("step-done")).toBeInTheDocument());
    expect(bodies[1].confirmDistinctPlayer).toBe(true);
    expect(bodies[1].setupRequestId).toBe(bodies[0].setupRequestId);
  });

  it("does not treat a failed family load as empty", async () => {
    fetchMock.mockRejectedValue(new Error("down"));
    setup();
    fireEvent.click(screen.getByTestId("btn-coparent-skip"));
    await screen.findByTestId("error-children-load");
    expect(screen.queryByTestId("form-new-player")).toBeNull();
  });

  it("retries the original name when an in-flight creation has no receipt yet", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    let commitFirst!: () => void;
    const firstStillRunning = new Promise<void>((resolve) => { commitFirst = resolve; });
    let receiptReady = false;
    let receiptChecks = 0;
    const child = { id: "original-child", firstName: "Ava", lastName: "Lee", avatarUrl: null };
    fetchMock.mockImplementation(async (url: string, init?: { body?: string }) => {
      if (url.includes("/me/children")) return { data: receiptReady ? [child] : [] };
      if (url.includes("/setup/requests/")) {
        receiptChecks++;
        if (!receiptReady) throw Object.assign(new Error("not committed yet"), { status: 404 });
        return { child };
      }
      bodies.push(JSON.parse(init!.body!));
      if (bodies.length === 1) throw new Error("Creation response lost while server is still running");
      await firstStillRunning;
      receiptReady = true;
      return { child };
    });
    setup();
    fireEvent.click(screen.getByTestId("btn-coparent-skip"));
    await screen.findByTestId("input-child-first");
    fireEvent.change(screen.getByTestId("input-child-first"), { target: { value: "Ava" } });
    fireEvent.change(screen.getByTestId("input-child-last"), { target: { value: "Lee" } });
    fireEvent.click(screen.getByTestId("btn-add-child"));
    await screen.findByText("Creation response lost while server is still running");
    fireEvent.change(screen.getByTestId("input-child-first"), { target: { value: "Avery" } });
    fireEvent.click(screen.getByTestId("btn-add-child"));
    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(receiptChecks).toBe(1);
    expect(bodies[1].firstName).toBe("Ava");
    expect(bodies[1].setupRequestId).toBe(bodies[0].setupRequestId);
    commitFirst();
    await screen.findByTestId("step-done");
    expect(screen.getByTestId("step-done")).toHaveTextContent("Ava Lee");
  });

  it("recovers a committed child after a changed-name request-id conflict", async () => {
    const child = { id: "original-child", firstName: "Ava", lastName: "Lee", avatarUrl: null };
    let conflict = false;
    const bodies: Array<Record<string, unknown>> = [];
    fetchMock.mockImplementation(async (url: string, init?: { body?: string }) => {
      if (url.includes("/me/children")) return { data: [] };
      if (url.includes("/setup/requests/")) {
        if (!conflict) throw Object.assign(new Error("not committed yet"), { status: 404 });
        return { child };
      }
      bodies.push(JSON.parse(init!.body!));
      if (bodies.length === 1) throw new Error("Network response lost");
      conflict = true;
      throw Object.assign(new Error("Request already committed"), { status: 409, data: { code: "SETUP_REQUEST_REUSED" } });
    });
    setup();
    fireEvent.click(screen.getByTestId("btn-coparent-skip"));
    await screen.findByTestId("input-child-first");
    fireEvent.change(screen.getByTestId("input-child-first"), { target: { value: "Ava" } });
    fireEvent.change(screen.getByTestId("input-child-last"), { target: { value: "Lee" } });
    fireEvent.click(screen.getByTestId("btn-add-child"));
    await screen.findByText("Network response lost");
    fireEvent.change(screen.getByTestId("input-child-first"), { target: { value: "Avery" } });
    fireEvent.click(screen.getByTestId("btn-add-child"));
    await screen.findByTestId("step-done");
    expect(screen.getByTestId("step-done")).toHaveTextContent("Ava Lee");
    expect(bodies).toHaveLength(2);
    expect(bodies[1].setupRequestId).toBe(bodies[0].setupRequestId);
  });
});
