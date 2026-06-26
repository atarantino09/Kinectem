import { useRef, useState } from "react";
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
import { Megaphone, Paperclip, X, FileText, ImageIcon } from "lucide-react";
import {
  sendOrgBroadcast,
  sendTeamBroadcast,
  uploadBroadcastAttachment,
  inboxQueryKey,
  unreadCountQueryKey,
} from "./broadcastsApi";

const MAX_BODY_LEN = 4000;

// Org announcements can attach flyers: images + PDF, up to 5 files, ≤10MB each.
const MAX_ATTACHMENTS = 5;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const ALLOWED_ATTACHMENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
];

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
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const { toast } = useToast();
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isOrg = target.kind === "organization";
  const audienceHint = isOrg
    ? "Sent to coaches, players, and parents across every team in this organization. Recipients can't reply."
    : "Sent to this team's players and their parents. Parents can reply privately to staff.";

  const reset = () => {
    setBody("");
    setFiles([]);
    setSending(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const onPickFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (picked.length === 0) return;

    const accepted: File[] = [];
    for (const f of picked) {
      if (!ALLOWED_ATTACHMENT_TYPES.includes(f.type)) {
        toast({
          title: "Unsupported file",
          description: `${f.name} must be a JPEG, PNG, WebP, or PDF.`,
          variant: "destructive",
        });
        continue;
      }
      if (f.size > MAX_ATTACHMENT_BYTES) {
        toast({
          title: "File too large",
          description: `${f.name} is over the 10 MB limit.`,
          variant: "destructive",
        });
        continue;
      }
      accepted.push(f);
    }

    setFiles((prev) => {
      const room = MAX_ATTACHMENTS - prev.length;
      if (accepted.length > room) {
        toast({
          title: "Too many files",
          description: `You can attach up to ${MAX_ATTACHMENTS} files.`,
          variant: "destructive",
        });
      }
      return [...prev, ...accepted.slice(0, room)];
    });
  };

  const removeFile = (idx: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  const onSend = async () => {
    const trimmed = body.trim();
    if (!trimmed) {
      toast({ title: "Message can't be empty", variant: "destructive" });
      return;
    }
    setSending(true);
    try {
      let assetIds: string[] | undefined;
      if (isOrg && files.length > 0) {
        assetIds = await Promise.all(
          files.map((f) => uploadBroadcastAttachment(f)),
        );
      }
      const result = isOrg
        ? await sendOrgBroadcast(target.id, trimmed, assetIds)
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

        {isOrg && (
          <div className="space-y-2">
            <input
              ref={fileInputRef}
              type="file"
              accept={ALLOWED_ATTACHMENT_TYPES.join(",")}
              multiple
              className="hidden"
              onChange={onPickFiles}
              data-testid="input-broadcast-files"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={sending || files.length >= MAX_ATTACHMENTS}
              data-testid="btn-broadcast-attach"
            >
              <Paperclip className="w-4 h-4 mr-1.5" />
              Attach files
            </Button>
            <p className="text-xs text-muted-foreground">
              Images or PDF, up to {MAX_ATTACHMENTS} files, 10 MB each.
            </p>

            {files.length > 0 && (
              <ul className="space-y-1.5">
                {files.map((f, idx) => {
                  const isImage = f.type.startsWith("image/");
                  return (
                    <li
                      key={`${f.name}-${idx}`}
                      className="flex items-center gap-2 rounded-md border bg-muted/30 px-2.5 py-1.5"
                      data-testid={`broadcast-file-${idx}`}
                    >
                      {isImage ? (
                        <ImageIcon className="w-4 h-4 shrink-0 text-muted-foreground" />
                      ) : (
                        <FileText className="w-4 h-4 shrink-0 text-muted-foreground" />
                      )}
                      <span className="min-w-0 flex-1 truncate text-sm">
                        {f.name}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeFile(idx)}
                        disabled={sending}
                        className="shrink-0 text-muted-foreground hover:text-foreground"
                        aria-label={`Remove ${f.name}`}
                        data-testid={`btn-remove-file-${idx}`}
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

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
