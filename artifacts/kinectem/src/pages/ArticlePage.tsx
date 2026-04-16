import { useParams, Link } from "wouter";
import { useGetArticle } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Play } from "lucide-react";
import { formatDate, getInitials } from "@/lib/format";

export default function ArticlePage() {
  const params = useParams<{ articleId: string }>();
  const { data, isLoading } = useGetArticle(params.articleId);

  if (isLoading || !data) {
    return <Skeleton className="h-96 rounded-xl" />;
  }

  const { article, highlights } = data;

  return (
    <article className="max-w-3xl mx-auto space-y-8">
      <header>
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <Badge className="bg-primary/10 text-primary hover:bg-primary/10 border-none font-bold uppercase tracking-widest text-[10px]">
            Game Recap
          </Badge>
          {article.teamName && article.teamId && (
            <Link href={`/teams/${article.teamId}`}>
              <Badge variant="outline" className="font-bold cursor-pointer hover:bg-muted">
                {article.teamName}
              </Badge>
            </Link>
          )}
          <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
            {formatDate(article.createdAt)}
          </span>
        </div>

        <h1 className="text-4xl md:text-5xl font-black tracking-tight leading-tight">
          {article.title}
        </h1>

        {(article.opponentName || article.gameScore) && (
          <div className="mt-4 flex items-center gap-3 flex-wrap">
            {article.opponentName && (
              <span className="text-lg font-bold text-muted-foreground">
                vs. {article.opponentName}
              </span>
            )}
            {article.gameScore && (
              <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100 border-none font-black text-base px-3 py-1">
                {article.gameScore}
              </Badge>
            )}
            {article.gameDate && (
              <span className="text-sm text-muted-foreground font-medium">
                {formatDate(article.gameDate)}
              </span>
            )}
          </div>
        )}
      </header>

      {article.coverImageUrl && (
        <img
          src={article.coverImageUrl}
          alt={article.title}
          className="w-full aspect-video object-cover rounded-xl"
        />
      )}

      {article.snippet && (
        <p className="text-xl font-medium text-muted-foreground leading-relaxed border-l-4 border-primary pl-4">
          {article.snippet}
        </p>
      )}

      {article.body && (
        <div className="prose prose-slate max-w-none">
          {article.body.split("\n\n").map((para, i) => (
            <p key={i} className="text-base leading-relaxed text-foreground">
              {para}
            </p>
          ))}
        </div>
      )}

      {article.taggedUsers && article.taggedUsers.length > 0 && (
        <section>
          <h2 className="text-sm font-black uppercase tracking-widest text-muted-foreground mb-3">
            Featured Players
          </h2>
          <div className="flex flex-wrap gap-2">
            {article.taggedUsers.map((u) => (
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

      {highlights && highlights.length > 0 && (
        <section>
          <h2 className="text-xl font-black tracking-tight mb-4">Clips From This Game</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {highlights.map((h) => (
              <Link key={h.id} href={`/highlights/${h.id}`}>
                <Card className="rounded-xl border border-border shadow-sm overflow-hidden group cursor-pointer">
                  <div className="h-40 bg-slate-900 relative flex items-center justify-center">
                    {h.thumbnailUrl && (
                      <img src={h.thumbnailUrl} alt={h.title} className="absolute inset-0 w-full h-full object-cover opacity-60" />
                    )}
                    <div className="w-12 h-12 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center group-hover:bg-primary transition-colors z-10">
                      <Play className="w-5 h-5 text-white ml-1" fill="currentColor" />
                    </div>
                  </div>
                  <CardContent className="p-3">
                    <h3 className="font-bold text-sm">{h.title}</h3>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      )}
    </article>
  );
}
