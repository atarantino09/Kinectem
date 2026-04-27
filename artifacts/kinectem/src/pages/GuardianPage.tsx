import { useGetLoggedInUser } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Shield, Users } from "lucide-react";
import { EditProfileDialog } from "@/components/EditProfileDialog";
import { EmailPrefCard } from "@/components/guardian-page/EmailPrefCard";
import { LinkChildSearch } from "@/components/guardian-page/LinkChildSearch";
import { ChildRow } from "@/components/guardian-page/ChildRow";
import { useGuardianDashboard } from "@/components/guardian-page/useGuardianDashboard";

export default function GuardianPage() {
  const { data: me } = useGetLoggedInUser();
  const dash = useGuardianDashboard();

  if (me && me.role !== "parent") {
    return (
      <Card className="rounded-xl border-border">
        <CardContent className="p-8 text-center space-y-2">
          <Shield className="w-10 h-10 text-muted-foreground mx-auto" />
          <h2 className="text-xl font-black tracking-tight">
            Guardian dashboard
          </h2>
          <p className="text-sm text-muted-foreground">
            This page is only available to parent or guardian accounts.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
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

      <EmailPrefCard enabled={me?.role === "parent"} />

      <Card className="rounded-xl border-border">
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
                  refSetter={(el) => {
                    dash.childRefs.current[c.id] = el;
                  }}
                  onEdit={dash.openEditDialog}
                  onConsentChange={dash.toggleConsent}
                  onResend={dash.resendConfirmation}
                  onPendingAction={dash.handlePendingAction}
                  onDecide={dash.notifs.decideChildItem}
                  onRevertDecision={dash.notifs.revertChildDecision}
                  onApproveAll={dash.notifs.approveAllChildItems}
                  onToggleShowDecided={dash.notifs.toggleShowDecided}
                />
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
    </div>
  );
}
