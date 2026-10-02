import { Link } from "wouter";
import { Camera } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useCompetitionAlbum } from "@/lib/competitionAlbum";
import { AlbumAdminControls } from "./AlbumAdminControls";

export function CompetitionAlbumConsolePanel({
  competitionId,
  slug,
}: {
  competitionId: string;
  slug: string;
}) {
  const q = useCompetitionAlbum(competitionId, "approved");
  const a = q.data;
  return (
    <Card data-testid="panel-album-console">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Camera className="h-4 w-4" />
          Photo album
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {q.isLoading ? (
          <Skeleton className="h-16 rounded-lg" />
        ) : q.isError || !a ? (
          <div role="alert" className="flex items-center gap-2 text-sm">
            <span className="font-bold text-destructive">Album settings couldn’t load.</span>
            <Button size="sm" variant="outline" onClick={() => void q.refetch()}>Retry</Button>
          </div>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              {a.approvedCount} approved · {a.pendingCount} pending review
            </p>
            {a.isCompetitionAdmin && (
              <AlbumAdminControls competitionId={competitionId} contributionsOpen={a.contributionsOpen} />
            )}
            <Link
              href={`/competitions/c/${slug}?album=pending#photos`}
              className="inline-block rounded-md border px-3 py-1.5 text-sm font-bold hover:bg-muted"
              data-testid="link-review-album"
            >
              {a.pendingCount > 0 ? `Review ${a.pendingCount} pending photos` : "Open album"}
            </Link>
          </>
        )}
      </CardContent>
    </Card>
  );
}
