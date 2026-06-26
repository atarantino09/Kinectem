import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Megaphone } from "lucide-react";
import {
  sendOrgBroadcast,
  sendTeamBroadcast,
  inboxQueryKey,
  unreadCountQueryKey,
} from "./broadcastsApi";

const MAX_BODY_LEN = 4000;

type Target =
  | { kind: "organization"; id: string; name: string }
  | { kind: "team"; id: string; name: string };

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: Target;
}

// Compose + send a broadcast. Org broadcasts reach every team's coaches,
// players, and parents (no replies). Team broadcasts reach the team's players
// and parents, and parents can reply privately.
export function BroadcastComposeDialog({ open, onOpenChange, target }: Props) {
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const { toast } = useToast();
  const qc = useQueryClient();

  const isOrg = target.kind === "organization";
  const audienceHint = isOrg
    ? "Sent to coaches, players, and parents across every team in this organization. Recipients can't reply."
    : "Sent to this team's players and their parents. Parents can reply privately to staff.";

  const reset = () => {
    setBody("");
    setSending(false);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const onSend = async () => {
    const trimmed = body.trim();
    if (!trimmed) {
      toast({ title: "Message can't be empty", variant: "destructive" });
      return;
    }
    setSending(true);
    try {
      const result = isOrg
        ? await sendOrgBroadcast(target.id, trimmed)
        : await sendTeamBroadcast(target.id, trimmed);
      toast({
        title: "Broadcast sent",
        description: `Delivered to ${result.recipientCount} recipient${
          result.recipientCount === 1 ? "" : "s"
        }.`,
      });
      await qc.invalidateQueries({ queryKey: inboxQueryKey() });
      await qc.invalidateQueries({ queryKey: unreadCountQueryKey() });
      reset();
      onOpenChange(false);
    } catch (err) {
      toast({
        title: "Couldn't send broadcast",
        description: err instanceof Error ? err.message : "Something went wrong.",
        variant: "destructive",
      });
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg rounded-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Megaphone className="w-5 h-5 text-primary" />
            {isOrg ? "Send announcement" : `Message ${target.name}`}
          </DialogTitle>
          <DialogDescription>{audienceHint}</DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value.slice(0, MAX_BODY_LEN))}
            placeholder={
              isOrg
                ? "Share an update with everyone in your organization…"
                : "Share an update with the team…"
            }
            rows={6}
            autoFocus
            data-testid="input-broadcast-body"
          />
          <p className="text-xs text-muted-foreground text-right">
            {body.length}/{MAX_BODY_LEN}
          </p>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => handleOpenChange(false)}
            disabled={sending}
          >
            Cancel
          </Button>
          <Button
            variant="brand"
            onClick={onSend}
            disabled={sending || !body.trim()}
            data-testid="btn-send-broadcast"
          >
            {sending ? "Sending…" : "Send"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
