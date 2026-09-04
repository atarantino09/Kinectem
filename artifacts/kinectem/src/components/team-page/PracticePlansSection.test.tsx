import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test";
import { PracticePlansSection } from "./PracticePlansSection";
import * as usePracticePlansModule from "@/hooks/use-practice-plans";

const { customFetchMock } = vi.hoisted(() => ({
  customFetchMock: vi.fn(),
}));

vi.mock("@workspace/api-client-react", () => ({
  customFetch: customFetchMock,
}));

// We'll mock the hook layer to simulate loading, errors, and data state for reading,
// but for mutations, we can let them use customFetchMock by using the real hook logic 
// or by mocking the mutations too. Using the real hooks for mutations lets us verify customFetch calls.
// Actually, it's easier to mock the whole hook module and track `mutateAsync`.
const mockUseList = vi.spyOn(usePracticePlansModule, "useListPracticePlans");
const mockUseCreate = vi.spyOn(usePracticePlansModule, "useCreatePracticePlan");
const mockUseUpdate = vi.spyOn(usePracticePlansModule, "useUpdatePracticePlan");

describe("PracticePlansSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseCreate.mockReturnValue({ isPending: false, mutateAsync: vi.fn() } as any);
    mockUseUpdate.mockReturnValue({ isPending: false, mutateAsync: vi.fn() } as any);
  });

  it("renders nothing when viewer cannot view schedule", () => {
    renderWithProviders(<PracticePlansSection teamId="t1" canManage={false} canView={false} />);
    expect(screen.queryByTestId("practice-plans-section")).not.toBeInTheDocument();
  });

  it("shows loading and error states for a viewer", () => {
    mockUseList.mockReturnValue({ isLoading: true, data: undefined, isError: false, refetch: vi.fn() } as any);
    const { rerender } = renderWithProviders(<PracticePlansSection teamId="t1" canManage={false} canView={true} />);
    expect(screen.queryByTestId("btn-new-practice-plan")).not.toBeInTheDocument();
    
    mockUseList.mockReturnValue({ isLoading: false, data: undefined, isError: true, refetch: vi.fn() } as any);
    rerender(<PracticePlansSection teamId="t1" canManage={false} canView={true} />);
    expect(screen.getByText("Could not load practice plans.")).toBeInTheDocument();
  });

  it("shows empty state and allows manager to open composer", async () => {
    const user = userEvent.setup();
    mockUseList.mockReturnValue({ isLoading: false, data: [], isError: false, refetch: vi.fn() } as any);
    
    renderWithProviders(<PracticePlansSection teamId="t1" canManage={true} canView={true} />);
    expect(screen.getByText("No practice plans yet.")).toBeInTheDocument();

    const newBtn = screen.getByTestId("btn-new-practice-plan");
    await user.click(newBtn);

    // Form appears
    expect(screen.getByTestId("practice-plan-privacy-copy")).toHaveTextContent("Private team update");
    expect(screen.getByText(/players, and parents can see it/i)).toBeInTheDocument();
    expect(screen.getByTestId("practice-plan-title")).toBeInTheDocument();
  });

  it("submits a new practice plan correctly", async () => {
    const user = userEvent.setup();
    mockUseList.mockReturnValue({ isLoading: false, data: [], isError: false, refetch: vi.fn() } as any);
    const createMutate = vi.fn().mockResolvedValue({});
    mockUseCreate.mockReturnValue({ isPending: false, mutateAsync: createMutate } as any);
    
    renderWithProviders(<PracticePlansSection teamId="t1" canManage={true} canView={true} />);
    
    await user.click(screen.getByTestId("btn-new-practice-plan"));
    
    await user.type(screen.getByTestId("practice-plan-title"), "Defense Day");
    await user.type(screen.getByTestId("practice-plan-body"), "Drill 1, Drill 2");
    await user.type(screen.getByTestId("practice-plan-date-0"), "2026-09-08");
    await user.click(screen.getByTestId("practice-plan-add-date"));
    await user.type(screen.getByTestId("practice-plan-date-1"), "2026-09-10");
    
    await user.click(screen.getByTestId("practice-plan-save-draft"));

    await waitFor(() => {
      expect(createMutate).toHaveBeenCalledWith({
        teamId: "t1",
        data: {
          title: "Defense Day",
          body: "Drill 1, Drill 2",
          practiceDates: ["2026-09-08", "2026-09-10"],
          status: "draft",
        }
      });
    });
  });

  it("submits AI assist with proper payload", async () => {
    const user = userEvent.setup();
    mockUseList.mockReturnValue({ isLoading: false, data: [], isError: false, refetch: vi.fn() } as any);
    customFetchMock.mockResolvedValue({ text: "AI generated text" });
    
    renderWithProviders(<PracticePlansSection teamId="t1" canManage={true} canView={true} />);
    await user.click(screen.getByTestId("btn-new-practice-plan"));
    
    await user.type(screen.getByTestId("practice-plan-title"), "Tuesday");
    await user.type(screen.getByTestId("practice-plan-body"), "Rough notes");
    
    await user.click(screen.getByTestId("practice-plan-ai-assist"));

    await waitFor(() => {
      expect(customFetchMock).toHaveBeenCalledWith("/api/v1/ai/assist", expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          mode: "draft",
          postType: "long",
          notes: "Rough notes",
          title: "Tuesday",
          teamId: "t1",
          practicePlan: true
        })
      }));
    });
    
    // Check if body updated
    expect(screen.getByTestId("practice-plan-body")).toHaveValue("AI generated text");
  });

  it("allows editing an existing plan", async () => {
    const user = userEvent.setup();
    mockUseList.mockReturnValue({ 
      isLoading: false, 
      data: [{ id: "p1", title: "Old Title", body: "Old Body", practiceDates: ["2026-09-08"], status: "draft", createdAt: new Date().toISOString() }],
      isError: false, 
      refetch: vi.fn() 
    } as any);
    const updateMutate = vi.fn().mockResolvedValue({});
    mockUseUpdate.mockReturnValue({ isPending: false, mutateAsync: updateMutate } as any);
    
    renderWithProviders(<PracticePlansSection teamId="t1" canManage={true} canView={true} />);
    
    // Click edit on the card
    await user.click(screen.getByTestId("btn-edit-practice-plan-p1"));
    
    const titleInput = screen.getByTestId("practice-plan-title");
    expect(titleInput).toHaveValue("Old Title");
    
    await user.clear(titleInput);
    await user.type(titleInput, "New Title");
    await user.click(screen.getByTestId("practice-plan-submit"));

    await waitFor(() => {
      expect(updateMutate).toHaveBeenCalledWith({
        teamId: "t1",
        planId: "p1",
        data: { title: "New Title", body: "Old Body", practiceDates: ["2026-09-08"], status: "published" }
      });
    });
  });
});
