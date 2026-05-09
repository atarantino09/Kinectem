import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { PrivateUserResponse } from "@workspace/api-client-react";

const mutateMock = vi.fn();
const toastMock = vi.fn();

vi.mock("@workspace/api-client-react", async () => {
  const actual = await vi.importActual<
    typeof import("@workspace/api-client-react")
  >("@workspace/api-client-react");
  return {
    ...actual,
    useUpdateUser: () => ({ mutate: mutateMock }),
  };
});

vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual<
    typeof import("@tanstack/react-query")
  >("@tanstack/react-query");
  return {
    ...actual,
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  };
});

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

vi.mock("@/components/ImageCropDialog", () => ({
  ImageCropDialog: () => null,
}));

import { EditProfileDialog } from "./EditProfileDialog";

function makeUser(
  overrides: Partial<PrivateUserResponse> = {},
): PrivateUserResponse {
  return {
    id: "user-1",
    firstName: "Marcus",
    lastName: "Rivera",
    bio: null,
    city: null,
    state: null,
    avatarUrl: null,
    coverPhotoUrl: null,
    isOwnProfile: true,
    isFollowing: false,
    isConnection: false,
    isMinor: false,
    followerCount: 0,
    followingCount: 0,
    dateOfBirth: null,
    dateOfBirthVisibility: "private",
    email: "marcus@example.com",
    role: "athlete",
    accountStatus: "active",
    parentId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  } as PrivateUserResponse;
}

describe("EditProfileDialog — birthday + visibility (Task #431)", () => {
  beforeEach(() => {
    mutateMock.mockReset();
    toastMock.mockReset();
  });

  it("disables the visibility dropdown when no date is set", () => {
    render(<EditProfileDialog user={makeUser()} open onOpenChange={() => {}} />);
    expect(screen.getByTestId("input-profile-dob-visibility")).toBeDisabled();
  });

  it("auto-resets visibility to private if the date input is cleared", () => {
    render(
      <EditProfileDialog
        user={makeUser({
          dateOfBirth: "2010-05-09",
          dateOfBirthVisibility: "public",
        })}
        open
        onOpenChange={() => {}}
      />,
    );
    const trigger = screen.getByTestId("input-profile-dob-visibility");
    expect(trigger).not.toBeDisabled();
    expect(trigger).toHaveTextContent("Everyone");
    fireEvent.change(screen.getByTestId("input-profile-dob"), {
      target: { value: "" },
    });
    expect(trigger).toBeDisabled();
    expect(trigger).toHaveTextContent("Only me");
  });

  it("never PATCHes a non-private visibility when the date is empty", () => {
    // Repro of the original bug: user starts with date + "Everyone",
    // clears the date, then saves. With the fix the auto-reset effect
    // forces visibility back to "private" before save, so the PATCH
    // can never carry the inconsistent { dateOfBirth: null,
    // dateOfBirthVisibility: "public" } pair that caused the bug.
    render(
      <EditProfileDialog
        user={makeUser({
          dateOfBirth: "2010-05-09",
          dateOfBirthVisibility: "public",
        })}
        open
        onOpenChange={() => {}}
      />,
    );
    fireEvent.change(screen.getByTestId("input-profile-dob"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByTestId("button-save-profile"));
    expect(mutateMock).toHaveBeenCalledTimes(1);
    const payload = mutateMock.mock.calls[0][0];
    expect(payload.data.dateOfBirth).toBeNull();
    expect(payload.data.dateOfBirthVisibility).toBe("private");
  });

  it("sends both fields when the date is valid and visibility is set", () => {
    render(
      <EditProfileDialog
        user={makeUser({
          dateOfBirth: "2010-05-09",
          dateOfBirthVisibility: "public",
        })}
        open
        onOpenChange={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId("button-save-profile"));
    expect(mutateMock).toHaveBeenCalledTimes(1);
    const payload = mutateMock.mock.calls[0][0];
    expect(payload.data.dateOfBirth).toBe("2010-05-09");
    expect(payload.data.dateOfBirthVisibility).toBe("public");
  });
});
