import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Play, FileText, Users, Trophy } from "lucide-react";
import type { FeedItem } from "@workspace/api-client-react";
import { timeAgo } from "@/lib/format";

function kindMeta(kind: FeedItem["kind"]) {
  switch (kind) {
    case "article":
      return { label: "Article", icon: FileText, className: "bg-blue-50 text-blue-700" };
    case "highlight":
      return { label: "Highlight", icon: Play, className: "bg-slate-900 text-primary-foreground" };
    case "roster":
      return { label: "Roster", icon: Users, className: "bg-emerald-50 text-emerald-700" };
    case "team":
      return { label: "Team", icon: Trophy, className: "bg-amber-50 text-amber-700" };
  }
}

export function FeedItemCard({ item }: { item: FeedItem }) {
  const meta = kindMeta(item.kind);
  const Icon = meta.icon;

  if (item.kind === "article" && item.article) {
    const a = item.article;
    return (
      <Card className="rounded-xl border border-border shadow-sm overflow-hidden">
        <CardContent className="p-0">
          <div className="px-5 py-4 flex items-center justify-between border-b border-border/60">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-slate-900 flex items-center justify-center">
                <FileText className="w-4 h-4 text-primary" />
              </div>
              <div>
                <p className="font-bold text-sm">{a.teamName ?? "Team"}</p>
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mt-0.5">
                  {timeAgo(item.createdAt)}
                </p>
              </div>
            </div>
            <Badge className={`${meta.className} border-none font-bold uppercase text-[10px] tracking-widest`}>
              Game Recap
            </Badge>
          </div>
          <Link href={`/articles/${a.id}`}>
            <div className="px-5 py-4 hover:bg-muted/40 cursor-pointer">
              <h3 className="font-black text-xl tracking-tight leading-tight mb-2">{a.title}</h3>
              {a.gameScore && a.opponentName && (
                <p className="text-sm font-bold text-primary mb-2">
                  vs. {a.opponentName} — {a.gameScore}
                </p>
              )}
              {a.snippet && (
                <p className="text-sm text-muted-foreground leading-relaxed line-clamp-3">{a.snippet}</p>
              )}
              {a.taggedUsers && a.taggedUsers.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {a.taggedUsers.slice(0, 5).map((u) => (
                    <Badge key={u.id} variant="outline" className="bg-muted text-foreground font-bold text-xs">
                      @{u.name}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </Link>
        </CardContent>
      </Card>
    );
  }

  if (item.kind === "highlight" && item.highlight) {
    const h = item.highlight;
    return (
      <Card className="rounded-xl border border-border shadow-sm overflow-hidden">
        <CardContent className="p-0">
          <div className="px-5 py-4 flex items-center justify-between border-b border-border/60">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-slate-900 flex items-center justify-center">
                <Play className="w-4 h-4 text-primary" fill="currentColor" />
              </div>
              <div>
                <p className="font-bold text-sm">{h.teamName ?? "Team"}</p>
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mt-0.5">
                  {timeAgo(item.createdAt)}
                </p>
              </div>
            </div>
            <Badge className={`${meta.className} border-none font-bold uppercase text-[10px] tracking-widest`}>
              Highlight
            </Badge>
          </div>
          <Link href={`/highlights/${h.id}`}>
            <div className="cursor-pointer">
              <div className="h-72 bg-gradient-to-br from-slate-900 to-slate-800 relative flex items-center justify-center group">
                {h.thumbnailUrl && (
                  <img src={h.thumbnailUrl} alt={h.title} className="absolute inset-0 w-full h-full object-cover opacity-60" />
                )}
                <div className="w-16 h-16 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center group-hover:bg-primary transition-colors z-10">
                  <Play className="w-6 h-6 text-white ml-1" fill="currentColor" />
                </div>
                {h.durationSeconds && (
                  <div className="absolute top-3 right-3 bg-black/60 text-white text-[10px] font-bold px-2 py-1 rounded backdrop-blur-sm">
                    {Math.floor(h.durationSeconds / 60)}:{String(h.durationSeconds % 60).padStart(2, "0")}
                  </div>
                )}
              </div>
              <div className="px-5 py-4">
                <h3 className="font-bold text-base leading-tight">{h.title}</h3>
                {h.taggedUsers && h.taggedUsers.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    {h.taggedUsers.slice(0, 5).map((u) => (
                      <Badge key={u.id} variant="outline" className="bg-muted text-foreground font-bold text-xs">
                        @{u.name}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </Link>
        </CardContent>
      </Card>
    );
  }

  // roster / team fallback
  return (
    <Card className="rounded-xl border border-border shadow-sm">
      <CardContent className="p-5">
        <div className="flex items-start gap-4">
          <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${meta.className}`}>
            <Icon className="w-4 h-4" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <Badge className={`${meta.className} border-none font-bold uppercase text-[10px] tracking-widest`}>
                {meta.label}
              </Badge>
              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                {timeAgo(item.createdAt)}
              </span>
            </div>
            <p className="text-sm font-medium leading-snug">
              {item.message ?? "New activity"}
            </p>
            {item.team && (
              <Link href={`/teams/${item.team.id}`}>
                <p className="mt-2 text-sm font-bold text-primary hover:underline cursor-pointer">
                  {item.team.name}
                </p>
              </Link>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
