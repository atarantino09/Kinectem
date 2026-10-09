import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Crown, Loader2, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

export function OrgOwnerEmailInvite({
  orgId,
  orgName,
}: {
  orgId: string;
  orgName: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const qc = useQueryClient();
  const { toast } = useToast();
  const invite = useMutation({
    mutationFn: (recipient: string) =>
      customFetch(`/api/v1/admin/org-claim-links/${orgId}/email-owner-invite`, {
        method: "POST",
        body: JSON.stringify({ email: recipient }),
      }),
    onMutate: () => setSentTo(null),
    onSuccess: (_result, recipient) => {
      setSentTo(recipient);
      setEmail("");
      setExpanded(false);
      void qc.invalidateQueries({ queryKey: ["admin", "org-claim-links"] });
      toast({ title: "Owner invitation sent", description: `Emailed to ${recipient}.` });
    },
    onError: (error: Error) => {
      toast({
        title: "Couldn't send owner invitation",
        description: error.message,
        variant: "destructive",
      });
    },
  });
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  return (
    <section
      className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950"
      data-testid="org-owner-email-invite"
    >
      <h3 className="flex items-center gap-2 font-bold">
        <Crown className="h-4 w-4 shrink-0" />
        This organization is unclaimed
      </h3>
      <p className="text-sm">
        Invite the owner of {orgName} by email. They receive a secure link to
        sign in or create an account and claim the organization. Sending an
        invitation does not assign ownership yet.
      </p>
      {sentTo && (
        <p className="text-sm font-medium" role="status">
          Owner invitation emailed to {sentTo}.
        </p>
      )}
      {!expanded ? (
        <Button
          size="sm"
          className="gap-2"
          onClick={() => setExpanded(true)}
          data-testid="btn-invite-org-owner"
        >
          <Mail className="h-4 w-4" /> Invite owner by email
        </Button>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (validEmail && !invite.isPending) invite.mutate(email.trim());
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="org-owner-email">Owner email address</Label>
            <Input
              id="org-owner-email"
              type="email"
              required
              maxLength={320}
              autoComplete="email"
              placeholder="owner@club.org"
              value={email}
              disabled={invite.isPending}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              size="sm"
              disabled={!validEmail || invite.isPending}
              data-testid="btn-send-org-owner-invite"
            >
              {invite.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {invite.isPending ? "Sending…" : "Send owner invitation"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={invite.isPending}
              onClick={() => {
                setEmail("");
                setExpanded(false);
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
