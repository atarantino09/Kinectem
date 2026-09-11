import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Link } from "wouter";
import {
  Crown,
  Shield,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Lock,
} from "lucide-react";
import { getInitials } from "@/lib/format";

export type Owner = {
  userId: string | null;
  displayName: string;
  avatarUrl: string | null;
};

export interface ClaimedOrgAccessDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationName: string;
  owner: Owner;
  signedIn: boolean;
  pending: boolean;
  submitted: boolean;
  error: string | null;
  currentUserIsOwner?: boolean;
  onRequestAccess: () => void;
  onCreateAccount: () => void;
  onContinue: () => void;
}

export function ClaimedOrgAccessDialog({
  open,
  onOpenChange,
  organizationName,
  owner,
  signedIn,
  pending,
  submitted,
  error,
  currentUserIsOwner = false,
  onRequestAccess,
  onCreateAccount,
  onContinue,
}: ClaimedOrgAccessDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="dialog-claimed-org-access">
        <DialogHeader>
          <DialogTitle className="font-black tracking-tight">
            Request access to {organizationName}
          </DialogTitle>
          <DialogDescription>
            {organizationName} is already managed on Kinectem. To help protect
            club data, the current owner must approve new administrator
            requests.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-3 p-3 rounded-lg border border-border bg-card mt-2">
          <Avatar className="w-9 h-9 shrink-0">
            {owner.avatarUrl ? (
              <AvatarImage src={owner.avatarUrl} alt={owner.displayName} />
            ) : null}
            <AvatarFallback className="bg-slate-900 text-primary-foreground text-xs font-bold">
              {getInitials(owner.displayName)}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            {owner.userId ? (
              <Link
                href={`/users/${owner.userId}`}
                className="block text-sm font-bold truncate hover:text-primary hover:underline"
              >
                {owner.displayName}
              </Link>
            ) : (
              <p className="text-sm font-bold truncate">{owner.displayName}</p>
            )}
            <div className="mt-0.5">
              <Badge
                variant="default"
                className="text-[10px] font-bold gap-1 bg-amber-500 hover:bg-amber-500 pointer-events-none"
              >
                <Crown className="w-3 h-3" /> Owner
              </Badge>
            </div>
          </div>
          <Lock className="w-4 h-4 text-muted-foreground mr-1" />
        </div>

        {error && !submitted && (
          <div
            className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive font-medium flex items-center gap-2 mt-2"
            data-testid="claimed-org-error"
          >
            <AlertTriangle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}

        {currentUserIsOwner ? (
          <div
            className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-950 mt-4"
            data-testid="claimed-org-current-owner"
          >
            <div className="flex items-start gap-3">
              <Crown className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
              <div className="space-y-2">
                <p className="font-black">This is your organization</p>
                <p className="text-sm leading-relaxed">
                  Continue to the club page to manage administrators, members,
                  teams, and ownership.
                </p>
              </div>
            </div>
          </div>
        ) : submitted ? (
          <div
            className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-950 mt-4"
            data-testid="claimed-org-success"
          >
            <div className="flex items-start gap-3">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
              <div className="space-y-2">
                <p className="font-black">Request sent securely</p>
                <p className="text-sm leading-relaxed">
                  We've notified {owner.displayName} of your request. You will receive an email as soon as they approve your access.
                </p>
              </div>
            </div>
          </div>
        ) : !signedIn ? (
          <div
            className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-blue-950 mt-4"
            data-testid="claimed-org-sign-in"
          >
            <div className="flex items-start gap-3">
              <Shield className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" />
              <div className="space-y-2">
                <p className="font-black">Sign in to verify your identity</p>
                <p className="text-sm leading-relaxed">
                  To request administrative access, you must first sign in to Kinectem so the club owner knows who is asking.
                </p>
              </div>
            </div>
          </div>
        ) : null}

        <div className="mt-6 flex flex-col gap-3">
          {submitted || currentUserIsOwner ? (
            <Button
              className="w-full font-bold h-11"
              onClick={onContinue}
              data-testid="btn-claimed-org-continue"
            >
              Done
            </Button>
          ) : !signedIn ? (
            <Button
              className="w-full font-bold h-11"
              onClick={onCreateAccount}
              data-testid="btn-claimed-org-create-account"
            >
              Sign in or create an account
            </Button>
          ) : (
            <Button
              className="w-full font-bold h-11"
              onClick={onRequestAccess}
              disabled={pending}
              data-testid="btn-claimed-org-request"
            >
              {pending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Sending request...
                </>
              ) : (
                "Request admin access"
              )}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
