import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiErrorMessage } from "@/lib/api-errors";

export type AssignmentSnapshot = { participantId: string; name: string; claimedAt: string | null };
export type ScheduleRemovalTarget = {
  competitionId: string;
  competitionSlug: string;
  competitionName: string;
  teamName: string;
  assignments: AssignmentSnapshot[];
  match?: { id: string; label: string };
};

export function CompetitionScheduleRemovalDialog({ teamId, target, onClose }: {
  teamId: string; target: ScheduleRemovalTarget; onClose: () => void;
}) {
  const [step, setStep] = useState(1);
  const [word, setWord] = useState("");
  const [error, setError] = useState("");
  const qc = useQueryClient();
  const { toast } = useToast();
  const remove = useMutation({
    mutationFn: () => customFetch(`/api/v1/teams/${teamId}/competitions/${target.competitionId}/remove`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reviewed: true, confirmation: word, assignments: target.assignments.map(({ participantId, claimedAt }) => ({ participantId, claimedAt })),
        ...(target.match ? { matchId: target.match.id } : {}),
      }),
    }),
    onSuccess: async () => {
      toast({
        title: target.match ? "Game removed from team page" : "Competition schedule released",
        description: target.match
          ? "Other games remain linked. The original competition schedule is unchanged."
          : "The original competition team is Unclaimed again. Its games remain on the competition page.",
      });
      onClose();
      // Refresh schedule, claim choices, photo attribution and authoring rights
      // together, without cancelling/refetching the same query multiple times.
      await qc.invalidateQueries({ predicate: (q) =>
        q.queryKey.includes(teamId) || q.queryKey.includes(target.competitionId) || q.queryKey.includes(target.competitionSlug) ||
        q.queryKey.some((key) => typeof key === "string" &&
          (key.includes(`/teams/${teamId}`) || key.includes(`/competitions/${target.competitionId}`) ||
            key.includes(`/competitions/${target.competitionSlug}`) || key.includes("/users/me") || key.includes("claimable"))),
      });
    },
    onError: (err) => {
      setError(apiErrorMessage(err) ?? (err instanceof Error ? err.message : "Nothing was removed. Please try again."));
      void qc.invalidateQueries({ queryKey: ["team", teamId, "tournament-schedule"] });
    },
  });

  return (
    <AlertDialog open onOpenChange={(open) => { if (!open && !remove.isPending) onClose(); }}>
      <AlertDialogContent data-testid="dialog-remove-competition-schedule" onEscapeKeyDown={(e) => { if (remove.isPending) e.preventDefault(); }}>
        <AlertDialogHeader>
          <AlertDialogTitle>{step === 2 ? "Final confirmation" : target.match ? "Remove this game from your team page?" : "Remove this competition from your team page?"}</AlertDialogTitle>
          <AlertDialogDescription>
            {target.match
              ? "Only this game will be removed from your team page. Other games stay linked, and the competition team remains claimed."
              : "All games from this competition will leave your team page. The original competition team will become Unclaimed and can be claimed again."}
            {" "}The original competition games, opponents’ schedules, existing recaps, photos, and team ownership are not deleted.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-1 rounded-lg border bg-muted/30 p-3 text-sm [overflow-wrap:anywhere]">
          <p><strong>Team page:</strong> {target.teamName}</p>
          <p><strong>Competition:</strong> {target.competitionName}</p>
          <p><strong>Original competition team:</strong> {target.assignments.map((p) => p.name).join(", ")}</p>
          {target.match && <p><strong>Game:</strong> {target.match.label}</p>}
        </div>
        {step === 2 && (
          <div className="space-y-2">
            <label htmlFor="confirm-schedule-removal" className="text-sm font-bold">Type REMOVE to confirm</label>
            <Input id="confirm-schedule-removal" value={word} onChange={(e) => setWord(e.target.value)}
              autoComplete="off" disabled={remove.isPending} data-testid="input-confirm-schedule-removal" />
          </div>
        )}
        {error && <p role="alert" className="text-sm text-destructive" data-testid="error-schedule-removal">{error}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={remove.isPending}>Cancel</AlertDialogCancel>
          {step === 1 ? (
            <Button onClick={() => setStep(2)} data-testid="button-review-schedule-removal">Continue to final confirmation</Button>
          ) : (
            <>
              <Button variant="outline" disabled={remove.isPending} onClick={() => { setStep(1); setWord(""); setError(""); }}>Back</Button>
              <Button variant="destructive" disabled={word !== "REMOVE" || remove.isPending} onClick={() => { setError(""); remove.mutate(); }}
                data-testid="button-confirm-schedule-removal">
                {remove.isPending ? "Removing…" : target.match ? "Remove game" : "Remove competition"}
              </Button>
            </>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
