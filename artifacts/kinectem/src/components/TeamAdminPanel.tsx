import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  useGetOrCreateTeamJoinLink,
  useListRosterInvites,
  useArchiveTeam,
  customFetch,
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
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
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
  teamName,
  canPermanentlyDelete,
  isArchived,
  organizationId,
  memberCount,
}: {
  teamId: string;
  teamName: string;
  canPermanentlyDelete: boolean;
  isArchived: boolean;
  organizationId: string;
  memberCount: number;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false);
  const [confirmTeamName, setConfirmTeamName] = useState("");
  const [acknowledgeDeletion, setAcknowledgeDeletion] = useState(false);

  const resetDeletion = (open: boolean) => {
    setDeleteDialogOpen(open);
    setConfirmTeamName("");
    setAcknowledgeDeletion(false);
  };

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
        setArchiveDialogOpen(false);
        invalidateAfterArchive();
        toast({ title: "Team archived — not deleted", description: "You can restore it, or an organization owner/admin or platform admin can choose permanent deletion as a separate step." });
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
  const deleteTeam = useMutation({
    mutationFn: () => customFetch<void>(`/api/v1/teams/${encodeURIComponent(teamId)}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmTeamName, acknowledgePermanentDeletion: acknowledgeDeletion }),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: getListOrgTeamsQueryKey(organizationId) });
      qc.invalidateQueries({ queryKey: getListArchivedOrgTeamsQueryKey(organizationId) });
      qc.removeQueries({ queryKey: getGetTeamByIdQueryKey(teamId) });
      qc.invalidateQueries({ queryKey: ["/api/v1/competitions"] });
      qc.invalidateQueries({ queryKey: ["/api/v1/feed"] });
      toast({ title: "Team permanently deleted" });
      setLocation(`/organizations/${organizationId}`);
    },
    onError: (error: Error) => {
      invalidateAfterArchive();
      toast({
        title: "Team was not deleted",
        description: error.message || "Check that the team is archived and that you are its organization owner/admin or a platform admin, then try again.",
        variant: "destructive",
      });
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
                <Archive className="w-3.5 h-3.5" />
                {isArchived ? "Step 2: Keep archived or permanently delete" : "Step 1: Archive team"}
              </h3>
              <p className="text-xs text-muted-foreground mt-1">
                Only this organization’s owners/admins or platform admins can archive, restore, or permanently delete this team page.
                {" "}{isArchived
                  ? "Archiving kept the data. Restore the page, or choose permanent deletion below. Deleting the page cannot be undone."
                  : `Archive first to hide the page and keep its data${memberCount ? `, including its ${memberCount} rostered ${memberCount === 1 ? "member" : "members"}` : ""}. Permanent deletion is a separate second step, available only after archiving.`}
              </p>
            </div>
            {canPermanentlyDelete && <Button
              variant={isArchived ? "brand" : "outline"}
              size="sm"
              disabled={archivePending}
              onClick={() => {
                if (isArchived) unarchive.mutate({ teamId });
                else setArchiveDialogOpen(true);
              }}
              data-testid={
                isArchived
                  ? "button-unarchive-team"
                  : "button-archive-team"
              }
            >
              {archivePending
                ? "Working…"
                : isArchived
                  ? "Unarchive"
                  : "Archive"}
            </Button>}
          </div>
          {isArchived && canPermanentlyDelete && (
            <Button variant="destructive" size="sm" disabled={archivePending}
              onClick={() => resetDeletion(true)} data-testid="button-delete-archived-team">
              <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Permanently delete team page
            </Button>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={archiveDialogOpen} onOpenChange={setArchiveDialogOpen}>
        <AlertDialogContent data-testid="dialog-archive-team">
          <AlertDialogHeader>
            <AlertDialogTitle>Step 1: Archive this team?</AlertDialogTitle>
            <AlertDialogDescription>
               Only this organization’s owners/admins or platform admins can archive or permanently delete its team pages.
              Archiving does not delete the page.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ol className="space-y-3 text-sm">
            <li><strong>1. Archive now.</strong> Hide the team page from members and discovery. Its data stays saved, and you can unarchive it.</li>
            <li><strong>2. Delete later, only if you choose.</strong> Once archived, an organization owner/admin or platform admin can separately choose to permanently delete the team page and its related team content. <strong>This cannot be undone.</strong> Archiving never automatically deletes the team.</li>
          </ol>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={archivePending}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={archivePending}
              onClick={(event) => { event.preventDefault(); archive.mutate({ teamId }); }}
              data-testid="button-confirm-archive-team">
              {archive.isPending ? "Archiving…" : "Archive only — keep data"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleteDialogOpen} onOpenChange={resetDeletion}>
        <AlertDialogContent data-testid="dialog-delete-archived-team">
          <AlertDialogHeader>
            <AlertDialogTitle>Step 2: Permanently delete this team page?</AlertDialogTitle>
            <AlertDialogDescription className="[overflow-wrap:anywhere]">
              Only this organization’s owners/admins or platform admins can do this. Deleting “{teamName}” permanently
              removes its team page and related team content, including recaps, roster memberships,
              and team schedule entries. People’s user accounts and the original competition
              schedules are not deleted. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm font-bold text-destructive">
            The team page will be permanently deleted. This cannot be undone.
          </div>
          <div className="space-y-3">
            <label className="block text-sm font-semibold" htmlFor="confirm-delete-team-name">
              Type the exact team name to confirm: <span className="[overflow-wrap:anywhere]">{teamName}</span>
            </label>
            <Input id="confirm-delete-team-name" value={confirmTeamName}
              onChange={(event) => setConfirmTeamName(event.target.value)} disabled={archivePending}
              autoComplete="off" data-testid="input-confirm-delete-team-name" />
            <label className="flex items-start gap-2 text-sm">
              <Checkbox checked={acknowledgeDeletion} disabled={archivePending}
                onCheckedChange={(checked) => setAcknowledgeDeletion(checked === true)}
                data-testid="checkbox-confirm-permanent-deletion" />
              <span>I understand that this team page will be permanently deleted and cannot be restored.</span>
            </label>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={archivePending} data-testid="button-cancel-delete-archived-team">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={!canPermanentlyDelete || !isArchived || confirmTeamName !== teamName || !acknowledgeDeletion || archivePending}
              onClick={(event) => { event.preventDefault(); deleteTeam.mutate(); }}
              data-testid="button-confirm-delete-archived-team"
            >
              {deleteTeam.isPending ? "Deleting…" : "Permanently delete team page"}
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
