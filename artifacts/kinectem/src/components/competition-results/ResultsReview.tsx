import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import {
  allScoresPresent,
  api,
  isoToLocalInput,
  localInputToIso,
  unresolvedMappings,
  useInvalidateResults,
  type ResultGroup,
  type Snapshot,
  type Workspace,
} from "@/lib/competition-results";
import { Candidates, PickParticipant, UNSET, EXTERNAL, errMsg, statusTone } from "./ResultsUiHelpers";

export function ResultsReview({
  cid,
  snap,
  ws,
  onConfirmed,
}: {
  cid: string;
  snap: Snapshot;
  ws: Workspace;
  onConfirmed: (s: Snapshot) => void;
}) {
  const [groups, setGroups] = useState<ResultGroup[]>(snap.groups);
  const [decided, setDecided] = useState<Set<string>>(new Set());
  const [asOf, setAsOf] = useState(isoToLocalInput(snap.resultsAsOf));
  const [newLabel, setNewLabel] = useState("");
  const invalidate = useInvalidateResults(cid);
  const { toast } = useToast();

  // Re-seed only when switching snapshot (or server-confirmed content lands).
  useEffect(() => {
    setGroups(snap.groups);
    setAsOf(isoToLocalInput(snap.resultsAsOf));
    // A server-confirmed snapshot already carries explicit operator choices.
    setDecided(
      snap.confirmed
        ? new Set(unresolvedMappings(snap.groups, new Set()))
        : new Set(),
    );
  }, [snap.id, snap.confirmed]); // eslint-disable-line react-hooks/exhaustive-deps

  const decide = (k: string) => setDecided((d) => new Set(d).add(k));
  const patchGroup = (key: string, fn: (g: ResultGroup) => ResultGroup) =>
    setGroups((gs) =>
      gs.map((g) => {
        if (g.key !== key) return g;
        const next = fn(g);
        // A group can only stay complete while every score is present.
        return next.complete && !allScoresPresent(next) ? { ...next, complete: false } : next;
      }),
    );
  const missing = unresolvedMappings(groups, decided);
  const readOnly = snap.confirmed;
  const blocked = snap.status === "blocked" || snap.status === "unsupported";

  const confirm = useMutation({
    mutationFn: () => api.confirmImport(cid, snap.id, { groups, resultsAsOf: localInputToIso(asOf) ?? "", confirmed: true }),
    onSuccess: (s) => {
      invalidate();
      onConfirmed(s);
      toast({ title: "Mappings confirmed" });
    },
    onError: (e) => toast({ title: "Couldn't confirm", description: errMsg(e), variant: "destructive" }),
  });
  const addBracket = useMutation({
    mutationFn: () => api.createBracket(cid, newLabel.trim()),
    onSuccess: () => {
      setNewLabel("");
      invalidate();
    },
    onError: (e) => toast({ title: "Couldn't create bracket", description: errMsg(e), variant: "destructive" }),
  });

  return (
    <Card data-testid="card-results-review">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          2. Review and map
          <Badge className={statusTone[snap.status]} data-testid="badge-snapshot-status">
            {snap.status}
          </Badge>
          {snap.confirmed ? <Badge variant="outline">confirmed</Badge> : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground" data-testid="text-provenance">
          Source: {snap.kind}
          {snap.sourceUrl ? ` · ${snap.sourceUrl}` : ""} · imported{" "}
          {new Date(snap.importedAt).toLocaleString()}
        </p>
        {snap.message ? (
          <p
            className={`rounded-lg border p-3 text-sm ${blocked ? "border-red-300 bg-red-50" : "border-amber-300 bg-amber-50"}`}
            data-testid="text-snapshot-message"
          >
            {snap.message}
          </p>
        ) : null}
        {readOnly ? (
          <p className="rounded-lg border border-border bg-muted/40 p-3 text-sm" data-testid="text-readonly-note">
            This import is confirmed and locked, so the review is read-only. To change results or mappings, run a new
            import.
          </p>
        ) : null}
        {groups.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="text-no-groups">
            No brackets were detected in this import.
          </p>
        ) : null}

        <fieldset disabled={readOnly} className="space-y-4 min-w-0 border-0 p-0" data-testid="fieldset-review">
        {!readOnly ? <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label htmlFor="new-bracket" className="text-xs font-bold">
              Need a bracket that doesn't exist yet?
            </Label>
            <Input
              id="new-bracket"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="Boys U12 Gold"
              data-testid="input-new-bracket"
            />
          </div>
          <Button
            variant="outline"
            disabled={!newLabel.trim() || addBracket.isPending}
            onClick={() => addBracket.mutate()}
            data-testid="btn-create-bracket"
          >
            Create bracket
          </Button>
        </div> : null}

        {groups.map((g) => (
          <details
            key={g.key}
            className="rounded-xl border border-border p-3"
            open={groups.length <= 2}
            data-testid={`group-${g.key}`}
          >
            <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm font-bold">
              <span>{g.label}</span>
              <span className="text-xs font-normal text-muted-foreground">
                detected: {g.gender || "gender ?"} · {g.age || "age ?"} · {g.games.length} games
              </span>
              {!g.complete ? (
                <Badge className="bg-amber-100 text-amber-900" data-testid={`badge-incomplete-${g.key}`}>
                  incomplete
                </Badge>
              ) : null}
            </summary>
            <div className="mt-3 space-y-3">
              <div className="grid gap-2 sm:grid-cols-[1fr_1fr]">
                <div className="space-y-1">
                  <Label className="text-xs font-bold">Kinectem bracket</Label>
                  <select
                    aria-label={`Bracket for ${g.label}`}
                    value={!decided.has(`g:${g.key}`) ? UNSET : g.bracketId ?? EXTERNAL}
                    onChange={(e) => {
                      const v = e.target.value;
                      patchGroup(g.key, (x) => ({ ...x, bracketId: v === EXTERNAL ? null : v }));
                      decide(`g:${g.key}`);
                    }}
                    className={`h-9 w-full rounded-md border bg-background px-2 text-sm ${decided.has(`g:${g.key}`) ? "border-border" : "border-amber-500"}`}
                    data-testid={`select-bracket-${g.key}`}
                  >
                    <option value={UNSET} disabled>
                      Choose bracket…
                    </option>
                    <option value={EXTERNAL}>Leave external (no bracket, no recap)</option>
                    {ws.brackets.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs font-bold">Gender</Label>
                    <Input
                      value={g.gender}
                      onChange={(e) => patchGroup(g.key, (x) => ({ ...x, gender: e.target.value }))}
                      data-testid={`input-gender-${g.key}`}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs font-bold">Age</Label>
                    <Input
                      value={g.age}
                      onChange={(e) => patchGroup(g.key, (x) => ({ ...x, age: e.target.value }))}
                      data-testid={`input-age-${g.key}`}
                    />
                  </div>
                </div>
              </div>

              <label className="flex items-center gap-2 text-xs font-bold">
                <input
                  type="checkbox"
                  checked={g.complete}
                  disabled={!allScoresPresent(g)}
                  onChange={(e) => patchGroup(g.key, (x) => ({ ...x, complete: e.target.checked }))}
                  data-testid={`check-complete-${g.key}`}
                />
                Mark this bracket complete
                {!allScoresPresent(g) ? (
                  <span className="font-normal text-muted-foreground">(every game needs both scores first)</span>
                ) : null}
              </label>

              {g.games.map((x) => (
                <div key={x.id} className="space-y-1.5 rounded-lg bg-muted/40 p-2" data-testid={`game-${x.id}`}>
                  <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                    <Input
                      aria-label="Home name"
                      value={x.home}
                      onChange={(e) =>
                        patchGroup(g.key, (gg) => ({
                          ...gg,
                          games: gg.games.map((q) => (q.id === x.id ? { ...q, home: e.target.value } : q)),
                        }))
                      }
                      className="h-8 text-xs"
                    />
                    <div className="flex items-center gap-1">
                      {(["homeScore", "awayScore"] as const).map((f) => (
                        <Input
                          key={f}
                          aria-label={f === "homeScore" ? "Home score" : "Away score"}
                          inputMode="numeric"
                          value={x[f] ?? ""}
                          onChange={(e) => {
                            const raw = e.target.value.trim();
                            const n = raw === "" ? null : Number(raw);
                            if (n !== null && !Number.isFinite(n)) return;
                            patchGroup(g.key, (gg) => ({
                              ...gg,
                              games: gg.games.map((q) => (q.id === x.id ? { ...q, [f]: n } : q)),
                            }));
                          }}
                          className="h-8 w-12 px-1 text-center text-xs"
                          data-testid={`input-${f}-${x.id}`}
                        />
                      ))}
                    </div>
                    <Input
                      aria-label="Away name"
                      value={x.away}
                      onChange={(e) =>
                        patchGroup(g.key, (gg) => ({
                          ...gg,
                          games: gg.games.map((q) => (q.id === x.id ? { ...q, away: e.target.value } : q)),
                        }))
                      }
                      className="h-8 text-xs"
                    />
                  </div>
                  <Input
                    aria-label="Game group"
                    placeholder="Group"
                    value={x.group}
                    onChange={(e) =>
                      patchGroup(g.key, (gg) => ({
                        ...gg,
                        games: gg.games.map((q) => (q.id === x.id ? { ...q, group: e.target.value } : q)),
                      }))
                    }
                    className="h-7 text-xs"
                    data-testid={`input-game-group-${x.id}`}
                  />
                  <Input
                    aria-label="Game date"
                    value={x.date}
                    onChange={(e) =>
                      patchGroup(g.key, (gg) => ({
                        ...gg,
                        games: gg.games.map((q) => (q.id === x.id ? { ...q, date: e.target.value } : q)),
                      }))
                    }
                    className="h-7 text-xs"
                  />
                  <div className="grid gap-2 sm:grid-cols-2">
                    {(["home", "away"] as const).map((side) => {
                      const k = `m:${g.key}:${x.id}:${side}`;
                      const field = side === "home" ? "homeParticipantId" : "awayParticipantId";
                      return (
                        <PickParticipant
                          key={side}
                          label={`${side} team mapping`}
                          testId={`map-${side}-${x.id}`}
                          value={x[field]}
                          decided={decided.has(k)}
                          participants={ws.participants}
                          onPick={(id) => {
                            patchGroup(g.key, (gg) => ({
                              ...gg,
                              games: gg.games.map((q) => (q.id === x.id ? { ...q, [field]: id } : q)),
                            }));
                            decide(k);
                          }}
                          candidates={
                            <Candidates
                              name={side === "home" ? x.home : x.away}
                              participants={ws.participants}
                              testId={`cands-${side}-${x.id}`}
                            />
                          }
                        />
                      );
                    })}
                  </div>
                </div>
              ))}

              {g.standings.length > 0 ? (
                <div className="space-y-1.5">
                  <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Standings</p>
                  {g.standings.map((s, i) => {
                    const k = `s:${g.key}:${i}`;
                    return (
                      <div key={i} className="grid grid-cols-[1fr_3rem_3rem] gap-2 sm:grid-cols-[1fr_3rem_3rem_1fr]">
                        <Input
                          aria-label={`Standing team ${i + 1}`}
                          value={s.team}
                          onChange={(e) =>
                            patchGroup(g.key, (gg) => ({
                              ...gg,
                              standings: gg.standings.map((q, j) => (j === i ? { ...q, team: e.target.value } : q)),
                            }))
                          }
                          className="h-8 text-xs"
                          data-testid={`input-standing-team-${g.key}-${i}`}
                        />
                        {(["position", "points"] as const).map((f) => (
                          <Input
                            key={f}
                            aria-label={`${f} for ${s.team}`}
                            inputMode="numeric"
                            value={s[f] ?? ""}
                            onChange={(e) => {
                              const raw = e.target.value.trim();
                              const n = raw === "" ? null : Number(raw);
                              if (n !== null && !Number.isFinite(n)) return;
                              patchGroup(g.key, (gg) => ({
                                ...gg,
                                standings: gg.standings.map((q, j) => (j === i ? { ...q, [f]: n } : q)),
                              }));
                            }}
                            className="h-8 px-1 text-center text-xs"
                          />
                        ))}
                        <div className="col-span-3 sm:col-span-1">
                          <PickParticipant
                            label={`standing mapping ${s.team}`}
                            testId={`map-standing-${g.key}-${i}`}
                            value={s.participantId}
                            decided={decided.has(k)}
                            participants={ws.participants}
                            onPick={(id) => {
                              patchGroup(g.key, (gg) => ({
                                ...gg,
                                standings: gg.standings.map((q, j) => (j === i ? { ...q, participantId: id } : q)),
                              }));
                              decide(k);
                            }}
                            candidates={<Candidates name={s.team} participants={ws.participants} testId={`cands-standing-${g.key}-${i}`} />}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </div>
          </details>
        ))}

        </fieldset>

        {!readOnly ? <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="as-of" className="text-xs font-bold">
              Results as of
            </Label>
            <Input
              id="as-of"
              type="datetime-local"
              value={asOf}
              onChange={(e) => setAsOf(e.target.value)}
              data-testid="input-results-as-of"
            />
          </div>
          <Button
            variant="brand"
            disabled={blocked || groups.length === 0 || missing.length > 0 || !asOf || confirm.isPending}
            onClick={() => confirm.mutate()}
            data-testid="btn-confirm-mappings"
          >
            {confirm.isPending ? "Saving…" : "Confirm mappings"}
          </Button>
          {missing.length > 0 && !blocked ? (
            <span className="text-xs text-amber-800" data-testid="text-unresolved-count">
              {missing.length} mapping{missing.length === 1 ? "" : "s"} still need a choice. Nothing is matched
              automatically.
            </span>
          ) : null}
        </div> : (
          <p className="text-xs text-muted-foreground" data-testid="text-as-of-readonly">
            Results as of {asOf ? new Date(localInputToIso(asOf) ?? "").toLocaleString() : "unknown"}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
