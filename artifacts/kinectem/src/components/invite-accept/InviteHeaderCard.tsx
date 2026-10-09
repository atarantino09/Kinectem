import { Link } from "wouter";
import { useState } from "react";
import { formatOrgName } from "@/lib/format";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2 } from "lucide-react";
import { ParentSetupOverview } from "@/components/family-setup/ParentSetupOverview";
import { readOrgBrandColors, orgInviteHeaderStyle } from "@/lib/orgBrand";

interface InviteHeaderCardProps {
  organizationName: string;
  organizationBranding?: {
    logoUrl?: string | null;
    brandPrimaryColor?: string | null;
    brandSecondaryColor?: string | null;
  };
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
  organizationBranding,
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
  const brandColors = readOrgBrandColors(organizationBranding);
  const headerStyle = brandColors ? orgInviteHeaderStyle(brandColors) : undefined;
  const logoUrl = organizationBranding?.logoUrl;
  const [failedLogoUrl, setFailedLogoUrl] = useState<string | null>(null);
  const showLogo = !!logoUrl && logoUrl !== failedLogoUrl;
  return (
    <Card className="rounded-xl border-border overflow-hidden">
      <div
        className={`p-6 text-white ${brandColors ? "" : "bg-gradient-to-br from-purple-600 to-blue-600"}`}
        style={headerStyle}
        data-testid="invite-branded-header"
      >
        <div className="flex items-start gap-3 sm:gap-4">
        {showLogo && (
          <img
            src={logoUrl}
            alt={`${formatOrgName(organizationName)} logo`}
            className="h-14 w-14 shrink-0 rounded-lg bg-white p-1.5 object-contain sm:h-16 sm:w-16"
            onError={() => setFailedLogoUrl(logoUrl)}
            data-testid="invite-org-logo"
          />
        )}
        <div className="min-w-0 flex-1">
        <p className="text-xs uppercase tracking-widest font-bold opacity-90">
          {formatOrgName(organizationName)}
        </p>
        <h1 className="text-3xl font-black tracking-tight mt-1">
          {multipleTeams ? "You're invited to join these teams" : "You're invited to "}
          {!multipleTeams && (
            <span className="underline decoration-current">{teamName}</span>
          )}
        </h1>
        <Badge className="mt-3 font-bold" style={{ color: headerStyle?.color ?? "#ffffff", backgroundColor: `${headerStyle?.color ?? "#ffffff"}1a`, borderColor: `${headerStyle?.color ?? "#ffffff"}4d` }}>
          {isPlayerInvite ? "Parent & child setup" : positionLabel}
        </Badge>
        </div>
        </div>
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
        {isPlayerInvite && !loggedIn && !accepted && (
          <div className="space-y-3">
            <ParentSetupOverview teamName={teamName} />
          </div>
        )}
        {isPlayerInvite && loggedIn && (
          <div className="space-y-2 text-sm text-slate-900">
            {!needsChildSetup && <p>Your parent account is ready. Next: <strong>Step 2 · Add the other parent (optional).</strong></p>}
            <p>When you finish setup, your child{childHint ? ` (${childHint})` : ""} will automatically be added to <strong>{teamName}’s roster</strong>.</p>
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
                  ? "Start with your parent account"
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
              ? "Opening..."
              : isPlayerInvite ? "Continue to family setup" : "Accept invite"}
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
