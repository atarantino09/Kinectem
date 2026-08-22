import { Link } from "wouter";
import { formatOrgName } from "@/lib/format";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Shield, CheckCircle2 } from "lucide-react";

interface InviteHeaderCardProps {
  organizationName: string;
  teamName: string;
  teamNames?: string[];
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
  teamNames,
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
  const multipleTeams = (teamNames?.length ?? 0) > 1;
  return (
    <Card className="rounded-xl border-border overflow-hidden">
      <div className="bg-gradient-to-br from-purple-600 to-blue-600 p-6 text-white">
        <p className="text-xs uppercase tracking-widest font-bold opacity-90">
          {formatOrgName(organizationName)}
        </p>
        <h1 className="text-3xl font-black tracking-tight mt-1">
          {multipleTeams ? "You're invited to join these teams" : "You're invited to "}
          {!multipleTeams && (
            <span className="underline decoration-white/40">{teamName}</span>
          )}
        </h1>
        <Badge className="mt-3 bg-white/20 text-white border-white/30 font-bold">
          {isPlayerInvite ? "Player roster" : positionLabel}
        </Badge>
      </div>

      <CardContent className="p-6 space-y-4">
        {multipleTeams && (
          <div
            className="rounded-lg border border-border bg-muted/30 p-3"
            data-testid="list-grouped-invite-teams"
          >
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              You’ll join as {positionLabel ?? "Coach"} on:
            </p>
            <ul className="mt-2 space-y-1 text-sm font-semibold">
              {teamNames!.map((name) => (
                <li key={name}>• {name}</li>
              ))}
            </ul>
          </div>
        )}
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
                variant="brand"
                size="lg"
                className="w-full"
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
            variant="brand"
            size="lg"
            onClick={onAccept}
            disabled={accepting}
            className="w-full"
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
