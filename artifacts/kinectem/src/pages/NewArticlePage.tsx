import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import {
  useListOrganizations,
  useGetOrganization,
  useGetTeamRoster,
  useCreateArticle,
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
import { X, Check } from "lucide-react";
import { getInitials } from "@/lib/format";
import { Link } from "wouter";

export default function NewArticlePage() {
  const [, setLocation] = useLocation();
  const { data: me } = useGetCurrentUser();
  const { data: orgs } = useListOrganizations();

  const [orgId, setOrgId] = useState<string>("");
  const [teamId, setTeamId] = useState<string>("");
  const [title, setTitle] = useState("");
  const [snippet, setSnippet] = useState("");
  const [body, setBody] = useState("");
  const [opponentName, setOpponentName] = useState("");
  const [gameScore, setGameScore] = useState("");
  const [gameDate, setGameDate] = useState("");
  const [taggedIds, setTaggedIds] = useState<string[]>([]);

  // Preselect from query string ?teamId=...
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const preTeam = p.get("teamId");
    if (preTeam) setTeamId(preTeam);
  }, []);

  const { data: orgDetail } = useGetOrganization(orgId);
  const teamList = orgDetail?.teams ?? [];
  const { data: roster } = useGetTeamRoster(teamId);
  const players = (roster ?? []).filter((r) => r.role === "player");

  const createArticle = useCreateArticle();

  const togglePlayer = (userId: string) => {
    setTaggedIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId],
    );
  };

  const onPublish = async () => {
    if (!teamId || !title.trim() || !body.trim()) return;
    const res = await createArticle.mutateAsync({
      data: {
        title: title.trim(),
        teamId,
        body: body.trim(),
        snippet: snippet.trim() || undefined,
        opponentName: opponentName.trim() || undefined,
        gameScore: gameScore.trim() || undefined,
        gameDate: gameDate ? new Date(gameDate).toISOString() : undefined,
        taggedUserIds: taggedIds,
      },
    });
    setLocation(`/articles/${res.id}`);
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b border-border bg-card/95 backdrop-blur">
        <div className="mx-auto max-w-3xl px-6 h-16 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-black tracking-tight">New Game Recap</h1>
            <p className="text-xs text-muted-foreground font-medium">
              {me?.name ? `Writing as ${me.name}` : "Create a new recap"}
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
              disabled={!teamId || !title.trim() || !body.trim() || createArticle.isPending}
              className="bg-primary hover:bg-primary/90 text-primary-foreground font-bold px-6"
            >
              {createArticle.isPending ? "Publishing..." : "Publish"}
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-6 py-8 space-y-8">
        <section className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-xs font-black uppercase tracking-widest">
                Organization
              </Label>
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
              <Select value={teamId} onValueChange={setTeamId} disabled={!orgId && teamList.length === 0}>
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
            <Label className="text-xs font-black uppercase tracking-widest">Article Title</Label>
            <Input
              placeholder="e.g. Dominant Victory on Friday Night"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="h-12 bg-card font-bold text-lg"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label className="text-xs font-black uppercase tracking-widest">Opponent</Label>
              <Input
                placeholder="Lincoln HS"
                value={opponentName}
                onChange={(e) => setOpponentName(e.target.value)}
                className="bg-card"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-black uppercase tracking-widest">Score</Label>
              <Input
                placeholder="W 34-14"
                value={gameScore}
                onChange={(e) => setGameScore(e.target.value)}
                className="bg-card"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-black uppercase tracking-widest">Game Date</Label>
              <Input
                type="date"
                value={gameDate}
                onChange={(e) => setGameDate(e.target.value)}
                className="bg-card"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-black uppercase tracking-widest">Summary</Label>
            <Textarea
              placeholder="One-sentence summary..."
              value={snippet}
              onChange={(e) => setSnippet(e.target.value)}
              className="bg-card min-h-[80px]"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-black uppercase tracking-widest">Article Body</Label>
            <Textarea
              placeholder="Write the recap here..."
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="bg-card min-h-[260px] text-base leading-relaxed"
            />
          </div>
        </section>

        <div className="h-px bg-border w-full" />

        <section className="space-y-4">
          <div>
            <Label className="text-xs font-black uppercase tracking-widest">Tag Players</Label>
            <p className="text-xs text-muted-foreground font-medium mt-1">
              Tagged players will be featured on this recap and on their profiles.
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
