import { useParams, Link } from "wouter";
import { useGetHighlight } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Play, FileText } from "lucide-react";
import { formatDate, getInitials } from "@/lib/format";

export default function HighlightPage() {
  const params = useParams<{ highlightId: string }>();
  const { data, isLoading } = useGetHighlight(params.highlightId);

  if (isLoading || !data) {
    return <Skeleton className="h-96 rounded-xl" />;
  }

  const { highlight, article } = data;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-2 flex-wrap">
        <Badge className="bg-slate-900 text-primary-foreground border-none font-bold uppercase tracking-widest text-[10px]">
          Highlight
        </Badge>
        {highlight.teamName && highlight.teamId && (
          <Link href={`/teams/${highlight.teamId}`}>
            <Badge variant="outline" className="font-bold cursor-pointer hover:bg-muted">
              {highlight.teamName}
            </Badge>
          </Link>
        )}
        <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
          {formatDate(highlight.createdAt)}
        </span>
      </div>

      <h1 className="text-4xl font-black tracking-tight leading-tight">{highlight.title}</h1>

      <Card className="rounded-xl border border-border shadow-sm overflow-hidden">
        <div className="aspect-video bg-slate-900 relative flex items-center justify-center">
          {highlight.videoUrl ? (
            <video
              src={highlight.videoUrl}
              poster={highlight.thumbnailUrl}
              controls
              className="w-full h-full object-contain"
            />
          ) : (
            <>
              {highlight.thumbnailUrl && (
                <img src={highlight.thumbnailUrl} alt={highlight.title} className="absolute inset-0 w-full h-full object-cover opacity-60" />
              )}
              <div className="w-20 h-20 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center z-10">
                <Play className="w-8 h-8 text-white ml-1" fill="currentColor" />
              </div>
            </>
          )}
        </div>
      </Card>

      {highlight.taggedUsers && highlight.taggedUsers.length > 0 && (
        <section>
          <h2 className="text-sm font-black uppercase tracking-widest text-muted-foreground mb-3">
            Featured Players
          </h2>
          <div className="flex flex-wrap gap-2">
            {highlight.taggedUsers.map((u) => (
              <Link key={u.id} href={`/users/${u.id}`}>
                <div className="flex items-center gap-2 bg-card border border-border rounded-full pl-1 pr-3 py-1 cursor-pointer hover:border-primary transition-colors">
                  <Avatar className="w-6 h-6">
                    {u.avatarUrl && <AvatarImage src={u.avatarUrl} />}
                    <AvatarFallback className="text-[9px] font-bold">
                      {getInitials(u.name)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="text-sm font-bold">{u.name}</span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {article && (
        <Link href={`/articles/${article.id}`}>
          <Card className="rounded-xl border border-border shadow-sm cursor-pointer hover:border-primary/50 transition-colors group">
            <CardContent className="p-4 flex items-center gap-4">
              <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <FileText className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                  From article
                </p>
                <h3 className="font-bold group-hover:text-primary transition-colors">
                  {article.title}
                </h3>
              </div>
            </CardContent>
          </Card>
        </Link>
      )}
    </div>
  );
}
