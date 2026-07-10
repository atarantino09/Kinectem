import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Trophy } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { namesRoughlyMatch } from "@/lib/name-match";

// Team-side entry point for claiming a competition slot TO this existing
// team (no new team created). The coach pastes the competition link (or
// slug) the organizer shared, picks their team's slot from the schedule,
// confirms, and the competition's games appear on the team page.

type Participant = {
  id: string;
  name: string;
  division: string;
  bracket: string;
  claimed: boolean;
};

type CompetitionResponse = {
  tournament: { id: string; slug: string; name: string };
  participants: Participant[];
};

// Accepts a full URL ("https://…/c/<slug>" or "…/competitions/c/<slug>"),
// a path, or a bare slug.
function parseSlug(input: string): string {
  const v = input.trim();
  if (!v) return "";
  const m = v.match(/\/c\/([^/?#\s]+)/);
  if (m) return m[1];
  return v.replace(/^\/+|\/+$/g, "");
}

function groupLabel(division: string, bracket: string): string {
  const parts = [division, bracket].filter((p) => p && p.trim() !== "");
  return parts.length ? parts.join(" · ") : "General";
}

export function ClaimCompetitionDialog({
  open,
  onOpenChange,
  teamId,
  teamName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  teamId: string;
  teamName: string;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [linkInput, setLinkInput] = useState("");
  const [loadedSlug, setLoadedSlug] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // Coach-confirmed name-mismatch gate (no fuzzy matching in v1).
  const [mismatchConfirmed, setMismatchConfirmed] = useState(false);

  const q = useQuery<CompetitionResponse>({
    queryKey: ["claim-competition", loadedSlug],
    queryFn: () =>
      customFetch<CompetitionResponse>(
        `/api/v1/competitions/${encodeURIComponent(loadedSlug)}`,
      ),
    enabled: open && !!loadedSlug,
    retry: false,
  });

  const unclaimed = useMemo(
    () => (q.data?.participants ?? []).filter((p) => !p.claimed),
    [q.data],
  );
  const selectedSlot = unclaimed.find((p) => p.id === selectedId) ?? null;
  const nameMismatch =
    !!selectedSlot && !namesRoughlyMatch(selectedSlot.name, teamName);

  function pickSlot(id: string) {
    setSelectedId(id);
    setMismatchConfirmed(false);
  }

  function load() {
    const slug = parseSlug(linkInput);
    if (!slug) {
      toast({ title: "Paste the competition link first.", variant: "destructive" });
      return;
    }
    setSelectedId("");
    setLoadedSlug(slug);
  }

  async function claim() {
    if (!selectedSlot || !loadedSlug) return;
    if (nameMismatch && !mismatchConfirmed) {
      toast({
        title: "The names don't match — confirm this is your team's slot first.",
        variant: "destructive",
      });
      return;
    }
    setSubmitting(true);
    try {
      const res = await customFetch<{ ok: boolean; pendingApproval?: boolean }>(
        `/api/v1/competitions/${encodeURIComponent(loadedSlug)}/claim`,
        {
          method: "POST",
          body: JSON.stringify({
            participantId: selectedSlot.id,
            existingTeamId: teamId,
          }),
        },
      );
      toast({
        title: res.pendingApproval
          ? "Claim submitted — the organizer will review it shortly."
          : "Slot claimed! The competition's games now show on your team page.",
      });
      void queryClient.invalidateQueries({
        queryKey: ["team", teamId, "tournament-schedule"],
      });
      onOpenChange(false);
      setLinkInput("");
      setLoadedSlug("");
      setSelectedId("");
    } catch (err) {
      toast({
        title: (err as Error)?.message ?? "Couldn't claim that slot",
        variant: "destructive",
      });
      void q.refetch();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" data-testid="dialog-claim-competition">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trophy className="w-5 h-5" /> Claim league / tournament games
          </DialogTitle>
          <DialogDescription>
            Paste the competition link the organizer shared, then pick your
            team's name in its schedule. Its games will show on this team's
            page.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="comp-link">Competition link</Label>
            <div className="flex gap-2">
              <Input
                id="comp-link"
                value={linkInput}
                onChange={(e) => setLinkInput(e.target.value)}
                placeholder="https://kinectem.com/c/…"
                className="[overflow-wrap:anywhere]"
                data-testid="input-competition-link"
                onKeyDown={(e) => {
                  if (e.key === "Enter") load();
                }}
              />
              <Button
                variant="outline"
                className="font-bold shrink-0"
                onClick={load}
                data-testid="btn-load-competition"
              >
                Find
              </Button>
            </div>
          </div>

          {loadedSlug && q.isLoading && (
            <p className="text-sm text-muted-foreground">Looking it up…</p>
          )}
          {loadedSlug && q.isError && (
            <p className="text-sm text-destructive">
              Couldn't find that competition — double-check the link.
            </p>
          )}

          {q.data && (
            <div className="space-y-2">
              <Label>
                Your team's slot in {q.data.tournament.name}
              </Label>
              {unclaimed.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Every team slot in this competition has already been claimed.
                </p>
              ) : (
                <div className="grid gap-2 max-h-64 overflow-y-auto pr-1">
                  {unclaimed.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => pickSlot(p.id)}
                      className={`text-left rounded-lg border px-3 py-2 transition-colors ${
                        selectedId === p.id
                          ? "border-primary ring-2 ring-primary/30"
                          : "border-border hover:border-primary/50"
                      }`}
                      data-testid={`btn-claim-slot-${p.id}`}
                    >
                      <p className="text-sm font-bold truncate">{p.name}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {groupLabel(p.division, p.bracket)}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {selectedSlot && (
            <div
              className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground space-y-2"
              data-testid="text-claim-confirm"
            >
              <p>
                You're claiming{" "}
                <span className="font-bold">{selectedSlot.name}</span> as{" "}
                <span className="font-bold">{teamName}</span> — that means
                claiming their schedule: these competition games are added to
                your team's schedule.
              </p>
              <p>
                Your current team page <span className="font-bold">won&apos;t
                change</span> — you're just getting these specific games added
                in competition form. Game recaps you write for them may be
                shared and featured on the competition page.
              </p>
              {nameMismatch && (
                <label
                  className="flex items-start gap-2 text-foreground cursor-pointer"
                  data-testid="label-mismatch-confirm"
                >
                  <Checkbox
                    checked={mismatchConfirmed}
                    onCheckedChange={(v) => setMismatchConfirmed(v === true)}
                    data-testid="checkbox-mismatch-confirm"
                  />
                  <span>
                    These names don't match — I confirm{" "}
                    <span className="font-bold">{selectedSlot.name}</span> in
                    this competition is my team{" "}
                    <span className="font-bold">{teamName}</span>.
                  </span>
                </label>
              )}
            </div>
          )}

          <Button
            className="font-bold w-full"
            disabled={
              submitting || !selectedSlot || (nameMismatch && !mismatchConfirmed)
            }
            onClick={claim}
            data-testid="btn-confirm-claim"
          >
            {submitting ? "Claiming…" : "Confirm claim"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
