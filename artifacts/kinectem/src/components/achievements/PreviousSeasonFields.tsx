import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type PreviousSeasonState = {
  enabled: boolean; season: string; playedDate: string; attested: boolean; problem: string | null;
  setEnabled: (v: boolean) => void; setSeason: (v: string) => void;
  setPlayedDate: (v: string) => void; setAttested: (v: boolean) => void;
};

export function PreviousSeasonFields({ state }: { state: PreviousSeasonState }) {
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  return (
    <div className="mt-5 rounded-xl border border-border bg-muted/20 p-4 space-y-3" data-testid="section-previous-season">
      <div className="flex items-start gap-3">
        <Checkbox id="prev-season" checked={state.enabled} onCheckedChange={(v) => state.setEnabled(v === true)} data-testid="checkbox-previous-season" />
        <div>
          <Label htmlFor="prev-season" className="font-bold">Previous-season game</Label>
          <p className="text-xs text-muted-foreground mt-0.5">
            Recapping a game from an earlier season. It is saved as a game recap but does not count toward current-game totals or streaks.
            {" "}Use the actual game date, not the posting date. You decide which season the game belonged to; a past-week game is not automatically retro.
          </p>
        </div>
      </div>
      {state.enabled && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="prev-season-name" className="text-xs font-black uppercase tracking-widest text-muted-foreground">Season or year</Label>
            <Input id="prev-season-name" value={state.season} maxLength={40} placeholder="e.g. 2023-24" onChange={(e) => state.setSeason(e.target.value)} className="mt-2 font-bold" data-testid="input-previous-season" />
          </div>
          <div>
            <Label htmlFor="prev-season-date" className="text-xs font-black uppercase tracking-widest text-muted-foreground">Game played date</Label>
            <Input id="prev-season-date" type="date" max={yesterday} value={state.playedDate} onChange={(e) => state.setPlayedDate(e.target.value)} className="mt-2 font-bold" data-testid="input-previous-played-date" />
          </div>
          <div className="sm:col-span-2 flex items-start gap-3">
            <Checkbox id="prev-attest" checked={state.attested} onCheckedChange={(v) => state.setAttested(v === true)} data-testid="checkbox-previous-attest" />
            <Label htmlFor="prev-attest" className="text-sm font-medium leading-snug">
              I confirm this is my original recap of a previous-season game actually played on the date above.
            </Label>
          </div>
          {state.problem && (
            <p className="sm:col-span-2 text-xs font-semibold text-amber-700" data-testid="text-previous-season-problem">
              Needed before publishing: {state.problem} You can still save a draft.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
