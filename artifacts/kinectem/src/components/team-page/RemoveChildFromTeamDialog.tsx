import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useRemoveTeamMember,
  getListTeamMembersQueryKey,
  getListRosterInvitesQueryKey,
  getGetTeamByIdQueryKey,
  getListUserTeamsQueryKey,
  getListUserChildrenQueryKey,
  getListFeedQueryKey,
} from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import type { RosterMember } from "./TeamRosterTabs";

export function RemoveChildFromTeamDialog({
  teamId, member, viewerId, onClose,
}: {
  teamId: string;
  member: RosterMember | null;
  viewerId?: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const remove = useRemoveTeamMember();
  const { toast } = useToast();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setError(null), [member?.id]);
  if (!member) return null;

  const onRemove = async () => {
    setError(null);
    try {
      await remove.mutateAsync({ teamId, memberId: member.id });
    } catch {
      setError("We couldn’t remove your child. Please try again.");
      return;
    }
    toast({ title: `Removed ${member.displayName} from the team` });
    onClose();
    await Promise.all([
      qc.invalidateQueries({ queryKey: getListTeamMembersQueryKey(teamId) }),
      qc.invalidateQueries({ queryKey: getListRosterInvitesQueryKey(teamId) }),
      qc.invalidateQueries({ queryKey: getGetTeamByIdQueryKey(teamId) }),
      qc.invalidateQueries({ queryKey: getListUserTeamsQueryKey(member.userId) }),
      qc.invalidateQueries({ queryKey: getListFeedQueryKey() }),
      qc.invalidateQueries({ queryKey: ["whoami"] }),
      ...(viewerId ? [
        qc.invalidateQueries({ queryKey: getListUserChildrenQueryKey(viewerId) }),
        qc.invalidateQueries({ queryKey: getListUserTeamsQueryKey(viewerId) }),
      ] : []),
    ]);
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !remove.isPending) onClose(); }}>
      <DialogContent className="sm:max-w-md" data-testid="dialog-remove-child-from-team">
        <DialogHeader>
          <DialogTitle>Remove {member.displayName} from this team?</DialogTitle>
          <DialogDescription>
            This removes your child from this team’s roster only. Their account,
            other teams, and family connections stay unchanged.
          </DialogDescription>
        </DialogHeader>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={remove.isPending}>Cancel</Button>
          <Button variant="destructive" onClick={onRemove} disabled={remove.isPending}
            data-testid="btn-remove-child-from-team">
            {remove.isPending ? "Removing…" : "Remove from team"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
