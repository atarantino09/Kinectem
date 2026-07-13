import { useQueryClient } from "@tanstack/react-query";
import {
  useListUserChildren,
  getListUserChildrenQueryKey,
  useAcceptGuardianLink,
  useDeclineGuardianLink,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { UserAvatar } from "@/components/UserAvatar";
import { useToast } from "@/hooks/use-toast";
import { MailOpen } from "lucide-react";
import { timeAgo } from "@/lib/format";

interface Props {
  myUserId: string;
  onAccepted: () => void;
}

const REL_LABEL: Record<string, string> = {
  parent: "parent",
  legal_guardian: "legal guardian",
};

// Task #755 — invitations addressed to the signed-in user asking them to
// become a guardian of a child. Accepting activates the link (recording
// consent) and unlocks the child on this dashboard.
export function PendingGuardianInvites({ myUserId, onAccepted }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data } = useListUserChildren(myUserId);
  const pending = (data?.data ?? []).filter((l) => l.status === "pending");

  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: getListUserChildrenQueryKey(myUserId),
    });

  const accept = useAcceptGuardianLink({
    mutation: {
      onSuccess: () => {
        void refresh();
        void queryClient.invalidateQueries({ queryKey: ["whoami"] });
        onAccepted();
        toast({ title: "You're now linked as a guardian" });
      },
      onError: (err) => {
        const e = err as { error?: string } | undefined;
        toast({
          title: e?.error ?? "Couldn't accept this invitation",
          variant: "destructive",
        });
      },
    },
  });

  const decline = useDeclineGuardianLink({
    mutation: {
      onSuccess: () => {
        void refresh();
        toast({ title: "Invitation declined" });
      },
      onError: (err) => {
        const e = err as { error?: string } | undefined;
        toast({
          title: e?.error ?? "Couldn't decline this invitation",
          variant: "destructive",
        });
      },
    },
  });

  if (pending.length === 0) return null;

  return (
    <Card
      className="rounded-xl border-primary/40"
      data-testid="card-guardian-invites"
    >
      <CardContent className="p-6 space-y-3">
        <div className="flex items-center gap-2">
          <MailOpen className="w-4 h-4 text-primary" />
          <h2 className="font-black tracking-tight">Guardian invitations</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          You've been invited to become a guardian. Accepting links the child
          to your Family dashboard.
        </p>
        <div className="space-y-2">
          {pending.map((l) => {
            const acting =
              (accept.isPending &&
                accept.variables?.linkId === l.id) ||
              (decline.isPending && decline.variables?.linkId === l.id);
            return (
              <div
                key={l.id}
                className="flex items-start gap-3 p-3 rounded-lg border border-border bg-muted/30"
                data-testid={`row-guardian-invite-${l.id}`}
              >
                <UserAvatar
                  avatarUrl={l.child.avatarUrl}
                  displayName={l.child.displayName}
                  size="md"
                  className="border border-border shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-sm truncate">
                    {l.child.displayName}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    As {REL_LABEL[l.relationshipType] ?? l.relationshipType} ·
                    invited {timeAgo(l.createdAt)}
                  </p>
                </div>
                <div className="flex flex-col gap-2 shrink-0 sm:flex-row">
                  <Button
                    size="sm"
                    variant="outline"
                    className="font-bold rounded-full h-7 px-3 text-xs"
                    disabled={acting}
                    onClick={() => decline.mutate({ linkId: l.id })}
                    data-testid={`btn-decline-guardian-invite-${l.id}`}
                  >
                    Decline
                  </Button>
                  <Button
                    variant="brand"
                    size="xs"
                    disabled={acting}
                    onClick={() => accept.mutate({ linkId: l.id })}
                    data-testid={`btn-accept-guardian-invite-${l.id}`}
                  >
                    {acting ? "Working…" : "Accept"}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
