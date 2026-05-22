import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetOrgSetupStatus,
  useDismissOrgSetupChecklist,
  useReopenOrgSetupChecklist,
  getGetOrgSetupStatusQueryKey,
  type OrgSetupStatusResponse,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  CheckCircle2,
  Circle,
  ChevronDown,
  Image as ImageIcon,
  Users,
  Shield,
  UserPlus,
  ClipboardList,
  Heart,
  X,
  RotateCcw,
} from "lucide-react";

type StepKey =
  | "logoSet"
  | "hasTeam"
  | "hasStaffOrInvite"
  | "hasCoAdmin"
  | "hasRosterEntry"
  | "hasGuardianLinkOrInvite";

type StepAction =
  | "editLogo"
  | "createTeam"
  | "manageMembers"
  | "promoteAdmin"
  | "viewTeams"
  | "viewTeamsForGuardian";

type StepDef = {
  key: StepKey;
  title: string;
  description: string;
  Icon: typeof ImageIcon;
  action: StepAction;
  actionLabel: string;
};

const STEPS: StepDef[] = [
  {
    key: "logoSet",
    title: "Upload org logo",
    description: "Give your org a recognizable face on profiles and posts.",
    Icon: ImageIcon,
    action: "editLogo",
    actionLabel: "Upload logo",
  },
  {
    key: "hasTeam",
    title: "Create your first team",
    description: "Teams are where rosters, recaps, and highlights live.",
    Icon: ClipboardList,
    action: "createTeam",
    actionLabel: "Create team",
  },
  {
    key: "hasStaffOrInvite",
    title: "Invite coaches / staff",
    description: "Bring in coaches and staff to help run the org.",
    Icon: UserPlus,
    action: "manageMembers",
    actionLabel: "Invite staff",
  },
  {
    key: "hasCoAdmin",
    title: "Add a co-admin",
    description:
      "Promote someone so you're not the only admin running the org.",
    Icon: Shield,
    action: "promoteAdmin",
    actionLabel: "Promote a member",
  },
  {
    key: "hasRosterEntry",
    title: "Add players to a roster",
    description: "Open a team to invite or add players to its roster.",
    Icon: Users,
    action: "viewTeams",
    actionLabel: "Go to teams",
  },
  {
    key: "hasGuardianLinkOrInvite",
    title: "Invite parents / guardians",
    description:
      "Send roster invites with a guardian email so families can follow along.",
    Icon: Heart,
    action: "viewTeamsForGuardian",
    actionLabel: "Open a team",
  },
];

export type OrgSetupChecklistActions = {
  onEditLogo: () => void;
  onCreateTeam: () => void;
  onManageMembers: () => void;
  onPromoteAdmin: () => void;
  onGoToTeams: () => void;
};

export function OrgSetupChecklist({
  orgId,
  actions,
}: {
  orgId: string;
  actions: OrgSetupChecklistActions;
}) {
  const qc = useQueryClient();
  const { data, isLoading } = useGetOrgSetupStatus(orgId);
  const invalidate = () =>
    qc.invalidateQueries({ queryKey: getGetOrgSetupStatusQueryKey(orgId) });
  const dismiss = useDismissOrgSetupChecklist({
    mutation: { onSuccess: invalidate },
  });
  const reopen = useReopenOrgSetupChecklist({
    mutation: { onSuccess: invalidate },
  });

  if (isLoading || !data) return null;

  const status: OrgSetupStatusResponse = data;
  const dismissed = status.dismissedAt != null;

  // When dismissed, render only the tiny "Show setup checklist" affordance.
  if (dismissed) {
    return (
      <Card
        className="rounded-xl border border-border shadow-sm"
        data-testid="card-org-setup-checklist-dismissed"
      >
        <CardContent className="p-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2 className="w-4 h-4" />
            <span>
              Org setup checklist hidden ({status.completedCount} of{" "}
              {status.totalSteps} steps done)
            </span>
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="font-bold"
            onClick={() => reopen.mutate({ orgId })}
            disabled={reopen.isPending}
            data-testid="btn-org-setup-checklist-reopen"
          >
            <RotateCcw className="w-3.5 h-3.5 mr-1" />
            Show setup checklist
          </Button>
        </CardContent>
      </Card>
    );
  }

  const runAction = (action: StepAction) => {
    switch (action) {
      case "editLogo":
        actions.onEditLogo();
        return;
      case "createTeam":
        actions.onCreateTeam();
        return;
      case "manageMembers":
        actions.onManageMembers();
        return;
      case "promoteAdmin":
        actions.onPromoteAdmin();
        return;
      case "viewTeams":
      case "viewTeamsForGuardian":
        actions.onGoToTeams();
        return;
    }
  };

  return (
    <Card
      className="rounded-xl border border-border shadow-sm overflow-hidden"
      data-testid="card-org-setup-checklist"
    >
      <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <ClipboardList className="w-5 h-5 text-primary shrink-0" />
          <h2 className="text-base font-black tracking-tight truncate">
            Get your org set up
          </h2>
          <Badge
            variant="outline"
            className="text-[10px] uppercase tracking-wider font-bold"
            data-testid="badge-org-setup-progress"
          >
            {status.completedCount} of {status.totalSteps} done
          </Badge>
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="font-bold"
          onClick={() => dismiss.mutate({ orgId })}
          disabled={dismiss.isPending}
          data-testid="btn-org-setup-checklist-dismiss"
          aria-label="Dismiss setup checklist"
        >
          <X className="w-4 h-4" />
        </Button>
      </div>

      {status.allComplete ? (
        <CardContent className="p-4">
          <div
            className="flex items-center gap-2 text-sm font-bold text-emerald-700 dark:text-emerald-400"
            data-testid="text-org-setup-complete"
          >
            <CheckCircle2 className="w-5 h-5" />
            Setup complete ✓
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            You've finished the first-run setup. You can dismiss this card.
          </p>
        </CardContent>
      ) : (
        <CardContent className="p-0">
          <ul className="divide-y divide-border">
            {STEPS.map((step) => {
              const done = status.steps[step.key];
              return (
                <li
                  key={step.key}
                  className="px-4 py-3 flex items-start gap-3"
                  data-testid={`row-org-setup-${step.key}`}
                >
                  {done ? (
                    <CheckCircle2
                      className="w-5 h-5 mt-0.5 text-emerald-600 shrink-0"
                      data-testid={`icon-org-setup-done-${step.key}`}
                    />
                  ) : (
                    <Circle
                      className="w-5 h-5 mt-0.5 text-muted-foreground shrink-0"
                      data-testid={`icon-org-setup-todo-${step.key}`}
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <p
                      className={`text-sm font-bold ${
                        done ? "line-through text-muted-foreground" : ""
                      }`}
                    >
                      {step.title}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {step.description}
                    </p>
                  </div>
                  {!done && (
                    <Button
                      size="sm"
                      variant="brand"
                      className="font-bold rounded-full shrink-0"
                      onClick={() => runAction(step.action)}
                      data-testid={`btn-org-setup-action-${step.key}`}
                    >
                      {step.actionLabel}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </CardContent>
      )}

      <RolesPermissionsAccordion />
    </Card>
  );
}

export function RolesPermissionsAccordion() {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="border-t border-border"
    >
      <CollapsibleTrigger
        className="w-full flex items-center justify-between gap-2 px-4 py-3 text-left hover:bg-muted/40 transition-colors"
        data-testid="btn-roles-permissions-toggle"
      >
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-black tracking-tight">
            Roles &amp; permissions
          </span>
        </div>
        <ChevronDown
          className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </CollapsibleTrigger>
      <CollapsibleContent
        className="px-4 pb-4 pt-1 text-sm space-y-4"
        data-testid="region-roles-permissions"
      >
        <RolesReference />
      </CollapsibleContent>
    </Collapsible>
  );
}

export function RolesReference() {
  return (
    <div className="space-y-4 text-sm">
      <section>
        <h3 className="text-xs uppercase tracking-wider font-black text-muted-foreground mb-1.5">
          Organization roles
        </h3>
        <ul className="space-y-1.5">
          <li>
            <span className="font-bold">Owner</span> — Full control. Only the
            owner can transfer ownership or delete the org. Can do everything
            an admin can.
          </li>
          <li>
            <span className="font-bold">Admin</span> — Manages org details,
            teams (create / edit / archive), and members (invite, remove,
            promote other admins). Can author and approve recaps/posts for
            any team in the org.
          </li>
          <li>
            <span className="font-bold">Member</span> — Belongs to the org but
            can't change settings, manage teams, or invite people.
          </li>
        </ul>
      </section>
      <section>
        <h3 className="text-xs uppercase tracking-wider font-black text-muted-foreground mb-1.5">
          Team roles (roster)
        </h3>
        <ul className="space-y-1.5">
          <li>
            <span className="font-bold">Coach</span> — Team manager. Can edit
            the team, manage its roster (invite / remove players and coaches),
            and author recaps/posts for that team.
          </li>
          <li>
            <span className="font-bold">Player</span> — On the roster. Sees
            team-only content and is tagged in team activity. No management
            rights.
          </li>
          <li>
            <span className="font-bold">Game recaps</span> — Anyone on a team's
            roster who isn't a player or a parent can create game recaps for
            that team (coaches and other non-player / non-parent roster
            members). No separate "author" position needed.
          </li>
          <li>
            <span className="font-bold">Highlights</span> — Everyone can upload
            highlights, but highlights uploaded by a player or a parent must
            be approved by a team admin before they're visible.
          </li>
        </ul>
      </section>
      <section>
        <h3 className="text-xs uppercase tracking-wider font-black text-muted-foreground mb-1.5">
          Family
        </h3>
        <ul className="space-y-1.5">
          <li>
            <span className="font-bold">Parent / Guardian</span> — A user with
            linked children. Approves follow requests, comments, and DMs for
            their kids, and manages COPPA consent. Guardian capability is
            automatic when a child is linked to your account — it's not a
            separate role you pick.
          </li>
        </ul>
      </section>
    </div>
  );
}

export function RolesPermissionsCard() {
  return (
    <Card
      className="rounded-xl border border-border shadow-sm"
      data-testid="card-roles-permissions"
    >
      <RolesPermissionsAccordion />
    </Card>
  );
}
