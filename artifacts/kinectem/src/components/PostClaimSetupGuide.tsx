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
    title: "Invite every team",
    description:
      "As club admin, paste each team's ready-made message and unique link into BYGA, PlayMetrics, LeagueApps, or your usual channel. Families join the right roster automatically—under a minute per team.",
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
      <div className="relative flex items-start gap-3 overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-r from-primary/10 via-primary/5 to-transparent p-4">
        <div className="absolute -left-12 -top-12 h-32 w-32 rounded-full bg-primary/20 blur-3xl" />
        <div className="relative grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary/10 text-primary ring-1 ring-primary/20">
          <Sparkles className="h-5 w-5" />
        </div>
        <div className="relative">
          <h2 className="text-base font-black tracking-tight text-foreground">
            Your teams are already loaded. Finish setting up{" "}
            {organizationName} in three quick actions.
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Every unfinished step below is clickable and opens the exact tool you
            need.
          </p>
        </div>
      </div>

      <ol className="grid gap-3 sm:grid-cols-2">
        {STEPS.map((step) => {
          const done = step.number === 1;

          if (done) {
            return (
              <li key={step.number} className="sm:col-span-2">
                <div
                  className="flex items-start gap-3 rounded-2xl border border-emerald-200/60 bg-gradient-to-r from-emerald-50 to-emerald-50/30 p-4 shadow-sm dark:border-emerald-900/40 dark:from-emerald-950/30 dark:to-emerald-950/10"
                  data-testid="setup-step-claim-complete"
                >
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-emerald-100/80 text-emerald-600 shadow-inner dark:bg-emerald-900/50 dark:text-emerald-400">
                    <CheckCircle2 className="h-5 w-5" />
                  </div>
                  <div className="flex-1">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <h3 className="text-base font-black tracking-tight text-emerald-950 dark:text-emerald-50">
                        {step.title}
                      </h3>
                      <span className="inline-flex items-center rounded-full bg-emerald-200/50 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-emerald-800 dark:bg-emerald-800/50 dark:text-emerald-200">
                        Complete
                      </span>
                    </div>
                    <p className="mt-1 text-[13px] leading-5 text-emerald-800/80 dark:text-emerald-200/70">
                      {step.description}
                    </p>
                  </div>
                </div>
              </li>
            );
          }

          return (
            <li key={step.number}>
              <button
                type="button"
                className="app-surface app-surface-interactive group relative flex h-full w-full flex-col items-start overflow-hidden p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-60 sm:h-[14.5rem]"
                onClick={() => step.action && onAction(step.action)}
                aria-label={step.actionLabel}
                data-testid={`setup-step-${step.action}`}
              >
                <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100 group-focus-visible:opacity-100" />
                <div className="relative flex w-full items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-secondary shadow-sm transition-all duration-300 group-hover:-rotate-6 group-hover:scale-110 group-hover:bg-primary group-hover:shadow-md group-focus-visible:-rotate-6 group-focus-visible:scale-110 group-focus-visible:bg-primary group-focus-visible:shadow-md">
                      <span className="text-lg font-black text-secondary-foreground transition-colors group-hover:text-primary-foreground group-focus-visible:text-primary-foreground">
                        {step.number}
                      </span>
                    </div>
                    <h3 className="text-base font-black leading-tight tracking-tight text-foreground transition-colors group-hover:text-primary group-focus-visible:text-primary">
                      {step.title}
                    </h3>
                  </div>
                  <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-border bg-card shadow-sm transition-all duration-300 group-hover:rotate-6 group-hover:scale-110 group-hover:border-primary/30 group-hover:bg-primary/5 group-hover:text-primary group-focus-visible:rotate-6 group-focus-visible:scale-110 group-focus-visible:border-primary/30 group-focus-visible:bg-primary/5 group-focus-visible:text-primary">
                    <step.Icon className="h-5 w-5 text-muted-foreground transition-colors group-hover:text-primary group-focus-visible:text-primary" />
                  </div>
                </div>

                <div className="relative mt-3 flex flex-1 flex-col">
                  <p className="text-[13px] leading-5 text-muted-foreground">
                    {step.description}
                  </p>
                </div>

                <div className="relative mt-auto flex w-full items-center justify-between border-t border-border/50 pt-2.5 transition-colors group-hover:border-primary/20 group-focus-visible:border-primary/20">
                  <span className="text-xs font-black uppercase tracking-wider text-primary">
                    {step.actionLabel}
                  </span>
                  <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary/5 transition-colors group-hover:bg-primary/10 group-focus-visible:bg-primary/10">
                    <ChevronRight className="h-5 w-5 text-primary transition-transform duration-300 group-hover:translate-x-1 group-focus-visible:translate-x-1" />
                  </div>
                </div>
              </button>
            </li>
          );
        })}
        <li>
          <div
            className="app-surface relative flex h-full flex-col overflow-hidden border-violet-200 bg-gradient-to-br from-violet-50 via-white to-blue-50 p-4 dark:border-violet-800/60 dark:from-violet-950/40 dark:via-card dark:to-blue-950/30 sm:h-[14.5rem]"
            data-testid="setup-message-game-recaps"
          >
            <div className="absolute -right-12 -top-12 h-40 w-40 rounded-full bg-violet-200/40 blur-3xl dark:bg-violet-900/40" />
            <div className="relative flex w-full items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-violet-100 shadow-sm dark:bg-violet-900/50">
                  <Trophy className="h-5 w-5 text-violet-600 dark:text-violet-300" />
                </div>
                <h3 className="text-base font-black leading-tight tracking-tight text-violet-950 dark:text-violet-50">
                  Then, bring your season to life
                </h3>
              </div>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-200/60 bg-violet-100/80 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-violet-700 shadow-sm dark:border-violet-800/60 dark:bg-violet-900/50 dark:text-violet-300">
                <Sparkles className="h-3 w-3" />
                AI Assist
              </span>
            </div>

            <div className="relative mt-3 flex flex-1 flex-col">
              <p className="text-[13px] leading-5 text-violet-800/80 dark:text-violet-200/70">
                After each game, coaches visit their team page and add a few
                notes. AI Assist turns them into a polished recap in minutes,
                bringing the story of your season to life.
              </p>
            </div>

            <div className="relative mt-auto flex w-full items-center border-t border-violet-200/50 pt-2.5 dark:border-violet-800/50">
              <span className="text-xs font-bold text-violet-600 dark:text-violet-400">
                Takes only a few minutes per game
              </span>
            </div>
          </div>
        </li>
      </ol>
    </div>
  );
}