import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetOrCreateTeamJoinLink,
  useListRosterInvites,
  useArchiveTeam,
  useDeleteTeam,
  useUnarchiveTeam,
  getListRosterInvitesQueryKey,
  getGetTeamByIdQueryKey,
  getListOrgTeamsQueryKey,
  getListArchivedOrgTeamsQueryKey,
} from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Link2, Shield, Copy, Archive, Trash2 } from "lucide-react";
import { timeAgo } from "@/lib/format";

export function TeamAdminPanel({
  teamId,
  isArchived,
  organizationId,
  memberCount,
}: {
  teamId: string;
  isArchived: boolean;
  organizationId: string;
  memberCount: number;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const { data: invitesResp } = useListRosterInvites(teamId);
  const invites = invitesResp?.data ?? [];

  const generateLink = useGetOrCreateTeamJoinLink({
    mutation: {
      onSuccess: (resp) => {
        setLinkToken(resp.token);
        qc.invalidateQueries({
          queryKey: getListRosterInvitesQueryKey(teamId),
        });
      },
    },
  });

  // Auto-load the existing join link on mount. The server endpoint is
  // get-or-create (it reuses the single pending email-less rosterInvite
  // for the team), so calling it on open does not create duplicates.
  // Guarded by a ref so React StrictMode's double-invoke doesn't fire
  // the request twice.
  const autoFetchedRef = useRef<string | null>(null);
  const generateMutate = generateLink.mutate;
  useEffect(() => {
    if (autoFetchedRef.current === teamId) return;
    autoFetchedRef.current = teamId;
    setLinkToken(null);
    generateMutate({ teamId });
  }, [teamId, generateMutate]);

  const invalidateAfterArchive = () => {
    qc.invalidateQueries({ queryKey: getGetTeamByIdQueryKey(teamId) });
    qc.invalidateQueries({ queryKey: getListOrgTeamsQueryKey(organizationId) });
    qc.invalidateQueries({
      queryKey: getListArchivedOrgTeamsQueryKey(organizationId),
    });
  };
  const archive = useArchiveTeam({
    mutation: {
      onSuccess: () => {
        invalidateAfterArchive();
        toast({ title: "Team archived" });
      },
      onError: () =>
        toast({ title: "Couldn't archive team", variant: "destructive" }),
    },
  });
  const unarchive = useUnarchiveTeam({
    mutation: {
      onSuccess: () => {
        invalidateAfterArchive();
        toast({ title: "Team unarchived" });
      },
      onError: () =>
        toast({ title: "Couldn't unarchive team", variant: "destructive" }),
    },
  });
  const deleteTeam = useDeleteTeam({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListOrgTeamsQueryKey(organizationId) });
        qc.invalidateQueries({
          queryKey: getListArchivedOrgTeamsQueryKey(organizationId),
        });
        toast({ title: "Team permanently deleted" });
        setLocation(`/organizations/${organizationId}`);
      },
      onError: () => {
        invalidateAfterArchive();
        setDeleteDialogOpen(false);
        toast({
          title: "This team can’t be deleted",
          description:
            "It may now have rostered players or staff. Archive it instead.",
          variant: "destructive",
        });
      },
    },
  });
  const archivePending =
    archive.isPending || unarchive.isPending || deleteTeam.isPending;

  const fullLink = linkToken
    ? `${window.location.origin}${import.meta.env.BASE_URL}invites/${linkToken}`
    : null;

  const onCopy = () => {
    if (!fullLink) return;
    navigator.clipboard
      .writeText(fullLink)
      .then(() => toast({ title: "Link copied" }));
  };

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <Shield className="w-4 h-4 text-primary" />
        <h2 className="text-xl font-black tracking-tight">Admin Tools</h2>
      </div>

      <Card className="rounded-xl border border-border">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h3 className="font-black tracking-tight text-sm flex items-center gap-2">
                {memberCount === 0 && !isArchived ? (
                  <Trash2 className="w-3.5 h-3.5" />
                ) : (
                  <Archive className="w-3.5 h-3.5" />
                )}
                {isArchived
                  ? "Team Archived"
                  : memberCount === 0
                    ? "Delete Empty Team"
                    : "Archive Team"}
              </h3>
              <p className="text-xs text-muted-foreground mt-1">
                {isArchived
                  ? "This team is hidden from members and discovery. Unarchive to restore it."
                  : memberCount === 0
                    ? "This team has no rostered players or staff, so an organization admin can permanently delete it."
                    : `This team has ${memberCount} rostered ${memberCount === 1 ? "member" : "members"}, so it cannot be deleted. Archive it to hide it from members and discovery.`}
              </p>
            </div>
            <Button
              variant={memberCount === 0 && !isArchived ? "destructive" : isArchived ? "brand" : "outline"}
              size="sm"
              disabled={archivePending}
              onClick={() => {
                if (isArchived) unarchive.mutate({ teamId });
                else if (memberCount === 0) setDeleteDialogOpen(true);
                else archive.mutate({ teamId });
              }}
              data-testid={
                isArchived
                  ? "button-unarchive-team"
                  : memberCount === 0
                    ? "button-delete-empty-team"
                    : "button-archive-team"
              }
            >
              {archivePending
                ? "Working…"
                : isArchived
                  ? "Unarchive"
                  : memberCount === 0
                    ? "Delete team"
                    : "Archive"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent data-testid="dialog-delete-empty-team">
          <AlertDialogHeader>
            <AlertDialogTitle>Permanently delete this empty team?</AlertDialogTitle>
            <AlertDialogDescription>
              This team has no rostered players or staff. Deleting it permanently
              removes the team page and any related team data. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-empty-team">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTeam.mutate({ teamId })}
              data-testid="button-confirm-delete-empty-team"
            >
              Permanently delete team
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Card className="rounded-xl border border-border">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-black tracking-tight text-sm flex items-center gap-2">
              <Link2 className="w-3.5 h-3.5" />
              Shareable Join Link
            </h3>
            {!fullLink && (
              <Button
                variant="brand"
                size="sm"
                onClick={() => generateLink.mutate({ teamId })}
                disabled={generateLink.isPending}
                data-testid="button-generate-join-link"
              >
                {generateLink.isPending ? "Loading…" : "Generate"}
              </Button>
            )}
          </div>

          {fullLink ? (
            <div className="flex gap-2">
              <code className="flex-1 text-xs bg-muted px-3 py-2 rounded-lg truncate">
                {fullLink}
              </code>
              <Button
                size="sm"
                variant="outline"
                onClick={onCopy}
                className="gap-1 font-bold"
                data-testid="button-copy-join-link"
              >
                <Copy className="w-3 h-3" />
                Copy
              </Button>
            </div>
          ) : generateLink.isPending ? (
            <p className="text-xs text-muted-foreground">Loading join link…</p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Generate a link players can use to request to join this team.
            </p>
          )}
        </CardContent>
      </Card>

      <Card className="rounded-xl border border-border">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-black tracking-tight text-sm">
              Roster Invites
            </h3>
            <Badge variant="secondary" className="text-[10px] font-bold">
              {invites.length}
            </Badge>
          </div>
          {invites.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2">
              No pending invites.
            </p>
          ) : (
            <div className="space-y-2">
              {invites.map((inv) => (
                <div
                  key={inv.id}
                  className="flex items-center gap-3 p-2 rounded-lg bg-muted/40"
                  data-testid={`invite-${inv.id}`}
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-sm truncate">
                      {inv.email ?? "—"}
                    </p>
                    <p className="text-[11px] text-muted-foreground capitalize">
                      {inv.role} • sent {timeAgo(inv.createdAt)}
                    </p>
                  </div>
                  <Badge
                    variant="outline"
                    className="text-[10px] font-bold uppercase tracking-wider"
                  >
                    {inv.status}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
