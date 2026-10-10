import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ClaimedCompetition, CompetitionGameOption } from "./useNewPostForm";

type Props = {
  open: boolean;
  teamId: string;
  competitions: ClaimedCompetition[];
  onConfirm: (competitionId: string, game?: CompetitionGameOption) => void;
  onCancel: () => void;
};

type ScheduleResponse = {
  data: { tournamentId: string; matches: CompetitionGameOption[] }[];
};

function localToday(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function range(c: ClaimedCompetition): string {
  const s = c.startDate?.slice(0, 10);
  const e = c.endDate?.slice(0, 10);
  if (s && e) return `${s} to ${e}`;
  return s ?? e ?? "";
}

function gameLabel(g: CompetitionGameOption): string {
  const opp = g.opponentName ?? "Opponent TBD";
  return `${g.matchDate ?? "No date"} - ${g.isHome ? "vs" : "at"} ${opp} (Game ${g.matchNumber})`;
}

function Body({ teamId, competitions, onConfirm, onCancel }: Omit<Props, "open">) {
  const [linked, setLinked] = useState(true);
  const [compId, setCompId] = useState(competitions.length === 1 ? competitions[0].id : "");
  const [gameId, setGameId] = useState("");
  const selected = competitions.find((c) => c.id === compId);

  const q = useQuery({
    queryKey: ["recap-prompt-schedule", teamId],
    enabled: linked && !!compId,
    queryFn: () =>
      customFetch<ScheduleResponse>(`/api/v1/teams/${teamId}/tournament-schedule`),
  });

  const today = localToday();
  const games = (q.data?.data ?? [])
    .filter((t) => t.tournamentId === compId)
    .flatMap((t) => t.matches)
    .filter((m) => m.matchDate && m.matchDate.slice(0, 10) <= today);
  const game = games.find((g) => g.id === gameId);

  const canContinue = !linked || !!compId;
  const submit = () => {
    if (!linked) return onConfirm("");
    if (compId) onConfirm(compId, game);
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Link this recap to a competition?</DialogTitle>
        <DialogDescription>
          Your team has a competition during this game date. If this was a
          competition game, choose the competition below.{" "}
          Linking adds competition branding and makes this recap available to the
          competition admin, who may choose to feature it. It is not automatically
          featured publicly.
        </DialogDescription>
      </DialogHeader>

      <label className="flex items-center gap-2 text-sm font-medium">
        <Checkbox
          checked={linked}
          onCheckedChange={(v) => setLinked(v === true)}
          data-testid="checkbox-competition-linked"
        />
        This game is part of a competition
      </label>

      {linked && (
        <div className="space-y-3">
          {competitions.length > 1 && (
            <p className="text-xs text-muted-foreground">
              Your team is in several competitions. Choose the one this game belongs to.
            </p>
          )}
          <div role="radiogroup" aria-label="Competition" className="space-y-2">
            {competitions.map((c) => (
              <label
                key={c.id}
                className="flex cursor-pointer items-start gap-2 rounded-md border p-2 text-sm"
              >
                <input
                  type="radio"
                  name="competition"
                  value={c.id}
                  checked={compId === c.id}
                  onChange={() => {
                    setCompId(c.id);
                    setGameId("");
                  }}
                  className="mt-1"
                  data-testid={`radio-competition-${c.id}`}
                />
                <span>
                  <span className="block font-medium">{c.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {[c.type, range(c)].filter(Boolean).join(" - ")}
                  </span>
                </span>
              </label>
            ))}
          </div>

          {selected && (
            <div className="space-y-1" data-testid="section-game">
              <label htmlFor="recap-game" className="text-sm font-medium">
                Game (optional)
              </label>
              {q.isLoading ? (
                <p className="text-xs text-muted-foreground" data-testid="text-games-loading">
                  Loading played games...
                </p>
              ) : q.isError ? (
                <div className="text-xs text-muted-foreground" data-testid="text-games-error">
                  We could not load your games. You can still link the competition
                  without a specific game.{" "}
                  <button
                    type="button"
                    className="underline"
                    onClick={() => void q.refetch()}
                    data-testid="button-games-retry"
                  >
                    Retry
                  </button>
                </div>
              ) : (
                <>
                  <select
                    id="recap-game"
                    value={gameId}
                    onChange={(e) => setGameId(e.target.value)}
                    className="h-10 w-full rounded-md border bg-background px-2 text-sm"
                    data-testid="select-game"
                  >
                    <option value="">Not sure / no specific game</option>
                    {games.map((g) => (
                      <option key={g.id} value={g.id}>
                        {gameLabel(g)}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-muted-foreground">
                    {games.length
                      ? "If the game is listed, choose it so the recap links to the right match."
                      : "No played games listed yet. The game will be matched by date."}
                  </p>
                </>
              )}
            </div>
          )}
        </div>
      )}

      <DialogFooter className="gap-2 sm:gap-0">
        <Button variant="outline" onClick={onCancel} data-testid="button-competition-cancel">
          Back
        </Button>
        <Button onClick={submit} disabled={!canContinue} data-testid="button-competition-continue">
          {linked ? "Link and continue" : "Continue without a competition"}
        </Button>
      </DialogFooter>
    </>
  );
}

export function RecapCompetitionPrompt(props: Props) {
  const { open, onCancel, ...rest } = props;
  const key = `${rest.teamId}|${rest.competitions.map((c) => c.id).join(",")}`;
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onCancel(); }}>
      <DialogContent
        onEscapeKeyDown={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        className="max-w-md"
      >
        <Body key={key} {...rest} onCancel={onCancel} />
      </DialogContent>
    </Dialog>
  );
}

export default RecapCompetitionPrompt;
