import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { createTestQueryClient, renderWithProviders } from "@/test";
import { getMockLocation, wouterMock } from "@/test/mocks/wouter";
import { toastSpy, useToastMock } from "@/test/mocks/toast";

const { create, me } = vi.hoisted(() => ({
  create: vi.fn(),
  me: { id: "creator", role: "parent" },
}));
vi.mock("wouter", () => wouterMock);
vi.mock("@/hooks/use-toast", () => useToastMock);
// Test creation state, not Radix's pointer/portal implementation (JSDOM
// does not implement pointer capture).
vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, children }: {
    value: string; onValueChange: (value: string) => void; children: ReactNode;
  }) => <select value={value} onChange={(event) => onValueChange(event.target.value)}>{children}</select>,
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: ReactNode }) =>
    <option value={value}>{children}</option>,
}));
vi.mock("@workspace/api-client-react", () => ({
  useCreateOrganization: () => ({ mutateAsync: create, isPending: false }),
  useGetLoggedInUser: () => ({ data: me }),
  getListOrganizationsQueryKey: () => ["organizations"],
  getListUserOrganizationsQueryKey: (id: string) => ["user-organizations", id],
  getGetOrganizationByIdQueryKey: (id: string) => ["organization", id],
}));
import { CreateOrgDialog } from "./CreateOrgDialog";

afterEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
});

describe("CreateOrgDialog ownership", () => {
  it.each(["parent", "admin"])("confirms committed ownership and preserves onboarding for a %s", async (role) => {
    me.role = role;
    const org = {
      id: "new-org", name: "Personal Club",
      role: "owner", isMember: true, isFollowing: true, hasOwner: true,
    };
    create.mockResolvedValue(org);
    const closed = vi.fn();
    const user = userEvent.setup();
    const queryClient = createTestQueryClient();
    // The shared test client uses gcTime: 0; keep the new, not-yet-observed
    // detail cache long enough to verify navigation state.
    queryClient.setDefaultOptions({ queries: { retry: false, gcTime: Infinity } });
    renderWithProviders(
      <CreateOrgDialog open onOpenChange={closed} />,
      { queryClient },
    );
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    await user.type(screen.getByTestId("input-org-name"), org.name);
    await user.type(screen.getByTestId("input-org-city"), "Westfield");
    await user.type(screen.getByTestId("input-org-zip"), "07090");
    await user.selectOptions(screen.getAllByRole("combobox")[0], "NJ");
    fireEvent.submit(screen.getByTestId("input-org-name").closest("form")!);
    await waitFor(() => expect(closed).toHaveBeenCalledWith(false));
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ name: org.name, city: "Westfield", state: "NJ", zipCode: "07090" }),
    });
    expect(queryClient.getQueryData(["organization", org.id])).toEqual(org);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["organizations"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["user-organizations", me.id] });
    expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({
      description: "You're the owner. Add admins or transfer ownership any time from Manage members.",
    }));
    expect(sessionStorage.getItem(`kinectem:pre-invite-org:${org.id}`)).toBe("1");
    expect(sessionStorage.getItem(`kinectem:welcome-org:${org.id}`)).toBe(org.name);
    expect(sessionStorage.getItem(`kinectem:ownership-handoff:${org.id}`)).toBeNull();
    expect(getMockLocation()).toBe(`/organizations/${org.id}/subscribe`);
  });
});