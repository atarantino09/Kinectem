import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FamilySetup } from "./FamilySetup";

const fetchMock = vi.fn();
vi.mock("@workspace/api-client-react", () => ({ customFetch: (...a: unknown[]) => fetchMock(...a) }));
vi.mock("wouter", () => ({ Link: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));
vi.mock("@/components/UserAvatar", () => ({ UserAvatar: () => <span /> }));

function setup() {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <FamilySetup userId="u1" mode="family" onDone={() => {}} />
    </QueryClientProvider>,
  );
}

describe("FamilySetup", () => {
  beforeEach(() => { sessionStorage.clear(); fetchMock.mockReset(); });

  it("shows coordinate copy, steps and guidance when the other parent already did it", () => {
    fetchMock.mockResolvedValue({ data: [] });
    setup();
    expect(screen.getByTestId("note-coordinate-first")).toHaveTextContent("only needs one profile");
    fireEvent.click(screen.getByTestId("btn-other-parent-yes"));
    expect(screen.getByTestId("guidance-other-parent-created")).toHaveTextContent("family invitation");
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
    fireEvent.click(screen.getByTestId("btn-other-parent-no"));
    fireEvent.click(screen.getByTestId("btn-coparent-skip"));
    await screen.findByTestId("note-check-other-parent");
    await screen.findByTestId("input-child-first");
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
    fireEvent.click(screen.getByTestId("btn-other-parent-no"));
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
    fireEvent.click(screen.getByTestId("btn-other-parent-no"));
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
    fireEvent.click(screen.getByTestId("btn-other-parent-no"));
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
