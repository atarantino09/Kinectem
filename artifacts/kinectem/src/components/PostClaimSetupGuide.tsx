import {
  CheckCircle2,
  ChevronRight,
  Mail,
  Megaphone,
  Sparkles,
  Trophy,
  UserPlus,
} from "lucide-react";

type SetupAction = "preInvite" | "coaches" | "outreach";

const STEPS: Array<{
  number: number;
  title: string;
  description: string;
  action?: SetupAction;
  actionLabel?: string;
  Icon: typeof CheckCircle2;
}> = [
  {
    number: 1,
    title: "Claim your organization",
    description:
      "Ownership is confirmed. You can now manage organization details, teams, coaches, outreach, and member access.",
    Icon: CheckCircle2,
  },
  {
    number: 2,
    title: "Send a pre-invite message",
    description:
      "Share a club-wide heads-up before invitations arrive. Explain why Kinectem is being introduced, what families should expect, and when team invites will begin.",
    action: "preInvite",
    actionLabel: "Open pre-invite message",
    Icon: Megaphone,
  },
  {
    number: 3,
    title: "Bulk add your coaches",
    description:
      "Match a coach to each existing team and send invitations in one batch. Coaches gain access to manage rosters, communicate with families, and create game recaps.",
    action: "coaches",
    actionLabel: "Open bulk coach invites",
    Icon: UserPlus,
  },
  {
    number: 4,
    title: "Invite parents & players",
    description:
      "Open Roster Outreach for ready-to-send messages and unique team signup links. Coaches can share them so parents and players join the correct team roster.",
    action: "outreach",
    actionLabel: "Open Roster Outreach",
    Icon: Mail,
  },
];

export function PostClaimSetupGuide({
  organizationName,
  onAction,
}: {
  organizationName: string;
  onAction: (action: SetupAction) => void;
}) {
  return (
    <div className="space-y-4" data-testid="post-claim-setup-guide">
      <div className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3">
        <p className="text-sm font-bold">
          Your teams are already loaded. Finish setting up{" "}
          {organizationName} in three quick actions.
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Every unfinished step below is clickable and opens the exact tool you
          need.
        </p>
      </div>

      <ol className="grid gap-3 sm:grid-cols-2">
        {STEPS.map((step) => {
          const done = step.number === 1;
          const content = (
            <>
              <span
                className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-black ${
                  done
                    ? "bg-emerald-100 text-emerald-700"
                    : "bg-primary text-primary-foreground"
                }`}
              >
                {done ? <CheckCircle2 className="h-5 w-5" /> : step.number}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 font-black">
                  <step.Icon className="h-4 w-4 shrink-0" />
                  {step.title}
                </span>
                <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                  {step.description}
                </span>
                <span
                  className={`mt-2 block text-xs font-black ${
                    done ? "text-emerald-700" : "text-primary"
                  }`}
                >
                  {done ? "Complete" : step.actionLabel}
                </span>
              </span>
              {!done && (
                <ChevronRight className="mt-2 h-5 w-5 shrink-0 text-primary transition-transform group-hover:translate-x-1" />
              )}
            </>
          );

          return (
            <li key={step.number} className={step.number === 1 ? "sm:col-span-2" : ""}>
              {done ? (
                <div
                  className="flex min-h-24 items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4"
                  data-testid="setup-step-claim-complete"
                >
                  {content}
                </div>
              ) : (
                <button
                  type="button"
                  className="group flex min-h-32 w-full items-start gap-3 rounded-xl border border-border bg-card p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-primary/50 hover:bg-primary/5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-60 sm:h-[14.5rem]"
                  onClick={() => step.action && onAction(step.action)}
                  aria-label={step.actionLabel}
                  data-testid={`setup-step-${step.action}`}
                >
                  {content}
                </button>
              )}
            </li>
          );
        })}
        <li>
          <div
            className="relative flex min-h-32 h-full overflow-hidden rounded-xl border border-violet-200 bg-gradient-to-br from-violet-50 via-white to-blue-50 p-4 shadow-sm dark:border-violet-800 dark:from-violet-950/40 dark:via-card dark:to-blue-950/30 sm:h-[14.5rem]"
            data-testid="setup-message-game-recaps"
          >
            <div className="absolute -right-7 -top-7 h-24 w-24 rounded-full bg-violet-200/40 blur-2xl" />
            <div className="relative flex items-start gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-violet-100 text-violet-700 dark:bg-violet-900 dark:text-violet-200">
                <Trophy className="h-5 w-5" />
              </span>
              <span className="min-w-0">
                <span className="block font-black">
                  Then, bring your season to life
                </span>
                <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                  Play your games, then have each coach visit their team page
                  to create the game recap. Built-in AI Assist turns the
                  highlights into the story of your season in just a few
                  minutes.
                </span>
                <span className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-violet-100 px-2.5 py-1 text-[11px] font-black text-violet-700 dark:bg-violet-900 dark:text-violet-200">
                  <Sparkles className="h-3.5 w-3.5" />
                  AI Assist · only a few minutes
                </span>
              </span>
            </div>
          </div>
        </li>
      </ol>
    </div>
  );
}