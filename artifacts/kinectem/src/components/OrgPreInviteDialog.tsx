import { useMemo, useState } from "react";
import { Check, Copy, Megaphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { buildOrganizationPageUrl } from "@/components/OrgPageShareDialog";

export function buildOrganizationPreInviteMessage(
  organizationName: string,
  pageUrl: string,
): string {
  return `Hello ${organizationName} admins, coaches, players, and parents,

${organizationName} is getting started on Kinectem. Kinectem is the youth-sports platform where the story of your season comes to life.

Kinectem is not another registration, scheduling, or communication app — it's the layer that sits on top of the one we already use. They run our season. Kinectem makes it last.

After the final whistle, Kinectem turns quick coach notes into polished recaps, tags every player, and builds a lasting history families can revisit. It gives our club one living home for the moments that matter — without replacing the tools we already use.

Don't worry coaches- there is an AI Assist tool built in to game recap editor, so it's a couple of minutes, not homework.

Please take a moment to preview our organization page:
${pageUrl}

This announcement is only a heads-up. We will first add our coaches, then add players and parents to each team. Watch for a follow-up email from Kinectem containing your specific team invitation and instructions to join.

We are excited to bring our whole organization together on Kinectem!`;
}

async function copyText(text: string): Promise<void> {
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
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("Copy blocked");
}

export function OrgPreInviteDialog({
  orgId,
  organizationName,
  open,
  automatic = false,
  onOpenChange,
}: {
  orgId: string;
  organizationName: string;
  open: boolean;
  automatic?: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const pageUrl = useMemo(() => buildOrganizationPageUrl(orgId), [orgId]);
  const message = useMemo(
    () => buildOrganizationPreInviteMessage(organizationName, pageUrl),
    [organizationName, pageUrl],
  );

  const handleCopy = async () => {
    try {
      await copyText(message);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
      toast({
        title: "Pre-invite message copied",
        description: "Paste it into BYGA, PlayMetrics, TeamSnap, 360 Player, email, or your usual club channel.",
      });
    } catch {
      toast({
        title: "Couldn't copy",
        description: "Select the message and copy it manually.",
        variant: "destructive",
      });
    }
  };

  const close = () => {
    if (automatic) {
      toast({
        title: "Message saved for later",
        description: "Reopen it any time from Manage > Pre-invite message.",
      });
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent
        className="sm:max-w-xl max-h-[calc(100dvh-2rem)] overflow-y-auto"
        data-testid="dialog-org-pre-invite"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-black tracking-tight">
            <Megaphone className="h-5 w-5 text-primary" />
            Send this before inviting your teams
          </DialogTitle>
          <DialogDescription>
            Share this organization-wide heads-up first. Next, bulk-add coaches,
            then mass-add players and parents to each team. This is plain text
            so it pastes cleanly into BYGA, PlayMetrics, TeamSnap, 360 Player,
            email, and similar tools.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <label
            htmlFor="org-pre-invite-message"
            className="text-xs font-bold uppercase tracking-wide text-muted-foreground"
          >
            Ready-to-send organization announcement
          </label>
          <Textarea
            id="org-pre-invite-message"
            value={message}
            readOnly
            className="min-h-72 resize-y text-sm leading-relaxed"
            data-testid="text-org-pre-invite-message"
          />
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {copied ? "Copied to your clipboard." : "Review or edit after pasting into your communication tool."}
          </p>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={close}
            data-testid="btn-dismiss-org-pre-invite"
          >
            Not now
          </Button>
          <Button
            type="button"
            variant="brand"
            onClick={handleCopy}
            data-testid="btn-copy-org-pre-invite"
          >
            {copied ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
            {copied ? "Copied!" : "Copy complete message"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}