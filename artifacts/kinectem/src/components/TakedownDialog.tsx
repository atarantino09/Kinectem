import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

// Task #524 — shared confirmation dialog for guardian photo-of-minor
// takedown filings. Used by both PostCard (feed menu) and PostPage
// (detail view) so the copy + reason field stay consistent across
// the three post kinds (article / highlight / org_post).

const REASON_MAX = 500;

export function TakedownDialog({
  open,
  onOpenChange,
  onConfirm,
  submitting,
  postKindLabel,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  onConfirm: (reason: string | null) => void | Promise<void>;
  submitting: boolean;
  postKindLabel: string;
}) {
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (open) setReason("");
  }, [open]);

  const trimmed = reason.trim();
  const finalReason = trimmed.length > 0 ? trimmed.slice(0, REASON_MAX) : null;

  return (
    <Dialog open={open} onOpenChange={(next) => !submitting && onOpenChange(next)}>
      <DialogContent
        className="sm:max-w-md"
        data-testid="dialog-takedown-confirm"
      >
        <DialogHeader>
          <DialogTitle>Report photo of my child</DialogTitle>
          <DialogDescription>
            Filing a takedown will immediately hide this {postKindLabel} from
            public feeds while moderators review it. Adding a short note helps
            them resolve the request faster.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="takedown-reason" className="text-sm">
            Why are you reporting this? (optional)
          </Label>
          <Textarea
            id="takedown-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value.slice(0, REASON_MAX))}
            placeholder="e.g. My child is in this photo without my consent."
            rows={4}
            disabled={submitting}
            data-testid="textarea-takedown-reason"
          />
          <p className="text-xs text-muted-foreground">
            {reason.length}/{REASON_MAX}
          </p>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            disabled={submitting}
            onClick={() => onOpenChange(false)}
            data-testid="btn-takedown-cancel"
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={submitting}
            onClick={() => void onConfirm(finalReason)}
            data-testid="btn-takedown-submit"
          >
            {submitting ? "Submitting…" : "File takedown request"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
