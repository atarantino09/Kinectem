import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useUpdateTeamMember,
  useRemoveTeamMember,
  getListTeamMembersQueryKey,
  getListRosterInvitesQueryKey,
  type UpdateTeamMemberRequestPosition,
} from "@workspace/api-client-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Shield, Trash2, AlertCircle, Loader2 } from "lucide-react";
import type { RosterMember } from "./TeamRosterTabs";

const POSITIONS: Array<{ value: UpdateTeamMemberRequestPosition; label: string }> = [
  { value: "player", label: "Player" },
  { value: "coach", label: "Head Coach" },
  { value: "assistant_coach", label: "Assistant Coach" },
  { value: "manager", label: "Team Manager" },
  { value: "parent", label: "Parent / Guardian" },
  { value: "author", label: "Author (Game Recaps)" },
  { value: "admin", label: "Admin" },
];

// Pull a human-readable reason off an `apiError(...)` response so we can show
// the exact server message (e.g. the last-Admin rule) inline in the dialog
// instead of a generic toast. The api server returns `{ error: "...", code }`
// for handled errors, so prefer that over the generic ApiError message.
function extractErrorMessage(err: unknown): string | null {
  if (!err || typeof err !== "object") return null;
  const maybe = err as { data?: unknown; message?: string };
  const data = maybe.data;
  if (data && typeof data === "object") {
    const errField = (data as { error?: unknown }).error;
    if (typeof errField === "string" && errField.trim()) return errField;
    if (
      errField &&
      typeof errField === "object" &&
      typeof (errField as { message?: unknown }).message === "string"
    ) {
      return (errField as { message: string }).message;
    }
  }
  if (typeof maybe.message === "string" && maybe.message.length > 0) {
    return maybe.message;
  }
  return null;
}

interface EditRosterMemberDialogProps {
  teamId: string;
  member: RosterMember | null;
  // True when this member is the only accepted Admin on the team — used to
  // pre-disable both demotion and removal so users see the "must keep one
  // Admin" rule before they hit the API.
  isLastAdmin: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EditRosterMemberDialog({
  teamId,
  member,
  isLastAdmin,
  open,
  onOpenChange,
}: EditRosterMemberDialogProps) {
  const qc = useQueryClient();
  const { toast } = useToast();

  const initialPosition = (member?.position as UpdateTeamMemberRequestPosition) ?? "player";
  const [position, setPosition] =
    useState<UpdateTeamMemberRequestPosition>(initialPosition);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Reset local UI state every time the dialog is reopened on a different
  // member so a previous error / "Confirm remove" stage doesn't leak across
  // edits of two different rows.
  useEffect(() => {
    if (open && member) {
      setPosition((member.position as UpdateTeamMemberRequestPosition) ?? "player");
      setConfirmingRemove(false);
      setErrorMessage(null);
    }
  }, [open, member]);

  const invalidate = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: getListTeamMembersQueryKey(teamId) }),
      qc.invalidateQueries({ queryKey: getListRosterInvitesQueryKey(teamId) }),
    ]);
  };

  const updateMember = useUpdateTeamMember();
  const removeMember = useRemoveTeamMember();

  if (!member) return null;

  const isAdminBeingDemoted = isLastAdmin && position !== "admin";
  const positionChanged = position !== initialPosition;
  const saveDisabled =
    !positionChanged ||
    updateMember.isPending ||
    removeMember.isPending ||
    isAdminBeingDemoted;

  const onSave = async () => {
    setErrorMessage(null);
    try {
      await updateMember.mutateAsync({
        teamId,
        memberId: member.id,
        data: { position },
      });
      await invalidate();
      toast({ title: `Updated ${member.displayName}` });
      onOpenChange(false);
    } catch (err) {
      setErrorMessage(extractErrorMessage(err) ?? "Couldn't update member");
    }
  };

  const onConfirmRemove = async () => {
    setErrorMessage(null);
    try {
      await removeMember.mutateAsync({ teamId, memberId: member.id });
      await invalidate();
      toast({ title: `Removed ${member.displayName} from the team` });
      onOpenChange(false);
    } catch (err) {
      setErrorMessage(extractErrorMessage(err) ?? "Couldn't remove member");
      setConfirmingRemove(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="dialog-edit-member">
        <DialogHeader>
          <DialogTitle className="font-black tracking-tight">
            Edit roster member
          </DialogTitle>
          <DialogDescription>
            <span className="font-semibold">{member.displayName}</span>
            {member.position && (
              <>
                {" — "}
                <span className="capitalize">
                  {member.position.replace(/_/g, " ")}
                </span>
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        {isLastAdmin && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            <Shield className="w-4 h-4 mt-0.5 shrink-0" />
            <p>
              <span className="font-bold">This is the team's last Admin.</span>{" "}
              Promote another member to Admin first to change this person's
              position or remove them.
            </p>
          </div>
        )}

        <div className="space-y-1.5">
          <Label className="font-bold">Position</Label>
          <Select
            value={position}
            onValueChange={(v) =>
              setPosition(v as UpdateTeamMemberRequestPosition)
            }
            disabled={updateMember.isPending || removeMember.isPending}
          >
            <SelectTrigger data-testid="select-edit-position">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {POSITIONS.map((p) => (
                <SelectItem key={p.value} value={p.value}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {errorMessage && (
          <div
            className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive"
            data-testid="text-edit-error"
          >
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <p>{errorMessage}</p>
          </div>
        )}

        <div className="rounded-lg border border-border p-3 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-bold text-sm">Remove from team</p>
              <p className="text-xs text-muted-foreground">
                Revokes any team-management rights they had through this roster
                spot.
              </p>
            </div>
            {!confirmingRemove ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="font-bold text-destructive hover:text-destructive shrink-0"
                onClick={() => setConfirmingRemove(true)}
                disabled={
                  isLastAdmin ||
                  updateMember.isPending ||
                  removeMember.isPending
                }
                data-testid="btn-edit-remove"
              >
                <Trash2 className="w-3.5 h-3.5 mr-1.5" /> Remove
              </Button>
            ) : null}
          </div>
          {confirmingRemove && (
            <div className="flex items-center justify-end gap-2 pt-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="font-bold"
                onClick={() => setConfirmingRemove(false)}
                disabled={removeMember.isPending}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                className="font-bold"
                onClick={onConfirmRemove}
                disabled={removeMember.isPending}
                data-testid="btn-edit-confirm-remove"
              >
                {removeMember.isPending ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                    Removing...
                  </>
                ) : (
                  "Confirm remove"
                )}
              </Button>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={updateMember.isPending || removeMember.isPending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="brand"
            onClick={onSave}
            disabled={saveDisabled}
            data-testid="btn-edit-save"
          >
            {updateMember.isPending ? (
              <>
                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                Saving...
              </>
            ) : (
              "Save changes"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
