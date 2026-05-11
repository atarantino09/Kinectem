import { useState } from "react";
import { Link } from "wouter";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/UserAvatar";
import { Users, UserPlus } from "lucide-react";
import type { RosterMember } from "./TeamRosterTabs";

type RailTab = "players" | "staff";

interface TeamRosterRailProps {
  players: RosterMember[];
  staff: RosterMember[];
  canManage?: boolean;
  onOpenInvite?: () => void;
}

export function TeamRosterRail({
  players,
  staff,
  canManage = false,
  onOpenInvite,
}: TeamRosterRailProps) {
  const [tab, setTab] = useState<RailTab>("players");
  const list = tab === "players" ? players : staff;
  const emptyMessage =
    tab === "players" ? "No players yet." : "No staff yet.";

  return (
    <Card
      className="rounded-xl border border-border shadow-sm overflow-hidden"
      data-testid="rail-roster"
    >
      <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Users className="w-5 h-5 text-primary shrink-0" />
          <h2 className="text-base font-black tracking-tight truncate">
            Roster
          </h2>
          <Badge
            variant="outline"
            className="text-[10px] uppercase tracking-wider font-bold"
            data-testid="rail-roster-count"
          >
            {list.length}
          </Badge>
        </div>
        {canManage && onOpenInvite && (
          <Button
            type="button"
            size="sm"
            className="font-bold shrink-0"
            onClick={onOpenInvite}
            data-testid="btn-rail-invite-roster"
          >
            <UserPlus className="w-3.5 h-3.5 mr-1.5" /> Invite
          </Button>
        )}
      </div>

      <div
        className="grid grid-cols-2 gap-1 p-1 bg-muted/40 border-b border-border"
        role="tablist"
        aria-label="Roster type"
      >
        <Button
          type="button"
          size="sm"
          variant={tab === "players" ? "default" : "ghost"}
          className="h-8 font-bold rounded-md"
          onClick={() => setTab("players")}
          role="tab"
          aria-selected={tab === "players"}
          data-testid="btn-rail-tab-players"
        >
          Players
        </Button>
        <Button
          type="button"
          size="sm"
          variant={tab === "staff" ? "default" : "ghost"}
          className="h-8 font-bold rounded-md"
          onClick={() => setTab("staff")}
          role="tab"
          aria-selected={tab === "staff"}
          data-testid="btn-rail-tab-staff"
        >
          Staff
        </Button>
      </div>

      {list.length === 0 ? (
        <div className="p-6 text-center text-sm text-muted-foreground">
          {emptyMessage}
        </div>
      ) : (
        <ul className="flex flex-col p-2">
          {list.map((m) => (
            <li key={m.id}>
              <Link href={`/users/${m.userId}`}>
                <div
                  className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/60 cursor-pointer group"
                  data-testid={`rail-roster-row-${m.id}`}
                >
                  <UserAvatar
                    avatarUrl={m.avatarUrl}
                    displayName={m.displayName}
                    size="sm"
                    fallbackClassName="bg-slate-900 text-primary-foreground"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-sm truncate group-hover:text-primary transition-colors">
                      {m.displayName}
                      {tab === "players" && m.jerseyNumber != null && (
                        <span className="ml-1.5 text-muted-foreground font-semibold tabular-nums">
                          #{m.jerseyNumber}
                        </span>
                      )}
                    </p>
                    <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-bold truncate capitalize">
                      {m.position
                        ? m.position.replace(/_/g, " ")
                        : tab === "players"
                          ? "Player"
                          : "Staff"}
                    </p>
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
