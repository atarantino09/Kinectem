import { useEffect, useMemo, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Users } from "lucide-react";
import { EditProfileDialog } from "@/components/EditProfileDialog";
import { EmailPrefCard } from "@/components/guardian-page/EmailPrefCard";
import { LinkChildSearch } from "@/components/guardian-page/LinkChildSearch";
import { ChildRow } from "@/components/guardian-page/ChildRow";
import { MinorControls } from "@/components/guardian-page/MinorControls";
import { ChildGuardiansSection } from "@/components/guardian-page/ChildGuardiansSection";
import { PendingGuardianInvites } from "@/components/guardian-page/PendingGuardianInvites";
import { FamilyContactInvitations } from "@/components/guardian-page/FamilyContactInvitations";
import { useGuardianDashboard } from "@/components/guardian-page/useGuardianDashboard";
import { FamilySetup } from "@/components/family-setup/FamilySetup";
import { useWhoami } from "@/hooks/useWhoami";
import { useFamilyContactInvitations } from "@/hooks/useFamilyContacts";
import {
  SpotlightTour,
  type TourStep,
} from "@/components/team-page/SpotlightTour";

// Walkthrough of the Family dashboard. Triggered right after a parent finishes
// creating their child during team-invite acceptance: that flow redirects here
// with `?tour=1&next=/teams/<id>`, we run the tour, then land them on the
// invited team. `next` is an internal path only (must start with "/").
export default function GuardianPage() {
  const { data: whoami } = useWhoami();
  const dash = useGuardianDashboard();
  // Guardian capability is "this user has at least one linked child"
  // (any role), not `role === "parent"`. Whoami exposes this directly.
  const isGuardian = whoami?.isGuardian === true;
  const { data: contactInvites } = useFamilyContactInvitations(!!(whoami?.viewingAs?.id ?? whoami?.realUser?.id));
  const followsChild = (contactInvites?.data ?? []).some(
    (invite) => invite.status === "active" || invite.status === "accepted",
  );
  // Task #755 — effective user id (the masqueraded user when admins are
  // impersonating). Drives the guardian-invite inbox + per-child guardian
  // lists below.
  const myUserId = whoami?.viewingAs?.id ?? whoami?.realUser?.id ?? null;

  const [, navigate] = useLocation();
  const search = useSearch();
  const searchParams = new URLSearchParams(search);
  const wantsTour = searchParams.get("tour") === "1";
  const nextDest = searchParams.get("next");
  const invitedChildId = searchParams.get("child");

  const wantsSetup = searchParams.get("setup") === "1";
  const leaveSetup = () => navigate("/family", { replace: true });
  const [tourOpen, setTourOpen] = useState(false);
  const [tourHandled, setTourHandled] = useState(false);
  useEffect(() => {
    if (invitedChildId && dash.children.some((child) => child.id === invitedChildId)) {
      dash.childRefs.current[invitedChildId]?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [invitedChildId, dash.children, dash.childRefs]);

  // Ring the first child's real "Require tag consent" toggle when we can; fall
  // back to the whole linked-children card before the roster has loaded.
  const firstChildId = dash.children[0]?.id;

  const tourSteps = useMemo<TourStep[]>(
    () => [
      {
        targetTestId: "family-header",
        title: "Welcome to your Family dashboard",
        body: (
          <>
            This is your home base for keeping your children safe on Kinectem.
            Review everything that happens on their accounts and act on their
            behalf — all from here.
          </>
        ),
      },
      {
        targetTestId: "card-linked-children",
        additionalTargetTestIds: firstChildId
          ? [`btn-invite-guardian-${firstChildId}`]
          : undefined,
        title: "Manage your children",
        body: (
          <>
            Each of your children shows up here. You can approve their follow
            requests, DMs, comments, and tags, edit their profile, and control
            their privacy — all on their behalf. Co-parenting? Use{" "}
             <strong>Invite family contact</strong> on a child's card to give
             another parent guardian access or someone else updates-only access.
          </>
        ),
      },
      {
        targetTestId: firstChildId
          ? `switch-consent-${firstChildId}`
          : "card-linked-children",
        title: "Tagging made simple",
        body: (
          <>
            By default, game recaps that tag your child appear on their
            profile automatically — and you get a notification each time.
            Want to review first? Switch <strong>Require tag consent</strong>{" "}
            on and every new tag waits for your approval before it goes live.
            Either way, you can remove any tag you don't want.
          </>
        ),
      },
      {
        targetTestId: "card-email-pref",
        title: "Choose your email updates",
        body: (
          <>
            Pick which email alerts you get about your children's activity and
            account so nothing important slips past you.
          </>
        ),
      },
    ],
    [firstChildId],
  );

  // Open the walkthrough when we arrive from the invite child-setup flow
  // (`?tour=1`). One-shot per mount so it never re-pops if the param lingers.
  useEffect(() => {
    if (wantsTour && !tourHandled) {
      setTourOpen(true);
      setTourHandled(true);
    }
  }, [wantsTour, tourHandled]);

  const finishTour = () => {
    setTourOpen(false);
    // Land them on the team they were invited to. `next` must be a strictly
    // internal path — a single leading "/" not followed by "/" or "\", so
    // protocol-relative ("//evil.com") and backslash tricks can't redirect off
    // site. Anything else is ignored and they simply stay on /family.
    if (nextDest && /^\/[^/\\]/.test(nextDest)) navigate(nextDest);
  };

  return (
    <div className="min-w-0 space-y-6">
      <div className="flex min-w-0 items-start gap-3 sm:items-center" data-testid="family-header">
        <div className="w-10 h-10 shrink-0 rounded-xl bg-gradient-to-br from-purple-600 to-blue-600 flex items-center justify-center">
          <Users className="w-5 h-5 text-white" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-3xl font-black tracking-tight [overflow-wrap:anywhere]">Family</h1>
          <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
            Link your children's accounts and control how they appear on
            Kinectem.
          </p>
        </div>
      </div>

      {wantsSetup && myUserId && (
        <FamilySetup key={`${myUserId}:family`} userId={myUserId} mode="family" onDone={leaveSetup} onSkipLater={leaveSetup} />
      )}
       <FamilyContactInvitations />
       {!isGuardian && !followsChild && (
        <Card
          className="rounded-xl border-border"
          data-testid="card-no-children"
        >
          <CardContent className="p-4 sm:p-6 space-y-2">
            <h2 className="font-black tracking-tight [overflow-wrap:anywhere]">
              You haven't linked a child yet
            </h2>
            <p className="text-sm text-muted-foreground">
              Search for your child below to link their account. Once linked,
              you'll see their pending follow requests, DMs, comments, and tags
              here, and you'll be able to act on them on your child's behalf.
            </p>
          </CardContent>
        </Card>
      )}

      {myUserId && (
        <PendingGuardianInvites
          myUserId={myUserId}
          onAccepted={() => void dash.refresh()}
        />
      )}

      <EmailPrefCard enabled={isGuardian} />

      <Card className="rounded-xl border-border" data-testid="card-linked-children">
        <CardContent className="min-w-0 p-4 sm:p-6 space-y-4">
          <h2 className="font-black tracking-tight [overflow-wrap:anywhere]">Linked children</h2>
          {dash.loading ? (
            <Skeleton className="h-20 rounded-lg" />
           ) : dash.children.length === 0 ? (
            <p className="text-sm text-muted-foreground">
               {followsChild
                 ? "You don't manage a child account. Children whose updates you follow are listed above."
                 : "You haven't linked any children yet. Find an athlete below to get started."}
            </p>
          ) : (
            <div className="space-y-3">
              {dash.children.map((c) => (
                <div key={c.id} className="space-y-3">
                <ChildRow
                  key={c.id}
                  child={c}
                  loadingEditFor={dash.loadingEditFor}
                  resending={dash.resending}
                  actingOnEntryId={dash.actingOnEntryId}
                  pendingInvites={dash.pendingByChild[c.id] ?? []}
                  notifState={dash.notifs.notifsByChild[c.id]}
                  decidingItem={dash.notifs.decidingItem}
                  revertingItemKey={dash.notifs.revertingItemKey}
                  approveAllForChild={dash.notifs.approveAllForChild}
                  unlinking={dash.unlinking}
                  refSetter={(el) => {
                    dash.childRefs.current[c.id] = el;
                  }}
                  onEdit={dash.openEditDialog}
                  onConsentChange={dash.toggleConsent}
                  onResend={dash.resendConfirmation}
                  onUnlink={dash.unlinkChild}
                  onPendingAction={dash.handlePendingAction}
                  onDecide={dash.notifs.decideChildItem}
                  onRevertDecision={dash.notifs.revertChildDecision}
                  onApproveAll={dash.notifs.approveAllChildItems}
                  onToggleShowDecided={dash.notifs.toggleShowDecided}
                />
                {myUserId && (
                  <ChildGuardiansSection child={c} myUserId={myUserId} />
                )}
                <MinorControls child={c} />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {dash.editingChild && (
        <EditProfileDialog
          user={dash.editingChild}
          open={true}
          onOpenChange={(next) => {
            if (!next) dash.setEditingChild(null);
          }}
          onSaved={() => {
            dash.setEditingChild(null);
            void dash.refresh();
          }}
        />
      )}

      <LinkChildSearch children={dash.children} onLinked={dash.refresh} />

      {tourOpen && (
        <SpotlightTour steps={tourSteps} onFinish={finishTour} />
      )}
    </div>
  );
}
