import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Shield, CheckCircle2 } from "lucide-react";

interface InviteHeaderCardProps {
  organizationName: string;
  teamName: string;
  isPlayerInvite: boolean;
  positionLabel: string | null;
  childHint: string;
  loggedIn: boolean;
  accepted: boolean;
  needsChildSetup: boolean;
  accepting: boolean;
  token: string;
  onAccept: () => void;
}

export function InviteHeaderCard({
  organizationName,
  teamName,
  isPlayerInvite,
  positionLabel,
  childHint,
  loggedIn,
  accepted,
  needsChildSetup,
  accepting,
  token,
  onAccept,
}: InviteHeaderCardProps) {
  const returnTo = encodeURIComponent(`/invites/${token}`);
  return (
    <Card className="rounded-xl border-border overflow-hidden">
      <div className="bg-gradient-to-br from-purple-600 to-blue-600 p-6 text-white">
        <p className="text-xs uppercase tracking-widest font-bold opacity-90">
          {organizationName}
        </p>
        <h1 className="text-3xl font-black tracking-tight mt-1">
          You're invited to{" "}
          <span className="underline decoration-white/40">{teamName}</span>
        </h1>
        <Badge className="mt-3 bg-white/20 text-white border-white/30 font-bold">
          {isPlayerInvite ? "Player roster" : positionLabel}
        </Badge>
      </div>

      <CardContent className="p-6 space-y-4">
        {isPlayerInvite && !accepted && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <Shield className="w-4 h-4 mt-0.5 shrink-0" />
            <p>
              <span className="font-bold">
                This invite is for a parent or guardian.
              </span>{" "}
              After you accept, you'll add your child
              {childHint ? ` (${childHint})` : ""} to the roster — and any
              siblings on the same team.
            </p>
          </div>
        )}
        {!loggedIn && (
          <div className="space-y-2">
            <Link
              href={`/login?signup=${isPlayerInvite ? "parent" : "user"}&returnTo=${returnTo}`}
            >
              <Button
                size="lg"
                className="w-full font-bold rounded-full brand-gradient hover:opacity-90 text-white"
                data-testid="btn-create-guardian"
              >
                {isPlayerInvite
                  ? "Create a guardian account"
                  : "Create your account"}
              </Button>
            </Link>
            <p className="text-xs text-center text-muted-foreground">
              Already on Kinectem?{" "}
              <Link
                href={`/login?returnTo=${returnTo}`}
                className="font-bold text-primary hover:underline"
              >
                Sign in
              </Link>
            </p>
          </div>
        )}
        {loggedIn && !accepted ? (
          <Button
            size="lg"
            onClick={onAccept}
            disabled={accepting}
            className="w-full font-bold rounded-full brand-gradient hover:opacity-90 text-white"
            data-testid="btn-accept-invite"
          >
            {accepting
              ? "Accepting..."
              : `Accept invite${isPlayerInvite ? " as guardian" : ""}`}
          </Button>
        ) : loggedIn && accepted && !needsChildSetup ? (
          <div className="flex items-center justify-center gap-2 text-sm text-emerald-700">
            <CheckCircle2 className="w-4 h-4" />
            <span className="font-bold">Invite accepted</span>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
