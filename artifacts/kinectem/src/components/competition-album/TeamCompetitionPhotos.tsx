import { useState } from "react";
import { Link } from "wouter";
import { Trophy } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  useAlbumAuthReset,
  useAlbumSessionId,
  useTeamCompetitionPhotos,
} from "@/lib/competitionAlbum";
import { AlbumMosaic } from "./AlbumMosaic";
import { AlbumViewer } from "./AlbumViewer";

export function TeamCompetitionPhotos({ teamId }: { teamId: string }) {
  const sid = useAlbumSessionId();
  useAlbumAuthReset(sid);
  const q = useTeamCompetitionPhotos(teamId);
  const [index, setIndex] = useState<number | null>(null);
  const photos = q.data?.photos ?? [];

  if (q.isLoading) return <Skeleton className="h-40 rounded-xl" />;
  if (q.isError)
    return (
      <div role="alert" className="flex items-center justify-between gap-2 rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-sm">
        <span className="font-bold text-destructive">Competition photos couldn’t load.</span>
        <Button size="sm" variant="outline" onClick={() => void q.refetch()}>Try again</Button>
      </div>
    );
  if (photos.length === 0) return null;

  const sources = Array.from(new Map(photos.map((p) => [p.competition.id, p.competition])).values());
  const current = index !== null ? photos[index] : null;

  return (
    <section className="app-surface space-y-3 p-4" data-testid="section-team-competition-photos">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg font-black tracking-tight">
          <Trophy className="h-4 w-4" />
          Competition Photos
        </h2>
        <div className="flex flex-wrap gap-2 text-xs font-bold">
          {sources.map((c) => (
            <Link
              key={c.id}
              href={`/competitions/c/${c.slug}#photos`}
              className="rounded-full border px-2.5 py-1 hover:bg-muted"
              data-testid={`link-album-source-${c.id}`}
            >
              {c.name} album
            </Link>
          ))}
        </div>
      </div>
      <AlbumMosaic photos={photos} competition={photos[0].competition} onOpen={setIndex} />
      <AlbumViewer
        photos={photos}
        index={index}
        onIndex={setIndex}
        onClose={() => setIndex(null)}
        competition={current?.competition ?? photos[0].competition}
      />
    </section>
  );
}
