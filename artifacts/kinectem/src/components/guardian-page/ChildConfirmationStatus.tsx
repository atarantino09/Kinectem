import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Clock, AlertTriangle, Mail } from "lucide-react";
import { formatDate } from "@/lib/format";
import type { Child } from "./types";

interface Props {
  child: Child;
  resending: string | null;
  onResend: (child: Child) => void;
}

// Confirmation-status row that hangs off a child card. Renders one of
// three badges (confirmed / pending / expired) plus the matching
// metadata and resend button. Hidden entirely when status is "none".
export function ChildConfirmationStatus({ child, resending, onResend }: Props) {
  if (child.confirmationStatus === "none") return null;
  const c = child;
  const isResending = resending === c.id;
  return (
    <div
      className="flex flex-wrap items-center gap-2 pt-2 border-t border-border"
      data-testid={`status-confirmation-${c.id}`}
    >
      {c.confirmationStatus === "confirmed" && (
        <>
          <Badge
            variant="outline"
            className="font-bold gap-1 border-green-600 text-green-700 dark:text-green-400"
          >
            <CheckCircle2 className="w-3 h-3" />
            {c.confirmedByMe ? "Confirmed by you" : "Confirmed"}
          </Badge>
          {c.guardianConfirmedAt && (
            <span
              className="text-xs text-muted-foreground"
              data-testid={`text-confirmed-on-${c.id}`}
            >
              Confirmed on {formatDate(c.guardianConfirmedAt)}
            </span>
          )}
        </>
      )}
      {c.confirmationStatus === "pending" && (
        <Badge
          variant="outline"
          className="font-bold gap-1 border-amber-500 text-amber-700 dark:text-amber-400"
        >
          <Clock className="w-3 h-3" />
          Pending guardian confirmation
        </Badge>
      )}
      {c.confirmationStatus === "expired" && (
        <Badge
          variant="outline"
          className="font-bold gap-1 border-red-500 text-red-700 dark:text-red-400"
        >
          <AlertTriangle className="w-3 h-3" />
          Confirmation link expired
        </Badge>
      )}
      {c.guardianEmail && (
        <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
          <Mail className="w-3 h-3" />
          {c.guardianEmail}
        </span>
      )}
      {(c.confirmationStatus === "pending" ||
        c.confirmationStatus === "expired") && (
        <Button
          size="sm"
          variant="outline"
          className="ml-auto font-bold rounded-full"
          disabled={isResending}
          onClick={() => onResend(c)}
          data-testid={`btn-resend-${c.id}`}
        >
          {isResending ? "Sending..." : "Resend confirmation link"}
        </Button>
      )}
    </div>
  );
}
