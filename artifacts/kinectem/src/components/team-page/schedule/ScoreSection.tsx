import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Trophy } from "lucide-react";
import {
  setEventScore,
  scheduleQueryKey,
  scoreResult,
  isPast,
  type ScheduleEvent,
} from "./scheduleApi";

const OUTCOME_CLASS: Record<"W" | "L" | "T", string> = {
  W: "bg-emerald-100 text-emerald-800",
  L: "bg-red-100 text-red-800",
  T: "bg-slate-100 text-slate-700",
};

// Final-score display + (coach/admin) capture for game-type events. Recording a
// score on a finished game flips it to "completed" server-side so it appears in
// Season Results.
export function ScoreSection({
  teamId,
  event,
}: {
  teamId: string;
  event: ScheduleEvent;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [us, setUs] = useState("");
  const [them, setThem] = useState("");

  const isGameType =
    event.eventType === "game" ||
    event.eventType === "scrimmage" ||
    event.eventType === "tournament";

  useEffect(() => {
    setEditing(false);
    setUs(event.scoreTeam != null ? String(event.scoreTeam) : "");
    setThem(event.scoreOpponent != null ? String(event.scoreOpponent) : "");
  }, [event.id, event.scoreTeam, event.scoreOpponent]);

  const save = useMutation({
    mutationFn: (input: { scoreTeam: number | null; scoreOpponent: number | null }) =>
      setEventScore(teamId, event.id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: scheduleQueryKey(teamId) });
      setEditing(false);
      toast({ title: "Score saved" });
    },
    onError: (err) =>
      toast({
        title: "Couldn't save the score",
        description: err instanceof Error ? err.message : "Something went wrong.",
        variant: "destructive",
      }),
  });

  if (!isGameType) return null;

  // Mirror the server: only games that have started (completed, or scheduled but
  // past) are scoreable. Hide the whole section for future games with no score.
  const eligible =
    event.status === "completed" ||
    (event.status === "scheduled" && isPast(event));
  const result = scoreResult(event);
  if (!eligible && !result) return null;
  const onSave = () => {
    const t = parseInt(us, 10);
    const o = parseInt(them, 10);
    if (!Number.isInteger(t) || !Number.isInteger(o) || t < 0 || o < 0) {
      toast({
        title: "Enter both scores",
        description: "Both scores must be whole numbers (0 or more).",
        variant: "destructive",
      });
      return;
    }
    save.mutate({ scoreTeam: t, scoreOpponent: o });
  };

  return (
    <div className="rounded-lg border border-border p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-muted-foreground">
          <Trophy className="h-3.5 w-3.5" />
          Final score
        </span>
        {result ? (
          <span
            className={`rounded-full px-2 py-0.5 text-sm font-black ${OUTCOME_CLASS[result.outcome]}`}
            data-testid="text-event-score"
          >
            {result.outcome} {result.text}
          </span>
        ) : (
          <span className="text-sm text-muted-foreground">Not recorded</span>
        )}
      </div>

      {event.canManage && eligible && !editing && (
        <Button
          variant="outline"
          size="sm"
          className="font-bold rounded-full"
          onClick={() => setEditing(true)}
          data-testid="btn-edit-score"
        >
          {result ? "Edit score" : "Record score"}
        </Button>
      )}

      {event.canManage && eligible && editing && (
        <div className="space-y-2">
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Label htmlFor="scoreUs" className="text-xs font-bold">
                Us
              </Label>
              <Input
                id="scoreUs"
                type="number"
                min={0}
                inputMode="numeric"
                value={us}
                onChange={(e) => setUs(e.target.value)}
                data-testid="input-score-us"
              />
            </div>
            <span className="pb-2 font-black text-muted-foreground">–</span>
            <div className="flex-1">
              <Label htmlFor="scoreThem" className="text-xs font-bold">
                {event.opponent || "Them"}
              </Label>
              <Input
                id="scoreThem"
                type="number"
                min={0}
                inputMode="numeric"
                value={them}
                onChange={(e) => setThem(e.target.value)}
                data-testid="input-score-them"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            {result && (
              <Button
                variant="ghost"
                size="sm"
                className="font-bold rounded-full text-muted-foreground"
                onClick={() =>
                  save.mutate({ scoreTeam: null, scoreOpponent: null })
                }
                disabled={save.isPending}
                data-testid="btn-clear-score"
              >
                Clear
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              className="font-bold rounded-full"
              onClick={() => setEditing(false)}
              disabled={save.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="brand"
              size="sm"
              onClick={onSave}
              disabled={save.isPending}
              data-testid="btn-save-score"
            >
              Save
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
