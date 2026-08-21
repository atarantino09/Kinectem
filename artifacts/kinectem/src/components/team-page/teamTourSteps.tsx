import type { TeamPanel } from "./TeamHeaderCard";
import type { TourStep } from "./SpotlightTour";

type TeamTourCapabilities = {
  isAdmin: boolean;
  canManage: boolean;
  canViewSchedule: boolean;
  canPostHighlight: boolean;
  canPostRecap: boolean;
  onExpand: (panel: TeamPanel) => void;
};

/**
 * Builds a walkthrough only from controls the current viewer can use. Keeping
 * this separate from TeamPage makes permission-aware guide copy testable.
 */
export function buildTeamTourSteps({
  isAdmin,
  canManage,
  canViewSchedule,
  canPostHighlight,
  canPostRecap,
  onExpand,
}: TeamTourCapabilities): TourStep[] {
  const steps: TourStep[] = [];
  const hasPostOptions = canPostRecap || (canPostHighlight && canManage);

  if (isAdmin) {
    steps.push({
      targetTestId: "btn-team-manage-menu",
      onEnter: () => onExpand("posts"),
      title: "Manage your team",
      body: (
        <>
          Open <strong>Manage</strong> at the top of the page to edit your
          team's name, sport, level, and cover photo anytime.
        </>
      ),
    });
  }

  if (canManage) {
    steps.push({
      targetTestId: "btn-toggle-roster",
      additionalTargetTestIds: ["btn-invite-roster"],
      onEnter: () => onExpand("roster"),
      title: "Build your roster",
      body: (
        <>
          Open the <strong>Roster</strong> tab, then click{" "}
          <strong>Invite</strong> to add coaches, players, and parents — by
          email or a shareable join link. Coaches you add become team admins
          who can help you run everything.
        </>
      ),
    });
  }

  if (canManage && canViewSchedule) {
    steps.push({
      targetTestId: "btn-toggle-schedule",
      additionalTargetTestIds: ["btn-add-event", "btn-import-csv"],
      onEnter: () => onExpand("schedule"),
      title: "Add your schedule",
      body: (
        <>
          Open the <strong>Schedule</strong> tab, then click{" "}
          <strong>Add Event</strong> to post practices and games — or{" "}
          <strong>Import CSV</strong> to load a whole season at once.
        </>
      ),
    });
  }

  // When someone cannot write recaps, Post Highlight is a direct button, not
  // an item in Other post options. Keep its focused guide in that case.
  if (canPostHighlight && !canPostRecap) {
    steps.push({
      targetTestId: "btn-toggle-posts",
      additionalTargetTestIds: ["btn-create-highlight"],
      onEnter: () => onExpand("posts"),
      title: "Post highlights",
      body: (
        <>
          In <strong>Recent Posts</strong>, click{" "}
          <strong>Post Highlight</strong> to share a clip. Paste a YouTube or
          Vimeo link so it plays right on the page — other links still work but
          show as a plain link.
        </>
      ),
    });
  }

  // The menu is visible to recap authors and managers. Explain its available
  // actions once, rather than repeating separate tour steps for each item.
  if (hasPostOptions) {
    steps.push({
      targetTestId: "btn-toggle-posts",
      additionalTargetTestIds: ["btn-open-post-options"],
      onEnter: () => onExpand("posts"),
      title: "Other post options",
      body: (
        <>
          Open <strong>Other post options</strong> in{" "}
          <strong>Recent Posts</strong> to:
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {canPostHighlight && canPostRecap ? (
              <li>
                choose <strong>Post Highlight</strong> to share a clip or link
                from a game;
              </li>
            ) : null}
            {canPostRecap ? (
              <li>
                choose <strong>Combined Recap</strong> to turn several games
                into one tournament-weekend or season story; and
              </li>
            ) : null}
            {canManage ? (
              <li>
                choose <strong>Add News Article</strong> to share a local news
                story about your team.
              </li>
            ) : null}
          </ul>
        </>
      ),
    });
  }

  if (canPostRecap) {
    steps.push({
      targetTestId: "btn-toggle-posts",
      additionalTargetTestIds: ["btn-create-recap"],
      onEnter: () => onExpand("posts"),
      title: "Write game recaps",
      body: (
        <>
          In <strong>Recent Posts</strong>, click{" "}
          <strong>Create Game Recap</strong>. Short on time? The built-in{" "}
          <strong>AI Assist</strong> button drafts and polishes the write-up
          from a few quick notes.
        </>
      ),
    });
    steps.push({
      targetTestId: "btn-create-recap",
      onEnter: () => onExpand("posts"),
      title: "Start with your past games",
      body: (
        <>
          Don't leave your team page blank — hit{" "}
          <strong>Create Game Recap</strong> and back-log recaps from past
          weeks and seasons. Filling in your history gives players and families
          something to scroll from day one, and it only takes a few minutes per
          game with <strong>AI Assist</strong>.
        </>
      ),
    });
  }

  return steps;
}