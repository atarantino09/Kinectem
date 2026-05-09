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

describe("EditProfileDialog — birthday + visibility (Tasks #431/#432)", () => {
  beforeEach(() => {
    mutateMock.mockReset();
    toastMock.mockReset();
  });

  it("keeps the visibility dropdown clickable even when no date is set (#432)", () => {
    render(<EditProfileDialog user={makeUser()} open onOpenChange={() => {}} />);
    expect(screen.getByTestId("input-profile-dob-visibility")).not.toBeDisabled();
    expect(
      screen.queryByTestId("hint-profile-dob-visibility"),
    ).not.toBeInTheDocument();
  });

  it("does not auto-reset visibility when the date is cleared (#432)", () => {
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
    expect(trigger).toHaveTextContent("Everyone");
    fireEvent.change(screen.getByTestId("input-profile-dob"), {
      target: { value: "" },
    });
    expect(trigger).not.toBeDisabled();
    expect(trigger).toHaveTextContent("Everyone");
  });

  it("guards onSave: empty date + non-private visibility shows inline error and skips PATCH", () => {
    render(
      <EditProfileDialog
        user={makeUser({
          dateOfBirth: null,
          dateOfBirthVisibility: "public",
        })}
        open
        onOpenChange={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId("button-save-profile"));
    expect(mutateMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("error-profile-dob")).toHaveTextContent(
      "Add a birthday before sharing it.",
    );
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
