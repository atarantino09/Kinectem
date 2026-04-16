import { useState, useEffect } from "react";
import { useLocation, Link } from "wouter";
import {
  useListOrganizations,
  useGetOrganization,
  useGetTeamRoster,
  useCreateHighlight,
  useGetCurrentUser,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { X, Check, Play } from "lucide-react";
import { getInitials } from "@/lib/format";

export default function NewHighlightPage() {
  const [, setLocation] = useLocation();
  const { data: me } = useGetCurrentUser();
  const { data: orgs } = useListOrganizations();

  const [orgId, setOrgId] = useState<string>("");
  const [teamId, setTeamId] = useState<string>("");
  const [title, setTitle] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [thumbnailUrl, setThumbnailUrl] = useState("");
  const [duration, setDuration] = useState("");
  const [taggedIds, setTaggedIds] = useState<string[]>([]);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const preTeam = p.get("teamId");
    if (preTeam) setTeamId(preTeam);
  }, []);

  const { data: orgDetail } = useGetOrganization(orgId);
  const teamList = orgDetail?.teams ?? [];
  const { data: roster } = useGetTeamRoster(teamId);
  const players = (roster ?? []).filter((r) => r.role === "player");

  const createHighlight = useCreateHighlight();

  const togglePlayer = (userId: string) => {
    setTaggedIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId],
    );
  };

  const onPublish = async () => {
    if (!teamId || !title.trim()) return;
    const durationNum = duration ? parseInt(duration, 10) : undefined;
    const res = await createHighlight.mutateAsync({
      data: {
        title: title.trim(),
        teamId,
        videoUrl: videoUrl.trim() || undefined,
        thumbnailUrl: thumbnailUrl.trim() || undefined,
        durationSeconds: durationNum && !Number.isNaN(durationNum) ? durationNum : undefined,
        taggedUserIds: taggedIds,
      },
    });
    setLocation(`/highlights/${res.id}`);
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b border-border bg-card/95 backdrop-blur">
        <div className="mx-auto max-w-3xl px-6 h-16 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-black tracking-tight">New Highlight</h1>
            <p className="text-xs text-muted-foreground font-medium">
              {me?.name ? `Uploading as ${me.name}` : "Upload a clip"}
            </p>
          </div>
          <div className="flex gap-2">
            <Link href="/">
              <Button variant="ghost" className="font-bold">
                Cancel
              </Button>
            </Link>
            <Button
              onClick={onPublish}
              disabled={!teamId || !title.trim() || createHighlight.isPending}
              className="bg-primary hover:bg-primary/90 text-primary-foreground font-bold px-6"
            >
              {createHighlight.isPending ? "Publishing..." : "Publish"}
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-6 py-8 space-y-8">
        <section className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-xs font-black uppercase tracking-widest">Organization</Label>
              <Select value={orgId} onValueChange={(v) => { setOrgId(v); setTeamId(""); }}>
                <SelectTrigger className="h-11 bg-card">
                  <SelectValue placeholder="Select organization" />
                </SelectTrigger>
                <SelectContent>
                  {orgs?.map((o) => (
                    <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-black uppercase tracking-widest">Team</Label>
              <Select value={teamId} onValueChange={setTeamId}>
                <SelectTrigger className="h-11 bg-card">
                  <SelectValue placeholder="Select team" />
                </SelectTrigger>
                <SelectContent>
                  {teamList.map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-black uppercase tracking-widest">Title</Label>
            <Input
              placeholder="e.g. 40-yard TD Catch vs. Lincoln HS"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="h-12 bg-card font-bold text-lg"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-black uppercase tracking-widest">Video URL</Label>
            <Input
              type="url"
              placeholder="https://..."
              value={videoUrl}
              onChange={(e) => setVideoUrl(e.target.value)}
              className="bg-card"
            />
            <p className="text-xs text-muted-foreground font-medium">
              Paste a direct link to the video file (MP4, MOV).
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-xs font-black uppercase tracking-widest">Thumbnail URL (optional)</Label>
              <Input
                type="url"
                placeholder="https://..."
                value={thumbnailUrl}
                onChange={(e) => setThumbnailUrl(e.target.value)}
                className="bg-card"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-black uppercase tracking-widest">Duration (seconds)</Label>
              <Input
                type="number"
                min={0}
                placeholder="24"
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                className="bg-card"
              />
            </div>
          </div>

          {(thumbnailUrl || videoUrl) && (
            <Card className="rounded-xl border border-border overflow-hidden">
              <div className="aspect-video bg-slate-900 relative flex items-center justify-center">
                {thumbnailUrl ? (
                  <img src={thumbnailUrl} alt="Preview" className="absolute inset-0 w-full h-full object-cover opacity-70" />
                ) : null}
                <div className="w-14 h-14 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center z-10">
                  <Play className="w-6 h-6 text-white ml-1" fill="currentColor" />
                </div>
              </div>
            </Card>
          )}
        </section>

        <div className="h-px bg-border w-full" />

        <section className="space-y-4">
          <div>
            <Label className="text-xs font-black uppercase tracking-widest">Tag Players</Label>
            <p className="text-xs text-muted-foreground font-medium mt-1">
              Tagged players will have this highlight on their profile.
            </p>
          </div>

          {taggedIds.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {taggedIds.map((id) => {
                const p = players.find((x) => x.user.id === id);
                if (!p) return null;
                return (
                  <Badge key={id} variant="secondary" className="bg-muted text-foreground font-bold px-2 py-1 pr-1 flex items-center gap-1">
                    {p.user.name} {p.jerseyNumber ? `#${p.jerseyNumber}` : ""}
                    <button
                      onClick={() => togglePlayer(id)}
                      className="w-4 h-4 rounded-full hover:bg-border flex items-center justify-center"
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </Badge>
                );
              })}
            </div>
          )}

          <Card className="rounded-xl border border-border">
            <CardContent className="p-0 divide-y divide-border">
              {!teamId && (
                <div className="p-6 text-sm text-muted-foreground text-center">
                  Select a team to load the roster.
                </div>
              )}
              {teamId && players.length === 0 && (
                <div className="p-6 text-sm text-muted-foreground text-center">
                  No players on this team's roster.
                </div>
              )}
              {players.map((p) => {
                const selected = taggedIds.includes(p.user.id);
                return (
                  <button
                    key={p.id}
                    onClick={() => togglePlayer(p.user.id)}
                    className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-muted/60 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <Avatar className="w-10 h-10 rounded-md">
                        {p.user.avatarUrl && <AvatarImage src={p.user.avatarUrl} />}
                        <AvatarFallback className="rounded-md bg-muted text-muted-foreground font-bold text-xs">
                          {getInitials(p.user.name)}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="text-sm font-bold">{p.user.name}</p>
                        <p className="text-xs text-muted-foreground font-medium">
                          {p.position ?? "—"} {p.jerseyNumber ? `• #${p.jerseyNumber}` : ""}
                        </p>
                      </div>
                    </div>
                    <div
                      className={`w-6 h-6 rounded-full border-2 flex items-center justify-center ${
                        selected ? "bg-primary border-primary" : "border-border"
                      }`}
                    >
                      {selected && <Check className="w-3.5 h-3.5 text-primary-foreground" />}
                    </div>
                  </button>
                );
              })}
            </CardContent>
          </Card>
        </section>
      </div>
    </div>
  );
}
