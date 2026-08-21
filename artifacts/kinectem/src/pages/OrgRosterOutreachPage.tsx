import { useEffect, useState, useRef } from "react";
import { useParams, Link } from "wouter";
import { useGetOrganizationById } from "@workspace/api-client-react";
import { useGetRosterOutreach, usePrepareOutreachMessage, useUpdateOutreachStatus, OutreachTeam } from "@/hooks/use-roster-outreach";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { formatOrgName } from "@/lib/format";
import { 
  ArrowLeft, 
  Check, 
  CheckCircle2, 
  ClipboardCopy, 
  Copy, 
  Mail, 
  RefreshCw, 
  Undo,
  AlertTriangle,
  Clock,
  User
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";

async function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand?.("copy");
  document.body.removeChild(textarea);
  if (!copied) throw new Error("Clipboard unavailable");
}

export default function OrgRosterOutreachPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const { toast } = useToast();
  const { data: organization, isLoading: isOrgLoading } = useGetOrganizationById(orgId!);
  const {
    data: outreachResp,
    isLoading: isOutreachLoading,
    isError: isOutreachError,
    isRefetching,
    refetch,
  } = useGetRosterOutreach(orgId!);
  const { mutateAsync: updateStatus, isPending: isUpdatingStatus } =
    useUpdateOutreachStatus(orgId!);
  const [selectedTeam, setSelectedTeam] = useState<OutreachTeam | null>(null);
  const [filter, setFilter] = useState("");

  if (isOrgLoading || !organization) {
    return (
      <div className="space-y-4 max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-20 rounded-xl" />
        <div className="space-y-2">
          <Skeleton className="h-16 rounded-xl" />
          <Skeleton className="h-16 rounded-xl" />
          <Skeleton className="h-16 rounded-xl" />
        </div>
      </div>
    );
  }

  if (isOutreachError) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="rounded-2xl border border-destructive/20 bg-destructive/5 p-8 text-center">
          <AlertTriangle className="mx-auto mb-3 h-9 w-9 text-destructive" />
          <h1 className="text-2xl font-black tracking-tight">Roster Outreach is restricted</h1>
          <p className="mx-auto mt-2 max-w-lg text-muted-foreground">
            Only organization owners and admins can review or update roster outreach.
          </p>
          <Button asChild variant="outline" className="mt-5 rounded-full font-bold">
            <Link href={`/organizations/${orgId}`}>Back to organization</Link>
          </Button>
        </div>
      </div>
    );
  }

  const teams = outreachResp?.data ?? [];
  const pendingTeams = teams.filter((t) => !t.sentAt);
  const sentTeams = teams.filter((t) => t.sentAt);
  const normalizedFilter = filter.trim().toLowerCase();
  const visibleTeams = teams.filter((team) =>
    [team.name, team.sport, team.season, team.level, team.gender]
      .filter(Boolean)
      .some((value) => value!.toLowerCase().includes(normalizedFilter)),
  );

  const toggleSent = async (team: OutreachTeam, sent: boolean) => {
    try {
      await updateStatus({ teamId: team.id, sent });
      toast({
        title: sent ? "Marked as sent" : "Marked for follow-up",
        description: sent
          ? `${team.name} is now complete for every organization manager.`
          : `${team.name} is back on the shared outreach checklist.`,
      });
    } catch {
      toast({
        title: "Couldn't update outreach",
        description: "Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Link href={`/organizations/${orgId}`} className="hover:text-foreground hover:underline transition-colors flex items-center gap-1 font-medium">
            <ArrowLeft className="w-4 h-4" />
            Back to {formatOrgName(organization.name)}
          </Link>
        </div>
        
        <div className="relative rounded-2xl overflow-hidden bg-card border shadow-sm">
          <div className="absolute inset-0 bg-gradient-to-r from-primary/10 via-primary/5 to-transparent pointer-events-none" />
          <div className="relative p-6 sm:p-8 flex flex-col sm:flex-row sm:items-center justify-between gap-6">
            <div>
              <div className="inline-flex items-center justify-center p-3 bg-primary/10 text-primary rounded-xl mb-4">
                <Mail className="w-8 h-8" />
              </div>
              <h1 className="text-3xl sm:text-4xl font-black tracking-tight text-foreground">
                Roster Outreach
              </h1>
              <p className="text-muted-foreground mt-2 max-w-2xl font-medium text-lg leading-relaxed">
                Prepare a team-specific message, paste it into the communication tool you already use, then track outreach together.
              </p>
            </div>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => refetch()} 
              disabled={isRefetching}
              className="shrink-0 font-bold rounded-full bg-background shadow-sm hover:bg-muted"
              data-testid="btn-refresh-outreach"
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${isRefetching ? 'animate-spin' : ''}`} />
              Refresh status
            </Button>
          </div>
        </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-3 items-start">
        <section className="lg:col-span-2 overflow-hidden rounded-2xl border bg-card shadow-sm">
          <div className="flex flex-col gap-4 border-b bg-primary/5 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-primary">Shared checklist</p>
              <h2 className="mt-1 text-xl font-black tracking-tight">
                {sentTeams.length} of {teams.length} teams contacted
              </h2>
              <p className="mt-1 text-sm font-medium text-muted-foreground">
                {pendingTeams.length === 0
                  ? "Every active team is marked complete."
                  : `${pendingTeams.length} active ${pendingTeams.length === 1 ? "team still needs" : "teams still need"} outreach.`}
              </p>
            </div>
            <Badge className="w-fit rounded-full px-3 py-1 font-black" variant={pendingTeams.length === 0 ? "default" : "secondary"}>
              {pendingTeams.length === 0 ? "Complete" : `${pendingTeams.length} to send`}
            </Badge>
          </div>

          <div className="border-b p-4">
            <Input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Filter teams by name, sport, season, or level"
              aria-label="Filter roster outreach teams"
              className="max-w-md bg-background"
              data-testid="input-roster-outreach-filter"
            />
          </div>

          {isOutreachLoading ? (
            <div className="space-y-3 p-5">
              <Skeleton className="h-16 rounded-xl" />
              <Skeleton className="h-16 rounded-xl" />
              <Skeleton className="h-16 rounded-xl" />
            </div>
          ) : teams.length === 0 ? (
            <div className="p-12 text-center">
              <Mail className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" />
              <h3 className="font-black">No active teams yet</h3>
              <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
                Create or unarchive a team before preparing roster outreach.
              </p>
            </div>
          ) : visibleTeams.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">
              No teams match that filter.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left">
                <thead className="border-b bg-muted/30 text-xs font-black uppercase tracking-[0.14em] text-muted-foreground">
                  <tr>
                    <th className="px-5 py-3">Team</th>
                    <th className="px-5 py-3">Outreach status</th>
                    <th className="px-5 py-3 text-center">Sent</th>
                    <th className="px-5 py-3 text-right">Message</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {visibleTeams.map((team) => (
                    <TeamRow
                      key={team.id}
                      team={team}
                      disabled={isUpdatingStatus}
                      onSelect={() => setSelectedTeam(team)}
                      onToggle={(sent) => toggleSent(team, sent)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <aside className="rounded-xl border border-primary/20 bg-primary/5 p-6 lg:sticky lg:top-24">
          <h3 className="font-bold text-primary flex items-center gap-2 mb-3">
            <AlertTriangle className="w-5 h-5" />
            Send through your team tool
          </h3>
          <div className="space-y-4 text-sm text-muted-foreground font-medium">
            <p>
              Kinectem prepares the team’s message and join link, but you stay in control of delivery.
            </p>
            <p>
              Paste it into TeamSnap, LeagueApps, PlayMetrics, or another roster communication tool—then check the team off once it is sent.
            </p>
          </div>
        </aside>
      </div>

      {selectedTeam && (
        <MessageDialog 
          team={selectedTeam} 
          orgId={orgId!} 
          onClose={() => setSelectedTeam(null)} 
        />
      )}
    </div>
  );
}

function TeamRow({
  team,
  onSelect,
  onToggle,
  disabled,
}: {
  team: OutreachTeam;
  onSelect: () => void;
  onToggle: (sent: boolean) => void;
  disabled: boolean;
}) {
  const isSent = !!team.sentAt;
  const details = [team.sport, team.season, team.level, team.gender].filter(Boolean);

  return (
    <tr data-testid={`row-roster-outreach-team-${team.id}`} className="transition-colors hover:bg-primary/[0.025]">
      <td className="px-5 py-4">
        <div>
          <h3 className="font-black text-base text-foreground">
            {team.name}
          </h3>
          {details.length > 0 && (
            <p className="mt-1 text-xs font-medium text-muted-foreground">
              {details.join(" · ")}
            </p>
          )}
        </div>
      </td>
      <td className="px-5 py-4">
        {isSent ? (
          <div>
            <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-800 font-bold uppercase tracking-wider text-[10px]">
              Sent
            </Badge>
            <div className="mt-1.5 flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
              <Clock className="w-3.5 h-3.5" />
              {team.sentAt ? formatDistanceToNow(new Date(team.sentAt), { addSuffix: true }) : ""}
            </div>
            {team.sentBy && (
              <div className="mt-0.5 flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
                <User className="w-3.5 h-3.5" />
                by {team.sentBy.displayName}
              </div>
            )}
          </div>
        ) : (
          <Badge variant="secondary" className="font-bold">Still to send</Badge>
        )}
      </td>
      <td className="px-5 py-4 text-center">
        <input
          type="checkbox"
          checked={isSent}
          disabled={disabled}
          onChange={(event) => onToggle(event.target.checked)}
          aria-label={`Mark roster outreach sent for ${team.name}`}
          className="h-4 w-4 cursor-pointer accent-primary disabled:cursor-not-allowed"
          data-testid={`check-roster-outreach-${team.id}`}
        />
      </td>
      <td className="px-5 py-4 text-right">
        <Button
          variant={isSent ? "outline" : "brand"}
          size="sm"
          className="rounded-full font-bold"
          onClick={onSelect}
          data-testid={`btn-copy-roster-message-${team.id}`}
        >
          <Copy className="mr-1.5 h-3.5 w-3.5" />
          Copy message
        </Button>
      </td>
    </tr>
  );
}

function MessageDialog({ team, orgId, onClose }: { team: OutreachTeam, orgId: string, onClose: () => void }) {
  const { toast } = useToast();
  const { mutateAsync: prepareMessage, isPending: isPreparing, data: preparedData } = usePrepareOutreachMessage(orgId, team.id);
  const { mutateAsync: updateStatus, isPending: isUpdating } = useUpdateOutreachStatus(orgId);
  const [copied, setCopied] = useState(false);
  const hasPrepared = useRef(false);
  
  const isSent = !!team.sentAt;

  useEffect(() => {
    if (!hasPrepared.current) {
      hasPrepared.current = true;
      prepareMessage().catch(() => {
        toast({ title: "Failed to generate message", variant: "destructive" });
      });
    }
  }, [team.id, prepareMessage, toast]);

  const handleCopy = async () => {
    if (!preparedData) return;
    try {
      await copyToClipboard(preparedData.message);
      setCopied(true);
      toast({ title: "Copied to clipboard", description: "You can now paste this into your email or messaging app." });
      setTimeout(() => setCopied(false), 3000);
    } catch {
      toast({ title: "Failed to copy", variant: "destructive" });
    }
  };

  const handleMarkSent = async () => {
    try {
      await updateStatus({ teamId: team.id, sent: true });
      toast({ title: "Marked as sent" });
      onClose();
    } catch {
      toast({ title: "Failed to update status", variant: "destructive" });
    }
  };

  const handleUndoSent = async () => {
    try {
      await updateStatus({ teamId: team.id, sent: false });
      toast({ title: "Marked as pending" });
      onClose();
    } catch {
      toast({ title: "Failed to update status", variant: "destructive" });
    }
  };

  return (
    <Dialog open={true} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-xl p-0 overflow-hidden gap-0 border-0 shadow-2xl" data-testid={`dialog-message-${team.id}`}>
        <div className="bg-gradient-to-br from-primary/10 via-primary/5 to-transparent p-6 border-b border-border/50">
          <DialogHeader>
            <DialogTitle className="text-2xl font-black flex items-center gap-2 tracking-tight">
              Outreach for {team.name}
            </DialogTitle>
            <DialogDescription className="text-base font-medium mt-2 text-foreground/80">
              {isSent ? "This team's invitations were already marked as sent." : "Copy this generated message and send it through your own channels."}
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="p-6 space-y-6 bg-card">
          <div className="space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <label className="text-sm font-bold tracking-wider text-muted-foreground uppercase flex items-center gap-2">
                <ClipboardCopy className="w-4 h-4" />
                Prepared Message
              </label>
              {preparedData && (
                <Button 
                  size="sm" 
                  variant="outline" 
                  onClick={handleCopy} 
                  className={`h-9 font-bold transition-all rounded-full px-4 ${copied ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800 hover:bg-emerald-100 hover:text-emerald-800' : 'hover:bg-primary/5'}`}
                  data-testid="btn-copy-message"
                >
                  {copied ? <CheckCircle2 className="w-4 h-4 mr-2" /> : <Copy className="w-4 h-4 mr-2" />}
                  {copied ? "Copied!" : "Copy message"}
                </Button>
              )}
            </div>
            
            <div className="relative rounded-xl border bg-muted/20 p-5 font-mono text-sm leading-relaxed whitespace-pre-wrap min-h-[160px] shadow-inner">
              {isPreparing ? (
                <div className="space-y-4 animate-pulse">
                  <div className="h-4 bg-muted/60 rounded w-3/4"></div>
                  <div className="h-4 bg-muted/60 rounded w-full"></div>
                  <div className="h-4 bg-muted/60 rounded w-5/6"></div>
                  <div className="h-4 bg-muted/60 rounded w-1/2"></div>
                </div>
              ) : preparedData ? (
                <div className="text-foreground" data-testid="text-prepared-message">
                  {preparedData.message}
                </div>
              ) : (
                <div className="text-destructive flex flex-col items-center justify-center h-[120px] font-sans">
                  <AlertTriangle className="w-8 h-8 mb-2 opacity-50" />
                  <span className="font-bold">Failed to load message.</span>
                </div>
              )}
            </div>
          </div>

          <section className="rounded-xl border border-primary/15 bg-primary/[0.035] p-4">
            <h3 className="text-sm font-black tracking-tight">Send it in your team tool</h3>
            <ol className="mt-2 list-decimal space-y-1.5 pl-4 text-sm text-muted-foreground">
              <li>Open the roster message for this team in TeamSnap, LeagueApps, PlayMetrics, or your usual team tool.</li>
              <li>Paste the full message above to the parents and players you intend to invite.</li>
              <li>Send it there, then return here and mark this team as sent.</li>
            </ol>
          </section>

          <DialogFooter className="flex-col sm:flex-row gap-3 pt-4 border-t">
            {isSent ? (
              <Button 
                variant="outline" 
                onClick={handleUndoSent} 
                disabled={isUpdating}
                className="w-full font-bold rounded-full"
                data-testid="btn-undo-sent"
              >
                <Undo className="w-4 h-4 mr-2" />
                Undo, mark as pending
              </Button>
            ) : (
              <Button 
                variant="brand" 
                onClick={handleMarkSent} 
                disabled={isUpdating || isPreparing || !preparedData}
                className="w-full font-bold shadow-md rounded-full text-base h-11"
                data-testid="btn-mark-sent"
              >
                {isUpdating ? "Updating..." : "I've sent this message"}
                {!isUpdating && <CheckCircle2 className="w-5 h-5 ml-2 opacity-80" />}
              </Button>
            )}
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
