import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetOrCreateTeamJoinLink,
  useListRosterInvites,
  getListRosterInvitesQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Link2, Shield, Copy } from "lucide-react";
import { timeAgo } from "@/lib/format";

export function TeamAdminPanel({ teamId }: { teamId: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [linkToken, setLinkToken] = useState<string | null>(null);

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
          <div className="flex items-center justify-between">
            <h3 className="font-black tracking-tight text-sm flex items-center gap-2">
              <Link2 className="w-3.5 h-3.5" />
              Shareable Join Link
            </h3>
            <Button
              size="sm"
              className="font-bold"
              onClick={() => generateLink.mutate({ teamId })}
              disabled={generateLink.isPending}
              data-testid="button-generate-join-link"
            >
              {generateLink.isPending ? "Generating…" : "Generate"}
            </Button>
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
