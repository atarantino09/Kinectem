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

  it("renders Month/Day/Year selects pre-filled from the user's existing DOB (#432)", () => {
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
    expect(screen.getByTestId("input-profile-dob-month")).toHaveTextContent(
      "May",
    );
    expect(screen.getByTestId("input-profile-dob-day")).toHaveTextContent("9");
    expect(screen.getByTestId("input-profile-dob-year")).toHaveTextContent(
      "2010",
    );
  });

  it("blocks save when only some birthday parts are picked (#432)", () => {
    render(<EditProfileDialog user={makeUser()} open onOpenChange={() => {}} />);
    fireEvent.click(screen.getByTestId("input-profile-dob-month"));
    fireEvent.click(screen.getByTestId("option-profile-dob-month-05"));
    fireEvent.click(screen.getByTestId("button-save-profile"));
    expect(mutateMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("error-profile-dob")).toHaveTextContent(
      "Pick a month, day, and year.",
    );
  });

  it("composes YYYY-MM-DD from the three selects and sends it (#432)", () => {
    render(<EditProfileDialog user={makeUser()} open onOpenChange={() => {}} />);
    fireEvent.click(screen.getByTestId("input-profile-dob-month"));
    fireEvent.click(screen.getByTestId("option-profile-dob-month-05"));
    fireEvent.click(screen.getByTestId("input-profile-dob-day"));
    fireEvent.click(screen.getByTestId("option-profile-dob-day-09"));
    fireEvent.click(screen.getByTestId("input-profile-dob-year"));
    fireEvent.click(screen.getByTestId("option-profile-dob-year-2010"));
    fireEvent.click(screen.getByTestId("button-save-profile"));
    expect(mutateMock).toHaveBeenCalledTimes(1);
    expect(mutateMock.mock.calls[0][0].data.dateOfBirth).toBe("2010-05-09");
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

  it("user-flow: opens with empty DOB, picks Everyone, save is blocked with inline error (#432)", () => {
    // Reproduces the real user flow Marcus hit: dialog opens with no
    // DOB on file, the dropdown is now clickable (#432), they pick a
    // tier without a date, and the save guard catches it.
    render(<EditProfileDialog user={makeUser()} open onOpenChange={() => {}} />);
    const trigger = screen.getByTestId("input-profile-dob-visibility");
    expect(trigger).not.toBeDisabled();
    fireEvent.click(trigger);
    fireEvent.click(
      screen.getByTestId("option-profile-dob-visibility-public"),
    );
    expect(trigger).toHaveTextContent("Everyone");
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
