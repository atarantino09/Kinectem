import { useEffect, useMemo, useRef, useState } from "react";
import { useSearch } from "wouter";
import { Camera, ChevronDown, ImagePlus, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useToast } from "@/hooks/use-toast";
import {
  errText,
  useAlbumAuthReset,
  useAlbumSessionId,
  useCompetitionAlbum,
  useDeleteAlbumPhoto,
  type AlbumCompetition,
  type AlbumView,
} from "@/lib/competitionAlbum";
import { AlbumMosaic } from "./AlbumMosaic";
import { AlbumViewer, type ViewerPhoto } from "./AlbumViewer";
import { AlbumUploadDialog } from "./AlbumUploadDialog";
import { AlbumReviewPanel } from "./AlbumReviewPanel";
import { AlbumAdminControls } from "./AlbumAdminControls";

export function CompetitionAlbumSection({
  competition,
}: {
  competition: Pick<AlbumCompetition, "id" | "name" | "slug" | "logoUrl" | "brandColor">;
}) {
  const sid = useAlbumSessionId();
  useAlbumAuthReset(sid);
  const signedIn = sid !== "anon";
  const { toast } = useToast();
  const search = useSearch();
  const wantsPending = new URLSearchParams(search).get("album") === "pending";
  const [expanded, setExpanded] = useState(
    () => wantsPending || window.location.hash === "#photos",
  );
  const [view, setView] = useState<AlbumView>(wantsPending ? "pending" : "approved");
  const [teamFilter, setTeamFilter] = useState("all");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [viewer, setViewer] = useState<{ list: ViewerPhoto[]; index: number } | null>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const scrolled = useRef(false);

  const approvedQ = useCompetitionAlbum(competition.id, "approved");
  const album = approvedQ.data;
  const canManage = album?.canManage === true;
  const effectiveView: AlbumView =
    (view === "pending" || view === "rejected") && !canManage
      ? "approved"
      : view === "mine" && !signedIn
        ? "approved"
        : view;
  const otherQ = useCompetitionAlbum(
    competition.id,
    effectiveView,
    effectiveView !== "approved" && !!album,
  );
  const del = useDeleteAlbumPhoto(competition.id);

  useEffect(() => {
    if (wantsPending) {
      setExpanded(true);
      setView("pending");
    }
  }, [wantsPending]);

  useEffect(() => {
    if (scrolled.current || !album) return;
    if (wantsPending || window.location.hash === "#photos") {
      setExpanded(true);
      scrolled.current = true;
      sectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [album, wantsPending]);

  const approved = album?.photos ?? [];
  const teamsWithPhotos = useMemo(() => {
    const ids = new Set(approved.flatMap((p) => p.teamIds));
    return (album?.teams ?? []).filter((t) => ids.has(t.id));
  }, [approved, album?.teams]);
  const filteredApproved =
    teamFilter === "all" ? approved : approved.filter((p) => p.teamIds.includes(teamFilter));

  const brand = competition.brandColor || "#1e293b";
  const meta: AlbumCompetition = album?.competition ?? competition;
  const active = effectiveView === "approved" ? approvedQ : otherQ;
  const showReview =
    canManage && (effectiveView === "pending" || effectiveView === "rejected");
  const [manageApproved, setManageApproved] = useState(false);

  const tabs: { id: AlbumView; label: string; count?: number }[] = [
    { id: "approved", label: "Approved", count: album?.approvedCount },
    ...(signedIn ? [{ id: "mine" as const, label: "My submissions" }] : []),
    ...(canManage
      ? [
          { id: "pending" as const, label: "Pending review", count: album?.pendingCount },
          { id: "rejected" as const, label: "Not approved" },
        ]
      : []),
  ];

  const openViewer = (list: ViewerPhoto[], i: number) => setViewer({ list, index: i });
  const listForView: ViewerPhoto[] =
    effectiveView === "approved" ? filteredApproved : (otherQ.data?.photos ?? []);

  return (
    <Collapsible open={expanded} onOpenChange={setExpanded} asChild>
    <section
      id="photos"
      ref={sectionRef}
      className="competition-section-surface scroll-mt-20 space-y-4 rounded-xl border p-4 shadow-sm sm:p-5"
      style={{ borderTop: `4px solid ${brand}` }}
      data-testid="section-competition-album"
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2>
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-3 rounded-md text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4"
                data-testid="button-toggle-competition-album"
              >
                <span className="min-w-0">
                  <span className="flex items-center gap-2 text-xl font-black tracking-tight">
                    <Camera className="h-5 w-5 shrink-0" style={{ color: brand }} />
                    Photo Album
                    {album && <Badge variant="secondary" data-testid="badge-approved-count">{album.approvedCount}</Badge>}
                  </span>
                  <span className="mt-0.5 block text-sm font-normal text-muted-foreground">
                    {expanded
                      ? `Moments from ${competition.name}, tagged to the teams that played.`
                      : canManage
                        ? "Expand to browse photos, upload, and review team submissions."
                        : "Expand to browse competition photos."}
                  </span>
                </span>
                <ChevronDown
                  aria-hidden="true"
                  className={`h-5 w-5 shrink-0 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`}
                />
              </button>
            </CollapsibleTrigger>
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canManage && (album?.pendingCount ?? 0) > 0 && effectiveView !== "pending" && (
            <Button size="sm" variant="outline" className="font-bold" onClick={() => { setExpanded(true); setView("pending"); }} data-testid="button-review-pending">
              <span className="mr-1.5 rounded-full bg-amber-400 px-1.5 text-xs text-amber-950">{album?.pendingCount}</span>
              Review pending
            </Button>
          )}
          {album?.canUpload && (
            <Button size="sm" variant="brand" className="gap-1.5 font-bold" onClick={() => { setExpanded(true); setUploadOpen(true); }} data-testid="button-add-album-photos">
              <ImagePlus className="h-4 w-4" />
              Add photos
            </Button>
          )}
        </div>
      </div>

      <CollapsibleContent className="space-y-4" data-testid="content-competition-album">
      {album && signedIn && !album.canUpload && !album.contributionsOpen && !canManage && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground" data-testid="text-contributions-closed">
          <Lock className="h-3 w-3" /> Photo contributions are closed for this competition.
        </p>
      )}

      {album?.isCompetitionAdmin && (
        <AlbumAdminControls competitionId={competition.id} contributionsOpen={album.contributionsOpen} />
      )}

      {tabs.length > 1 && (
        <div role="tablist" aria-label="Album views" className="flex flex-wrap gap-1.5">
          {tabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              type="button"
              aria-selected={effectiveView === t.id}
              onClick={() => {
                setView(t.id);
                setManageApproved(false);
              }}
              className={`rounded-full border px-3 py-1 text-xs font-bold ${
                effectiveView === t.id ? "text-white" : "bg-background"
              }`}
              style={effectiveView === t.id ? { background: brand, borderColor: brand } : undefined}
              data-testid={`tab-album-${t.id}`}
            >
              {t.label}
              {t.count !== undefined ? ` (${t.count})` : ""}
            </button>
          ))}
        </div>
      )}

      {effectiveView === "approved" && teamsWithPhotos.length > 0 && !manageApproved && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by team">
          {[{ id: "all", name: "All teams" }, ...teamsWithPhotos].map((t) => (
            <button
              key={t.id}
              type="button"
              aria-pressed={teamFilter === t.id}
              onClick={() => setTeamFilter(t.id)}
              className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
                teamFilter === t.id ? "bg-foreground text-background" : "bg-background"
              }`}
              data-testid={`chip-team-${t.id}`}
            >
              {t.name}
            </button>
          ))}
        </div>
      )}

      {effectiveView === "mine" && (
        <p className="text-xs text-muted-foreground">
          Only you can see your pending and rejected submissions here.
        </p>
      )}

      {approvedQ.isLoading || (effectiveView !== "approved" && otherQ.isLoading) ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="album-loading">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="aspect-square rounded-lg" />
          ))}
        </div>
      ) : approvedQ.isError || (effectiveView !== "approved" && otherQ.isError) ? (
        <div role="alert" className="space-y-2 rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm" data-testid="album-error">
          <p className="font-bold text-destructive">The photo album couldn’t load.</p>
          <Button size="sm" variant="outline" onClick={() => { void approvedQ.refetch(); if (effectiveView !== "approved") void otherQ.refetch(); }}>
            Try again
          </Button>
        </div>
      ) : showReview ? (
        <AlbumReviewPanel
          key={effectiveView}
          competitionId={competition.id}
          status={effectiveView as "pending" | "rejected"}
          photos={otherQ.data?.photos ?? []}
          teams={album?.teams ?? []}
          onOpen={(p) => {
            const list = otherQ.data?.photos ?? [];
            openViewer(list, Math.max(0, list.findIndex((x) => x.id === p.id)));
          }}
        />
      ) : effectiveView === "approved" && manageApproved && canManage ? (
        <AlbumReviewPanel
          competitionId={competition.id}
          status="approved"
          photos={approved}
          teams={album?.teams ?? []}
          onOpen={(p) => openViewer(approved, Math.max(0, approved.findIndex((x) => x.id === p.id)))}
        />
      ) : listForView.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-10 text-center" data-testid="album-empty">
          <Camera className="h-6 w-6 text-muted-foreground" />
          <p className="font-bold">
            {effectiveView === "mine" ? "You haven’t submitted any photos" : "No photos in the album yet"}
          </p>
          <p className="max-w-sm text-sm text-muted-foreground">
            {album?.canUpload
              ? "Add the first photos from this competition."
              : "Approved photos will appear here as soon as they’re added."}
          </p>
        </div>
      ) : (
        <>
          <AlbumMosaic photos={listForView} competition={meta} onOpen={(i) => openViewer(listForView, i)} />
          {effectiveView === "approved" && canManage && (
            <Button size="sm" variant="outline" className="font-bold" onClick={() => setManageApproved(true)} data-testid="button-manage-approved">
              Manage approved photos
            </Button>
          )}
        </>
      )}
      {manageApproved && effectiveView === "approved" && (
        <Button size="sm" variant="ghost" onClick={() => setManageApproved(false)}>
          Back to gallery
        </Button>
      )}
      {active.isFetching && !active.isLoading && <span className="sr-only" role="status">Refreshing album</span>}
      </CollapsibleContent>

      <AlbumViewer
        photos={viewer?.list ?? []}
        index={viewer ? viewer.index : null}
        onIndex={(i) => setViewer((v) => (v ? { ...v, index: i } : v))}
        onClose={() => setViewer(null)}
        competition={meta}
        deleting={del.isPending}
        onDelete={(p) =>
          del.mutate(p.id, {
            onSuccess: () => {
              toast({ title: "Photo deleted" });
              setViewer((v) => {
                if (!v) return v;
                const list = v.list.filter((x) => x.id !== p.id);
                return list.length ? { list, index: Math.min(v.index, list.length - 1) } : null;
              });
            },
            onError: (err) =>
              toast({ title: "Couldn’t delete the photo", description: errText(err), variant: "destructive" }),
          })
        }
      />

      {album && (
        <AlbumUploadDialog
          open={uploadOpen}
          onOpenChange={setUploadOpen}
          competitionId={competition.id}
          teams={album.teams}
          isAdmin={album.isCompetitionAdmin === true}
        />
      )}
    </section>
    </Collapsible>
  );
}
