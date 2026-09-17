import {
  CheckCircle2,
  ChevronRight,
  Mail,
  Megaphone,
  UserPlus,
  Users,
} from "lucide-react";

type SetupAction = "preInvite" | "coaches" | "outreach" | "roster";

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
    description: "Your organization is claimed and you are now an owner.",
    Icon: CheckCircle2,
  },
  {
    number: 2,
    title: "Send a pre-invite message",
    description: "Introduce Kinectem before invitations arrive.",
    action: "preInvite",
    actionLabel: "Open pre-invite message",
    Icon: Megaphone,
  },
  {
    number: 3,
    title: "Bulk add your coaches",
    description: "Invite the right coach to every existing team at once.",
    action: "coaches",
    actionLabel: "Open bulk coach invites",
    Icon: UserPlus,
  },
  {
    number: 4,
    title: "Open Roster Outreach",
    description: "Use the ready-to-send message and team signup links.",
    action: "outreach",
    actionLabel: "Open Roster Outreach",
    Icon: Mail,
  },
  {
    number: 5,
    title: "Invite parents & players",
    description: "Open a team roster and send family invitations.",
    action: "roster",
    actionLabel: "Open roster invitations",
    Icon: Users,
  },
];

export function PostClaimSetupGuide({
  organizationName,
  hasTeams,
  onAction,
}: {
  organizationName: string;
  hasTeams: boolean;
  onAction: (action: SetupAction) => void;
}) {
  return (
    <div className="space-y-4" data-testid="post-claim-setup-guide">
      <div className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3">
        <p className="text-sm font-bold">
          Your teams are already loaded. Finish setting up {organizationName}
          in four quick actions.
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Every unfinished step below is clickable and opens the exact tool you
          need.
        </p>
      </div>

      <ol className="grid gap-3 sm:grid-cols-2">
        {STEPS.map((step) => {
          const done = step.number === 1;
          const unavailable = step.action === "roster" && !hasTeams;
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
                  {unavailable
                    ? "Add a team before opening roster invitations."
                    : step.description}
                </span>
                <span
                  className={`mt-2 block text-xs font-black ${
                    done ? "text-emerald-700" : "text-primary"
                  }`}
                >
                  {done ? "Complete" : step.actionLabel}
                </span>
              </span>
              {!done && !unavailable && (
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
                  className="group flex min-h-32 w-full items-start gap-3 rounded-xl border border-border bg-card p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-primary/50 hover:bg-primary/5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={unavailable}
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
      </ol>
    </div>
  );
}