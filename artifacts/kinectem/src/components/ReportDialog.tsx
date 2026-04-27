import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { customFetch } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";

export type ReportContentType = "article" | "highlight" | "org_post" | "comment";

const REASONS = [
  "Spam or misleading",
  "Harassment or bullying",
  "Inappropriate content",
  "Hate speech",
  "Violence or threats",
  "Other",
];

type MineResponse = {
  alreadyReported: boolean;
  report: {
    id: string;
    reason: string;
    note: string | null;
    status: string;
    createdAt: string;
  } | null;
};

export function ReportDialog({
  open,
  onOpenChange,
  contentType,
  contentId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contentType: ReportContentType;
  contentId: string;
}) {
  const [reason, setReason] = useState(REASONS[0]);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: mine, isLoading: mineLoading } = useQuery<MineResponse>({
    queryKey: ["reports", "mine", contentType, contentId],
    queryFn: () => {
      const params = new URLSearchParams({ contentType, contentId });
      return customFetch<MineResponse>(`/api/v1/reports/mine?${params}`, {
        method: "GET",
      });
    },
    enabled: open,
    staleTime: 0,
  });

  const alreadyReported = mine?.alreadyReported === true;

  const submit = async () => {
    setSubmitting(true);
    try {
      const result = await customFetch<{ alreadyReported?: boolean }>(
        "/api/v1/reports",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ contentType, contentId, reason, note: note || undefined }),
        },
      );
      toast({
        title: result.alreadyReported
          ? "Report already submitted"
          : "Report submitted",
        description: result.alreadyReported
          ? "You have already reported this content. Our team is reviewing it."
          : "Thanks — our moderators will review this content.",
      });
      qc.invalidateQueries({ queryKey: ["reports", "mine", contentType, contentId] });
      onOpenChange(false);
      setNote("");
    } catch (err) {
      toast({
        title: "Failed to report",
        description: (err as Error).message,
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="dialog-report">
        <DialogHeader>
          <DialogTitle>Report content</DialogTitle>
          <DialogDescription>
            Tell us what's wrong. A moderator will review it.
          </DialogDescription>
        </DialogHeader>
        {alreadyReported && mine?.report && (
          <div
            className="rounded border bg-muted p-3 text-sm space-y-1"
            data-testid="report-already-filed"
          >
            <div className="font-medium">You already reported this content.</div>
            <div className="text-muted-foreground">
              Reason: <span className="font-mono">{mine.report.reason}</span>
            </div>
            {mine.report.note && (
              <div className="text-muted-foreground">
                Your note: <span className="italic">{mine.report.note}</span>
              </div>
            )}
            <div className="text-xs text-muted-foreground">
              Filed {new Date(mine.report.createdAt).toLocaleString()} · status:{" "}
              <span className="font-mono">{mine.report.status}</span>
            </div>
          </div>
        )}
        {!alreadyReported && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="report-reason">Reason</Label>
              <Select value={reason} onValueChange={setReason}>
                <SelectTrigger id="report-reason" data-testid="select-report-reason">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REASONS.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="report-note">Additional details (optional)</Label>
              <Textarea
                id="report-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Add any context that will help moderators..."
                rows={4}
                data-testid="input-report-note"
              />
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {alreadyReported ? "Close" : "Cancel"}
          </Button>
          {!alreadyReported && (
            <Button
              variant="brand"
              onClick={submit}
              disabled={submitting || mineLoading}
              data-testid="btn-submit-report"
            >
              {submitting ? "Submitting…" : "Submit report"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
