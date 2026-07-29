import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// AI Assist dialog @-mention support (task #823): the notes and
// suggestion boxes use the same MentionTextarea as the recap body, so
// typing "@" opens the roster picker; picked names live as canonical
// @[Name](user:id) tokens in state while the AI prompt gets the
// readable "@Name" form.

const customFetchMock = vi.fn<
  (url: string, options?: RequestInit) => Promise<unknown>
>(async () => ({ text: "Great win!" }));
const toastMock = vi.fn();

vi.mock("@workspace/api-client-react", () => ({
  customFetch: (...args: unknown[]) =>
    (customFetchMock as unknown as (...a: unknown[]) => Promise<unknown>)(
      ...args,
    ),
}));
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));
vi.mock("@/hooks/useWhoami", () => ({
  useWhoami: () => ({ data: { canAuthorRecap: true } }),
}));

import { AiAssistButton } from "./AiAssistButton";

const AVERY_ID = "11111111-2222-3333-4444-555555555555";
const roster = [
  { userId: AVERY_ID, displayName: "Avery Tarantino", avatarUrl: null },
];

function setup(onInsert = vi.fn()) {
  render(
    <AiAssistButton
      postType="long"
      body=""
      onInsert={onInsert}
      rosterMembers={roster}
    />,
  );
  return onInsert;
}

beforeEach(() => {
  customFetchMock.mockReset();
  customFetchMock.mockResolvedValue({ text: "Great win!" });
  toastMock.mockReset();
});

describe("AiAssistButton mentions", () => {
  it("typing @ in the notes opens the roster picker and picking tokenizes", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByTestId("button-ai-assist"));
    const notes = screen.getByTestId("textarea-ai-notes");
    await user.type(notes, "Big game from @Av");
    const option = await screen.findByTestId(`option-mention-${AVERY_ID}`);
    await user.click(option);
    // Author sees the friendly form…
    expect((notes as HTMLTextAreaElement).value).toContain("@Avery Tarantino");

    // …and the AI request gets plain "@Name", never raw token syntax.
    await user.click(screen.getByTestId("button-ai-generate"));
    await waitFor(() => expect(customFetchMock).toHaveBeenCalledTimes(1));
    const body = JSON.parse(
      (customFetchMock.mock.calls[0][1]?.body as string) ?? "{}",
    );
    expect(body.notes).toContain("@Avery Tarantino");
    expect(body.notes).not.toContain("](user:");
  });

  it("locks the notes box while a generate request is in flight", async () => {
    const user = userEvent.setup();
    let release: (v: { text: string }) => void = () => {};
    customFetchMock.mockImplementationOnce(
      () => new Promise((resolve) => (release = resolve)),
    );
    setup();
    await user.click(screen.getByTestId("button-ai-assist"));
    const notes = screen.getByTestId("textarea-ai-notes");
    await user.type(notes, "won 3-2");
    await user.click(screen.getByTestId("button-ai-generate"));
    expect(notes).toBeDisabled();
    release({ text: "Great win!" });
    await waitFor(() => expect(notes).not.toBeDisabled());
  });

  it("mentions added to the suggestion insert canonical tokens into the post", async () => {
    const user = userEvent.setup();
    const onInsert = setup();
    await user.click(screen.getByTestId("button-ai-assist"));
    await user.type(screen.getByTestId("textarea-ai-notes"), "won 3-2");
    await user.click(screen.getByTestId("button-ai-generate"));
    const result = await screen.findByTestId("textarea-ai-result");
    await user.type(result, " Shoutout @Avery Tarantino");
    await user.click(screen.getByTestId("button-ai-insert"));
    expect(onInsert).toHaveBeenCalledWith(
      `Great win! Shoutout @[Avery Tarantino](user:${AVERY_ID})`,
    );
  });
});
