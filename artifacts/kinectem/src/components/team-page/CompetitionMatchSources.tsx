import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { formatDateUTC } from "@/lib/format";

export interface RecapCompetition {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
}
export interface RecapCompetitionMatch {
  id: string;
  title: string;
  gameDate: string | null;
  opponentName: string | null;
  teamScore: number | null;
  opponentScore: number | null;
  recapId: string | null;
  eligible: boolean;
  blockedReason: string | null;
  requiresConfirmation: boolean;
}

export function CompetitionMatchSources({
  competitions, competitionId, matches, selected, loading, error,
  confirmedPlayed, onCompetitionChange, onSelectionChange, onConfirmPlayed,
}: {
  competitions: RecapCompetition[];
  competitionId: string;
  matches: RecapCompetitionMatch[];
  selected: Set<string>;
  loading: boolean;
  error: string | null;
  confirmedPlayed: boolean;
  onCompetitionChange: (id: string) => void;
  onSelectionChange: (ids: Set<string>) => void;
  onConfirmPlayed: (value: boolean) => void;
}) {
  const eligible = matches.filter((m) => m.eligible);
  const needsConfirmation = matches.filter((m) => selected.has(m.id) && m.requiresConfirmation).length;
  return <div className="space-y-3 rounded-lg border p-3">
    <Label htmlFor="combined-recap-competition">Competition</Label>
    <select id="combined-recap-competition" value={competitionId}
      onChange={(e) => onCompetitionChange(e.target.value)}
      className="h-10 w-full min-w-0 rounded-md border bg-background px-3 text-sm"
      data-testid="select-season-recap-competition">
      <option value="">Choose a competition</option>
      {competitions.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.startDate} – {c.endDate}</option>)}
    </select>
    <p className="text-xs text-muted-foreground">
      Uses your team’s full competition schedule, not recap posting dates. Select up to 25 matches; games without a recap use only confirmed facts.
    </p>
    {loading ? <p role="status" className="text-sm">Loading competition matches…</p>
      : error ? <p role="alert" className="text-sm text-destructive">{error}</p>
      : !competitions.length ? <p className="text-sm text-muted-foreground">No competitions are linked to this team.</p>
      : competitionId && <>
        <Button type="button" variant="outline" size="sm" disabled={!eligible.length}
          onClick={() => onSelectionChange(new Set(eligible.map((m) => m.id)))}
          data-testid="button-select-all-competition-matches">
          Select all competition matches ({eligible.length})
        </Button>
        <p className="text-xs">{selected.size} of {eligible.length} available matches selected</p>
        {!matches.length && <p className="text-sm">No matches are listed for this team in this competition.</p>}
        {selected.size > 25 && <p role="alert" className="text-sm text-destructive">Select 25 or fewer matches before generating. None have been discarded.</p>}
        <div className="max-h-60 divide-y overflow-y-auto rounded-md border">
          {matches.map((m) => <label key={m.id}
            className={`flex items-start gap-3 p-3 ${m.eligible ? "cursor-pointer hover:bg-muted/50" : "opacity-60"}`}>
            <Checkbox checked={selected.has(m.id)} disabled={!m.eligible}
              aria-label={`Include ${m.opponentName || m.title}`}
              data-testid={`checkbox-competition-match-${m.id}`}
              onCheckedChange={(checked) => {
                const next = new Set(selected);
                if (checked) next.add(m.id); else next.delete(m.id);
                onSelectionChange(next);
              }} />
            <div className="min-w-0 text-sm">
              <p className="font-semibold">{m.opponentName ? `vs ${m.opponentName}` : m.title}</p>
              <p className="text-xs text-muted-foreground">
                {m.gameDate ? formatDateUTC(m.gameDate) : "Game date unknown"}
                {m.teamScore != null && m.opponentScore != null ? ` · ${m.teamScore}-${m.opponentScore}` : " · Score unknown"}
              </p>
              <p className="text-xs">{m.blockedReason || (m.recapId ? "Published recap available" : "No individual recap — confirmed facts only")}
                {m.requiresConfirmation && " · Confirm played below"}</p>
            </div>
          </label>)}
        </div>
        {!!needsConfirmation && <label className="flex items-start gap-2 rounded-md bg-muted p-3 text-sm">
          <Checkbox checked={confirmedPlayed} onCheckedChange={(v) => onConfirmPlayed(v === true)}
            data-testid="checkbox-confirm-competition-played" />
          <span>I confirm the {needsConfirmation} selected {needsConfirmation === 1 ? "match" : "matches"} marked “Confirm played” {needsConfirmation === 1 ? "was" : "were"} played. A scheduled date alone doesn’t confirm a game took place.</span>
        </label>}
      </>}
  </div>;
}
