import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  fetchEventRsvps,
  rsvpQueryKey,
  setRsvp,
  RSVP_STATUS_LABEL,
  type RsvpStatus,
} from "./scheduleApi";

const STATUS_ORDER: RsvpStatus[] = ["going", "maybe", "out"];

// Filled accent per status when selected (matches the in-app type chips).
const STATUS_SELECTED: Record<RsvpStatus, string> = {
  going: "bg-emerald-600 text-white hover:bg-emerald-600 border-emerald-600",
  maybe: "bg-amber-500 text-white hover:bg-amber-500 border-amber-500",
  out: "bg-rose-600 text-white hover:bg-rose-600 border-rose-600",
};

const STATUS_BADGE: Record<RsvpStatus | "no_response", string> = {
  going: "bg-emerald-100 text-emerald-800 border-emerald-200",
  maybe: "bg-amber-100 text-amber-900 border-amber-200",
  out: "bg-rose-100 text-rose-800 border-rose-200",
  no_response: "bg-slate-100 text-slate-600 border-slate-200",
};

const STATUS_BADGE_LABEL: Record<RsvpStatus | "no_response", string> = {
  going: "Going",
  maybe: "Maybe",
  out: "Out",
  no_response: "No response",
};

interface RsvpSectionProps {
  teamId: string;
  eventId: string;
}

// Availability for an event. Athletes (and parents on behalf of a linked
// child) pick Going / Maybe / Out; coaches and org admins additionally see a
// tally and an expandable roster of who responded what. The server decides
// which athletes the viewer may answer for, so this component renders whatever
// it returns without any roster knowledge of its own.
export function RsvpSection({ teamId, eventId }: RsvpSectionProps) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [showList, setShowList] = useState(false);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const { data, isLoading } = useQuery({
    queryKey: rsvpQueryKey(teamId, eventId),
    queryFn: () => fetchEventRsvps(teamId, eventId),
  });

  // Seed each athlete's note draft once, without clobbering in-progress edits.
  useEffect(() => {
    if (!data) return;
    setNotes((prev) => {
      const next = { ...prev };
      for (const a of data.myAthletes) {
        if (!(a.athleteId in next)) next[a.athleteId] = a.note ?? "";
      }
      return next;
    });
  }, [data]);

  const mutation = useMutation({
    mutationFn: (vars: { athleteId: string; status: RsvpStatus; note: string }) =>
      setRsvp(teamId, eventId, {
        athleteId: vars.athleteId,
        status: vars.status,
        note: vars.note.trim() || null,
      }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: rsvpQueryKey(teamId, eventId) }),
    onError: (err) =>
      toast({
        title: "Couldn't save your RSVP",
        description:
          err instanceof Error ? err.message : "Something went wrong.",
        variant: "destructive",
      }),
  });

  const pendingAthleteId = mutation.isPending
    ? mutation.variables?.athleteId
    : undefined;

  if (isLoading || !data) {
    return (
      <div className="rounded-xl border border-border p-3 text-sm text-muted-foreground">
        Loading availability…
      </div>
    );
  }

  const { myAthletes, canViewAll, summary, responses } = data;
  if (myAthletes.length === 0 && !canViewAll) return null;

  const showAthleteNames = myAthletes.length > 1;

  return (
    <div className="space-y-3 rounded-xl border border-border p-3">
      {myAthletes.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs font-black uppercase tracking-widest text-muted-foreground">
            {showAthleteNames ? "Availability" : "Your availability"}
          </p>
          {myAthletes.map((a) => (
            <div key={a.athleteId} className="space-y-2">
              {showAthleteNames && (
                <p className="text-sm font-bold">{a.athleteName}</p>
              )}
              <div className="flex gap-2">
                {STATUS_ORDER.map((s) => {
                  const selected = a.status === s;
                  return (
                    <Button
                      key={s}
                      type="button"
                      size="sm"
                      variant="outline"
                      className={cn(
                        "flex-1 font-bold rounded-full",
                        selected && STATUS_SELECTED[s],
                      )}
                      disabled={pendingAthleteId === a.athleteId}
                      onClick={() =>
                        mutation.mutate({
                          athleteId: a.athleteId,
                          status: s,
                          note: notes[a.athleteId] ?? "",
                        })
                      }
                      data-testid={`btn-rsvp-${s}-${a.athleteId}`}
                    >
                      {RSVP_STATUS_LABEL[s]}
                    </Button>
                  );
                })}
              </div>
              <Input
                value={notes[a.athleteId] ?? ""}
                onChange={(e) =>
                  setNotes((prev) => ({ ...prev, [a.athleteId]: e.target.value }))
                }
                onBlur={() => {
                  const draft = (notes[a.athleteId] ?? "").trim();
                  // Only persist a note edit once a status has been chosen and
                  // the text actually changed.
                  if (a.status && draft !== (a.note ?? "")) {
                    mutation.mutate({
                      athleteId: a.athleteId,
                      status: a.status,
                      note: notes[a.athleteId] ?? "",
                    });
                  }
                }}
                placeholder="Add a note (optional)"
                maxLength={300}
                className="text-sm"
                data-testid={`input-rsvp-note-${a.athleteId}`}
              />
            </div>
          ))}
        </div>
      )}

      {canViewAll && summary && responses && (
        <div className={cn("space-y-2", myAthletes.length > 0 && "border-t border-border pt-3")}>
          <button
            type="button"
            className="flex w-full items-center justify-between gap-2 text-left"
            onClick={() => setShowList((v) => !v)}
            data-testid="btn-toggle-rsvp-list"
          >
            <span className="flex items-center gap-2 text-sm font-bold">
              <Users className="h-4 w-4 text-muted-foreground" />
              {summary.going} going · {summary.maybe} maybe · {summary.out} out
              {summary.noResponse > 0 && (
                <span className="text-muted-foreground">
                  {" "}
                  · {summary.noResponse} no response
                </span>
              )}
            </span>
            {showList ? (
              <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
            )}
          </button>

          {showList && (
            <ul className="space-y-1.5">
              {responses.map((r) => (
                <li
                  key={r.athleteId}
                  className="flex items-start justify-between gap-2 text-sm"
                  data-testid={`rsvp-row-${r.athleteId}`}
                >
                  <div className="min-w-0">
                    <span className="font-semibold">{r.athleteName}</span>
                    {r.respondedByName && (
                      <span className="text-xs text-muted-foreground">
                        {" "}
                        · via {r.respondedByName}
                      </span>
                    )}
                    {r.note && (
                      <span className="block text-xs text-muted-foreground">
                        {r.note}
                      </span>
                    )}
                  </div>
                  <Badge
                    variant="outline"
                    className={cn("font-bold shrink-0", STATUS_BADGE[r.status])}
                  >
                    {STATUS_BADGE_LABEL[r.status]}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
