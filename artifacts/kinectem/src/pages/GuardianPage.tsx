import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Users } from "lucide-react";
import { EditProfileDialog } from "@/components/EditProfileDialog";
import { EmailPrefCard } from "@/components/guardian-page/EmailPrefCard";
import { LinkChildSearch } from "@/components/guardian-page/LinkChildSearch";
import { ChildRow } from "@/components/guardian-page/ChildRow";
import { MinorControls } from "@/components/guardian-page/MinorControls";
import { useGuardianDashboard } from "@/components/guardian-page/useGuardianDashboard";
import { useWhoami } from "@/hooks/useWhoami";
import {
  SpotlightTour,
  type TourStep,
} from "@/components/team-page/SpotlightTour";

// First-run walkthrough of the Family dashboard. Shown once per browser the
// first time a parent/guardian lands here (localStorage — the API spec is
// locked so there's no server "seen onboarding" field). Bump the key to
// re-show to everyone.
const FAMILY_TOUR_KEY = "kinectem:family-tour-v1";

export default function GuardianPage() {
  const { data: whoami } = useWhoami();
  const dash = useGuardianDashboard();
  // Guardian capability is "this user has at least one linked child"
  // (any role), not `role === "parent"`. Whoami exposes this directly.
  const isGuardian = whoami?.isGuardian === true;
  // A brand-new parent has no linked child yet, so `isGuardian` is still
  // false — include `role === "parent"` so they get the walkthrough too.
  const isParentPersona =
    isGuardian || whoami?.realUser?.role === "parent";

  const [tourOpen, setTourOpen] = useState(false);

  const tourSteps = useMemo<TourStep[]>(
    () => [
      {
        targetTestId: "family-header",
        title: "Welcome to your Family dashboard",
        body: (
          <>
            This is your home base for keeping your children safe on Kinectem.
            Link their accounts, review what happens on them, and act on your
            child's behalf — all from here.
          </>
        ),
      },
      {
        targetTestId: "input-search-child",
        title: "Link your child's account",
        body: (
          <>
            Start by searching for your child by name to link their account.
            Once linked, everything they do flows through this dashboard for
            your review.
          </>
        ),
      },
      {
        targetTestId: "card-linked-children",
        title: "Manage your children",
        body: (
          <>
            Each linked child shows up here. You can approve their follow
            requests, DMs, comments, and tags, edit their profile, and control
            their privacy — all on their behalf.
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
    [],
  );

  // Pop the walkthrough once per browser, the first time a parent/guardian
  // opens the Family page. Read in try/catch so blocked storage (private
  // mode) just treats it as not-yet-seen.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!isParentPersona) return;
    let alreadySeen = false;
    try {
      alreadySeen = localStorage.getItem(FAMILY_TOUR_KEY) === "1";
    } catch {
      // storage blocked — treat as not seen
    }
    if (!alreadySeen) setTourOpen(true);
  }, [isParentPersona]);

  const finishTour = () => {
    try {
      localStorage.setItem(FAMILY_TOUR_KEY, "1");
    } catch {
      // ignore storage failures (private mode etc.) — tour just won't persist
    }
    setTourOpen(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3" data-testid="family-header">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-600 to-blue-600 flex items-center justify-center">
          <Users className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-3xl font-black tracking-tight">Family</h1>
          <p className="text-sm text-muted-foreground">
            Link your children's accounts and control how they appear on
            Kinectem.
          </p>
        </div>
      </div>

      {!isGuardian && (
        <Card
          className="rounded-xl border-border"
          data-testid="card-no-children"
        >
          <CardContent className="p-6 space-y-2">
            <h2 className="font-black tracking-tight">
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

      <EmailPrefCard enabled={isGuardian} />

      <Card className="rounded-xl border-border" data-testid="card-linked-children">
        <CardContent className="p-6 space-y-4">
          <h2 className="font-black tracking-tight">Linked children</h2>
          {dash.loading ? (
            <Skeleton className="h-20 rounded-lg" />
          ) : dash.children.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              You haven't linked any children yet. Find an athlete below to get
              started.
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
