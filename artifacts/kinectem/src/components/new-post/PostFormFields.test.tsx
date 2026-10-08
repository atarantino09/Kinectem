import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { PaginatedUserTeamMembershipsResponse } from "@workspace/api-client-react";

import { PostFormFields } from "./PostFormFields";
import { renderWithProviders } from "@/test/renderWithProviders";

vi.mock("./AiAssistButton", () => ({
  AiAssistButton: () => null,
}));

vi.mock("./MediaSection", () => ({
  MediaSection: () => <div data-testid="media-section" />,
}));

function renderForm(profileOnly: boolean) {
  return render(
    <PostFormFields
      postType="short"
      onPostTypeChange={vi.fn()}
      profileOnly={profileOnly}
      title=""
      onTitleChange={vi.fn()}
      body=""
      onBodyChange={vi.fn()}
      gameDate=""
      onGameDateChange={vi.fn()}
      tagRoster
      onTagRosterChange={vi.fn()}
      photos={[]}
      onPhotosChange={vi.fn()}
      videoUrl=""
      onVideoUrlChange={vi.fn()}
      teamId="__profile__"
      onTeamIdChange={vi.fn()}
      myTeams={
        {
          data: [
            {
              teamId: "team-1",
              teamName: "Team One",
              organization: {
                id: "org-1",
                name: "Example Organization",
                slug: "example-organization",
              },
            },
          ],
        } as unknown as PaginatedUserTeamMembershipsResponse
      }
      draftId={null}
      lockedToTeam={false}
      isEditingPublished={false}
      saving={false}
      publishing={false}
      onSaveDraft={vi.fn()}
      onSubmit={vi.fn()}
    />,
  );
}

describe("PostFormFields profile-only mode", () => {
  it("keeps profile highlights focused and hides recap and destination choices", () => {
    renderForm(true);

    expect(screen.getByTestId("input-title")).toBeInTheDocument();
    expect(screen.getByTestId("input-body")).toBeInTheDocument();
    expect(screen.getByTestId("media-section")).toBeInTheDocument();
    expect(screen.queryByText("Post Type")).not.toBeInTheDocument();
    expect(screen.queryByText("Game Recap")).not.toBeInTheDocument();
    expect(screen.queryByTestId("select-post-to-team")).not.toBeInTheDocument();
    const title = screen.getByTestId("input-title");
    const media = screen.getByTestId("media-section");
    const description = screen.getByTestId("input-body");
    expect(title.compareDocumentPosition(media) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(media.compareDocumentPosition(description) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("preserves the post type and destination controls for regular highlights", () => {
    renderForm(false);

    expect(screen.getByText("Post Type")).toBeInTheDocument();
    expect(screen.getByText("Game Recap")).toBeInTheDocument();
    expect(screen.getByTestId("select-post-to-team")).toBeInTheDocument();
    expect(screen.getByText("Just my profile")).toBeInTheDocument();
  });
});

describe("PostFormFields competition-only recaps", () => {
  function renderCompetitionForm(hasGames: boolean) {
    return renderWithProviders(
      <PostFormFields
        postType="long" onPostTypeChange={vi.fn()}
        title="" onTitleChange={vi.fn()} body="" onBodyChange={vi.fn()}
        gameDate="" onGameDateChange={vi.fn()} tagRoster onTagRosterChange={vi.fn()}
        photos={[]} onPhotosChange={vi.fn()} videoUrl="" onVideoUrlChange={vi.fn()}
        teamId="team-1" onTeamIdChange={vi.fn()} myTeams={undefined}
        draftId={null} lockedToTeam isEditingPublished={false}
        competitionTeamId="team-1" competitionId="competition-2"
        claimedCompetitions={[
          { id: "competition-1", slug: "cup-one", name: "Cup One" },
          { id: "competition-2", slug: "cup-two", name: "Cup Two" },
        ]}
        onCompetitionIdChange={vi.fn()}
        competitionGames={hasGames ? [{ id: "game-1", matchNumber: "1", matchDate: "2026-06-01", startTime: null, isHome: true, opponentName: "Rovers" }] : []}
        onCompetitionGameIdChange={vi.fn()}
        brackets={[{ id: "bracket-1", label: "Playoffs", gender: null, ageGroup: null }]}
        onBracketIdChange={vi.fn()}
        saving={false} publishing={false} onSaveDraft={vi.fn()} onSubmit={vi.fn()}
      />,
    );
  }

  it("shows the selected competition and optional game and bracket without preselecting game details", () => {
    renderCompetitionForm(true);
    expect(screen.getByTestId("select-competition")).toHaveTextContent("Cup Two");
    expect(screen.getByTestId("select-competition-game")).toHaveTextContent("No specific game");
    expect(screen.getByTestId("input-game-date")).toHaveValue("");
    expect(screen.getByText("Enter the date of your playoff or extra game.")).toBeVisible();
    expect(screen.getByTestId("section-bracket-picker")).toBeVisible();
  });

  it("explains unlisted game authoring when the selected competition has no played games", () => {
    renderCompetitionForm(false);
    expect(screen.getByTestId("select-competition")).toHaveTextContent("Cup Two");
    expect(screen.getByTestId("empty-state-no-competition-games")).toHaveTextContent(
      "this recap will keep the selected competition's branding without linking a listed game",
    );
    expect(screen.queryByTestId("select-competition-game")).not.toBeInTheDocument();
    expect(screen.getByTestId("section-bracket-picker")).toBeVisible();
  });
});