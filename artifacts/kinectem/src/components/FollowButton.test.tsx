import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FollowButton } from "./FollowButton";

describe("visible follow button", () => {
  it("combines the action and count and switches to unfollow after the state updates", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    const props = { pending: false, onToggle, testId: "follow-control" };
    const { rerender } = render(<FollowButton {...props} isFollowing={false} followerCount={0} />);
    const button = screen.getByRole("button", { name: "Follow · 0 followers" });
    expect(button).toHaveAttribute("aria-pressed", "false");
    await user.click(button);
    expect(onToggle).toHaveBeenCalledTimes(1);
    rerender(<FollowButton {...props} isFollowing followerCount={1} />);
    expect(button).toHaveAccessibleName("Unfollow · 1 follower");
    expect(button).toHaveAttribute("aria-pressed", "true");
    await user.click(button);
    expect(onToggle).toHaveBeenCalledTimes(2);
    rerender(<FollowButton {...props} isFollowing={false} followerCount={0} />);
    expect(button).toHaveAccessibleName("Follow · 0 followers");
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it.each([true, false])("blocks repeat clicks while the request is pending (following=%s)", async (isFollowing) => {
    const onToggle = vi.fn();
    render(<FollowButton isFollowing={isFollowing} followerCount={5} pending onToggle={onToggle} testId="follow-control" />);
    const button = screen.getByRole("button");
    expect(button).toBeDisabled();
    await userEvent.click(button);
    expect(onToggle).not.toHaveBeenCalled();
  });
});
