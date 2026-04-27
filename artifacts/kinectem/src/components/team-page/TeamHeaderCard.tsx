import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AvatarLightbox } from "@/components/AvatarLightbox";
import { TeamDescription } from "./TeamDescription";
import {
  Shield,
  Trophy,
  Newspaper,
  Users,
  Pencil,
} from "lucide-react";

export type TeamPanel = "posts" | "roster" | "admin";

interface Team {
  id: string;
  name: string;
  description?: string | null;
  sport?: string | null;
  level?: string | null;
  avatarUrl?: string | null;
  isFollowing?: boolean;
  followerCount?: number;
  organization: {
    id: string;
    name: string;
    avatarUrl?: string | null;
  };
  currentSeason?: { id?: string; name?: string } | null;
}

interface TeamHeaderCardProps {
  team: Team;
  isAdmin: boolean;
  expanded: TeamPanel;
  playerCount: number;
  staffCount: number;
  followPending: boolean;
  onSetExpanded: (p: TeamPanel) => void;
  onToggleFollow: () => void;
  onEdit: () => void;
  onOpenFollowers: () => void;
}

export function TeamHeaderCard({
  team,
  isAdmin,
  expanded,
  playerCount,
  staffCount,
  followPending,
  onSetExpanded,
  onToggleFollow,
  onEdit,
  onOpenFollowers,
}: TeamHeaderCardProps) {
  const logoUrl =
    team.avatarUrl ||
    (team.organization as { avatarUrl?: string | null })?.avatarUrl ||
    "";
  return (
    <Card className="rounded-xl border border-border shadow-sm">
      <CardContent className="p-6">
        <div className="flex items-start justify-between mb-4 flex-wrap gap-2">
          <Link href={`/organizations/${team.organization.id}`}>
            <Badge
              variant="outline"
              className="bg-muted text-muted-foreground border-border font-bold px-2 py-0.5 text-xs uppercase tracking-wider cursor-pointer hover:bg-muted/80"
            >
              {team.organization.name}
            </Badge>
          </Link>
          {team.currentSeason && (
            <Badge className="bg-primary/10 text-primary hover:bg-primary/10 border-none font-bold">
              {team.currentSeason.name}
            </Badge>
          )}
        </div>
        <div className="flex items-start gap-6 mb-3">
          <div className="shrink-0">
            <AvatarLightbox
              avatarUrl={logoUrl || null}
              displayName={team.name}
              ariaLabel={`View ${team.name}'s logo`}
              triggerClassName="rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              triggerTestId="btn-open-team-logo-lightbox"
              dialogTestId="dialog-team-logo-lightbox"
              imageTestId="img-team-logo-lightbox"
            >
              <div className="w-36 h-36 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 border border-border overflow-hidden flex items-center justify-center">
                {logoUrl ? (
                  <img
                    src={logoUrl}
                    alt={team.name}
                    className="w-full h-full object-cover"
                    data-testid="img-team-photo"
                  />
                ) : (
                  <span className="text-5xl font-black text-primary">
                    {team.name.slice(0, 2).toUpperCase()}
                  </span>
                )}
              </div>
            </AvatarLightbox>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start gap-3 flex-wrap">
              <h1 className="text-5xl font-black tracking-tight leading-[1.05]">
                {team.name}
              </h1>
              {isAdmin && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-3 font-bold rounded-full mt-2"
                  onClick={onEdit}
                  data-testid="btn-edit-team"
                >
                  <Pencil className="w-3.5 h-3.5 mr-1.5" />
                  Edit
                </Button>
              )}
            </div>
            {team.description && (
              <TeamDescription
                description={team.description}
                teamName={team.name}
              />
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {team.sport && (
            <div className="font-bold text-foreground flex items-center gap-1.5 bg-muted px-3 py-1.5 rounded-md text-sm">
              <Trophy className="w-4 h-4 text-amber-500" />
              {team.sport}
            </div>
          )}
          {team.level && (
            <div className="font-bold text-muted-foreground text-sm uppercase tracking-wider">
              {team.level}
            </div>
          )}
          <div className="ml-auto flex items-center gap-2 flex-wrap">
            <Button
              size="sm"
              variant={expanded === "posts" ? "default" : "outline"}
              className="font-bold rounded-full"
              onClick={() => onSetExpanded("posts")}
              data-testid="btn-toggle-posts"
            >
              <Newspaper className="w-3.5 h-3.5 mr-1.5" />
              Recent Posts
            </Button>
            <Button
              size="sm"
              variant={expanded === "roster" ? "default" : "outline"}
              className="font-bold rounded-full"
              onClick={() => onSetExpanded("roster")}
              data-testid="btn-toggle-roster"
            >
              <Users className="w-3.5 h-3.5 mr-1.5" />
              Roster ({playerCount}
              {staffCount > 0 ? ` · ${staffCount}` : ""})
            </Button>
            {isAdmin && (
              <Button
                size="sm"
                variant={expanded === "admin" ? "default" : "outline"}
                className="font-bold rounded-full"
                onClick={() => onSetExpanded("admin")}
                data-testid="btn-toggle-admin"
              >
                <Shield className="w-3.5 h-3.5 mr-1.5" />
                Admin Tools
              </Button>
            )}
            <Button
              className="bg-primary text-primary-foreground font-bold rounded-full px-5"
              onClick={onToggleFollow}
              disabled={followPending}
              data-testid="btn-follow-team"
            >
              {team.isFollowing ? "Following" : "Follow"}
            </Button>
            <Button
              variant="outline"
              className="font-bold rounded-full"
              onClick={onOpenFollowers}
              data-testid="btn-view-team-followers"
            >
              <Users className="w-4 h-4 mr-1.5" />
              {team.followerCount} Followers
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
