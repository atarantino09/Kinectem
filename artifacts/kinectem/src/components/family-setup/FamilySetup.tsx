import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { UserAvatar } from "@/components/UserAvatar";
import { AlertTriangle, CheckCircle2, Clock, Loader2, Mail, Users } from "lucide-react";
import {
  clearDraft, emptyDraft, errorCode, errorStatus, isEmail, loadDraft,
  planRequest, saveDraft, deliveryLabel, type FamilyDraft, type Relationship,
} from "@/lib/family-setup";

interface ChildRow { id: string; firstName: string; lastName: string; avatarUrl: string | null }
interface GuardianRow { id: string; status: string; guardian?: { id: string; displayName?: string } }

export interface FamilySetupProps {
  userId: string;
  /** "team" posts to the invite token; "family" to the ordinary setup route. */
  mode: "team" | "family";
  token?: string;
  teamName?: string;
  childHint?: string;
  onDone: () => void;
  onSkipLater?: () => void;
}

const STEPS = [
  { id: "account", full: "Your parent account", short: "Account" },
  { id: "coparent", full: "Other parent", short: "Other parent" },
  { id: "player", full: "Player profile", short: "Player" },
];

function Steps({ current }: { current: number }) {
  return (
    <ol className="flex items-center gap-1 text-[11px] sm:text-xs" data-testid="family-setup-steps" aria-label="Setup progress">
      {STEPS.map((s, i) => (
        <li key={s.id} className="flex min-w-0 items-center gap-1" aria-current={i === current ? "step" : undefined}>
          <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-black ${i < current ? "bg-emerald-600 text-white" : i === current ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
            {i < current ? "\u2713" : i + 1}
          </span>
          <span className={`truncate font-semibold ${i === current ? "text-foreground" : "text-muted-foreground"}`}>
            <span className="sm:hidden">{s.short}</span>
            <span className="hidden sm:inline">{s.full}</span>
          </span>
          {i < STEPS.length - 1 && <span className="mx-1 h-px w-3 bg-border sm:w-6" aria-hidden />}
        </li>
      ))}
    </ol>
  );
}

export function FamilySetup({ userId, mode, token, teamName, childHint, onDone, onSkipLater }: FamilySetupProps) {
  const qc = useQueryClient();
  const scope = mode === "team" ? `team:${token}` : "family";
  const [draft, setDraftState] = useState<FamilyDraft>(() => loadDraft(userId, scope) ?? emptyDraft());
  const draftRef = useRef(draft);
  const update = useCallback((patch: Partial<FamilyDraft>) => {
    const next = { ...draftRef.current, ...patch };
    draftRef.current = next;
    setDraftState(next);
    saveDraft(userId, scope, next);
  }, [userId, scope]);
  useEffect(() => { saveDraft(userId, scope, draftRef.current); }, [userId, scope]);

  const hintParts = (childHint ?? "").trim().split(/\s+/).filter(Boolean);
  const [first, setFirst] = useState(() => draft.requestName?.firstName ?? hintParts[0] ?? "");
  const [last, setLast] = useState(() => draft.requestName?.lastName ?? hintParts.slice(1).join(" "));
  const [askOther, setAskOther] = useState(false);
  const [coFirst, setCoFirst] = useState(draft.coParent?.firstName ?? "");
  const [coLast, setCoLast] = useState(draft.coParent?.lastName ?? "");
  const [coEmail, setCoEmail] = useState(draft.coParent?.email ?? "");
  const [coRel, setCoRel] = useState<Relationship>(draft.coParent?.relationshipType ?? "parent");
  const [coError, setCoError] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [duplicate, setDuplicate] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [notice, setNotice] = useState("");
  const [inviting, setInviting] = useState(false);

  const kids = useQuery<ChildRow[]>({
    queryKey: ["family-setup-children", userId],
    queryFn: async () => {
      const r = await customFetch<{ data: Array<Partial<ChildRow> & { id: string }> }>("/api/v1/users/me/children");
      return (r.data ?? []).map((c) => ({ id: c.id, firstName: c.firstName ?? "", lastName: c.lastName ?? "", avatarUrl: c.avatarUrl ?? null }));
    },
    retry: false,
    staleTime: 0,
  });
  const childId = draft.childId;
  const guardians = useQuery<GuardianRow[]>({
    queryKey: ["family-setup-guardians", childId],
    queryFn: async () => (await customFetch<{ data: GuardianRow[] }>(`/api/v1/users/${childId}/guardians`)).data ?? [],
    enabled: !!childId && !!draft.invitation,
    retry: false,
    refetchInterval: 15000,
  });
  const invitedRow = (guardians.data ?? []).find((g) => g.id === draft.invitation?.id);
  const connected = invitedRow?.status === "active";

  const refreshApp = () => qc.invalidateQueries();
  const stageIndex = draft.stage === "player" ? 2 : 1;

  const inviteEndpoint = (id: string) => `/api/v1/users/${id}/guardians/invite`;
  const sendInvite = async (id: string) => {
    const co = draftRef.current.coParent;
    if (!co) return;
    setInviting(true);
    try {
      const r = await customFetch<{ id: string; emailSent?: boolean | null }>(inviteEndpoint(id), {
        method: "POST",
        body: JSON.stringify(co),
      });
      update({ invitation: { id: r.id, emailSent: r.emailSent ?? null } });
      void guardians.refetch();
    } catch (e) {
      setNotice((e as Error).message || "We could not save the other parent's invitation. You can retry.");
    } finally {
      setInviting(false);
    }
  };

  const finishChild = async (id: string, name: string) => {
    update({ childId: id, childName: name, stage: "done", attempted: false });
    await refreshApp();
    if (draftRef.current.coParent && !draftRef.current.invitation) await sendInvite(id);
  };

  const submitCreate = async (confirmDistinct: boolean) => {
    if (busy) return;
    const f = first.trim(), l = last.trim();
    if (!f || !l) { setError("Enter your player's first and last name."); return; }
    setBusy(true); setError("");
    const requestId = draftRef.current.requestId;
    const recoverCreatedChild = async () => {
      const receipt = await customFetch<{ child: ChildRow }>(
        `/api/v1/family/setup/requests/${requestId}`,
      );
      setNotice(`${receipt.child.firstName} ${receipt.child.lastName} was already created by your earlier attempt, so we selected it.`);
      await selectExisting(receipt.child);
    };
    try {
      let submittedFirst = f, submittedLast = l;
      const plan = planRequest(draftRef.current, f, l);
      if (plan.kind === "changed-after-attempt") {
        // Resolve the committed request, never guess which sibling it was by
        // name. A same-named child can be a genuinely different player.
        try {
          await recoverCreatedChild();
          return;
        } catch (e) {
          if (errorStatus(e) !== 404) {
            setError("We could not check your earlier submission. Retry before creating another player.");
            return;
          }
        }
        // A missing receipt does not mean the first request stopped. Retry its
        // original details, never replace an unresolved creation intent.
        const original = draftRef.current.requestName;
        if (!original) {
          setError("We could not recover your original submission. Retry before creating another player.");
          return;
        }
        submittedFirst = original.firstName;
        submittedLast = original.lastName;
        setFirst(submittedFirst); setLast(submittedLast);
        setNotice("We’re retrying your earlier submission using its original spelling. You can edit the player’s name after setup.");
      } else if (plan.kind === "fresh") {
        update({ requestId: draftRef.current.requestId, requestName: { firstName: f, lastName: l } });
      }
      update({ attempted: true });
      const url = mode === "team" ? `/api/v1/invites/${token}/children` : "/api/v1/family/setup/children";
      const r = await customFetch<{ child: ChildRow }>(url, {
        method: "POST",
        body: JSON.stringify({
          firstName: submittedFirst, lastName: submittedLast, setupRequestId: requestId,
          ...(confirmDistinct ? { confirmDistinctPlayer: true } : {}),
        }),
      });
      setDuplicate(false);
      await finishChild(r.child.id, `${r.child.firstName} ${r.child.lastName}`);
    } catch (e) {
      if (errorStatus(e) === 409 && errorCode(e) === "SETUP_REQUEST_REUSED") {
        // Also recover drafts from older clients that replaced the submitted
        // name. Every conflict checks the receipt again, so it cannot get stuck.
        try {
          await recoverCreatedChild();
        } catch {
          setError("Your earlier player setup is still being checked. Retry to recover it; no second player will be created.");
        }
      } else if (errorStatus(e) === 409 && errorCode(e) === "POSSIBLE_DUPLICATE") {
        update({ attempted: false });
        setDuplicate(true);
      } else {
        if ([400, 403, 404, 410].includes(errorStatus(e) ?? 0)) update({ attempted: false });
        // Network-level failures may have committed; keep attempted=true.
        setError((e as Error).message || "Something went wrong. Try again; it will not create a second player.");
      }
    } finally {
      setBusy(false);
    }
  };

  const selectExisting = async (c: ChildRow) => {
    setBusy(true); setError("");
    try {
      if (mode === "team") {
        try {
          await customFetch(`/api/v1/invites/${token}/children`, { method: "POST", body: JSON.stringify({ childId: c.id }) });
        } catch (e) {
          const msg = (e as Error).message ?? "";
          if (!(errorCode(e) === "ALREADY_ON_ROSTER" || /already on/i.test(msg))) throw e;
        }
      }
      await finishChild(c.id, `${c.firstName} ${c.lastName}`.trim());
    } catch (e) {
      setError((e as Error).message || "Could not select this player.");
    } finally {
      setBusy(false);
    }
  };

  const saveCoParent = () => {
    if (!coFirst.trim() || !coLast.trim()) { setCoError("Enter their first and last name."); return; }
    if (!isEmail(coEmail)) { setCoError("Enter a valid email address."); return; }
    setCoError("");
    update({
      coParent: { firstName: coFirst.trim(), lastName: coLast.trim(), email: coEmail.trim().toLowerCase(), relationshipType: coRel },
      stage: "player",
    });
  };

  const finish = () => {
    clearDraft(userId, scope);
    void refreshApp();
    onDone();
  };

  const co = draft.coParent;
  const delivery = draft.invitation ? deliveryLabel(draft.invitation.emailSent) : null;

  return (
    <Card className="rounded-xl border-border" data-testid="family-setup">
      <CardContent className="space-y-5 p-4 sm:p-6">
        <div className="space-y-3">
          <Steps current={draft.stage === "done" ? 3 : stageIndex} />
          <div className="rounded-lg border border-violet-200 bg-violet-50 p-3 text-xs text-violet-900" data-testid="note-coordinate-first">
            <div className="flex items-start gap-2">
              <Users className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                <strong>Your child only needs one profile.</strong> Two adults each sign in with their own login and share the same player.
                {teamName ? ` Coordinate with the other parent before you add a player to ${teamName}.` : " Coordinate with the other parent before creating a player."}
              </p>
            </div>
          </div>
        </div>

        {draft.stage === "checkpoint" && (
          <div className="space-y-3" data-testid="step-checkpoint">
            <h2 className="text-lg font-black tracking-tight">Has your child's other parent already set up a player?</h2>
            {!askOther ? (
              <div className="grid gap-2 sm:grid-cols-2">
                <Button type="button" variant="outline" className="h-auto whitespace-normal py-3 font-bold" onClick={() => setAskOther(true)} data-testid="btn-other-parent-yes">
                  Yes, they already did
                </Button>
                <Button type="button" variant="brand" className="h-auto whitespace-normal py-3 font-bold" onClick={() => update({ stage: "coparent" })} data-testid="btn-other-parent-no">
                  No, I will set it up
                </Button>
              </div>
            ) : (
              <div className="space-y-3 rounded-lg border border-border p-3 text-sm" data-testid="guidance-other-parent-created">
                <p>Ask them to send you a family invitation from the player's Family page. Open the link in that email while signed in as you, and accept it to share the same player. Do not create another profile.</p>
                <div className="flex flex-wrap gap-2">
                  <Link href="/family" className="inline-flex h-9 items-center rounded-md border border-border px-3 text-sm font-bold" data-testid="link-check-invitations" onClick={() => void refreshApp()}>Check my invitations</Link>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setAskOther(false)} data-testid="btn-guidance-back">Back</Button>
                </div>
                <button type="button" className="text-xs font-semibold text-violet-700 underline" onClick={() => update({ stage: "coparent" })} data-testid="btn-genuinely-new">
                  They have not, my child needs a new profile
                </button>
              </div>
            )}
          </div>
        )}

        {draft.stage === "coparent" && (
          <div className="space-y-3" data-testid="step-coparent">
            <h2 className="text-lg font-black tracking-tight">Invite another parent / legal guardian</h2>
            <p className="text-sm text-muted-foreground">
              They sign up with their own credentials and share the same player. We send the secure invitation once the player profile is ready. We never create an account or password for another adult.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1"><Label className="text-xs font-bold">First name</Label>
                <Input value={coFirst} onChange={(e) => setCoFirst(e.target.value)} data-testid="input-coparent-first" autoComplete="off" /></div>
              <div className="space-y-1"><Label className="text-xs font-bold">Last name</Label>
                <Input value={coLast} onChange={(e) => setCoLast(e.target.value)} data-testid="input-coparent-last" autoComplete="off" /></div>
            </div>
            <div className="space-y-1"><Label className="text-xs font-bold">Email</Label>
              <Input type="email" value={coEmail} onChange={(e) => setCoEmail(e.target.value)} data-testid="input-coparent-email" autoComplete="off" /></div>
            <div className="flex gap-2" role="radiogroup" aria-label="Relationship">
              {(["parent", "legal_guardian"] as const).map((r) => (
                <button key={r} type="button" role="radio" aria-checked={coRel === r} onClick={() => setCoRel(r)}
                  className={`rounded-full border px-3 py-1 text-xs font-bold ${coRel === r ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}
                  data-testid={`radio-relationship-${r}`}>{r === "parent" ? "Parent" : "Legal guardian"}</button>
              ))}
            </div>
            {coError && <p role="alert" className="text-xs text-destructive" data-testid="error-coparent">{coError}</p>}
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button type="button" variant="brand" onClick={saveCoParent} data-testid="btn-coparent-continue">Continue</Button>
              <Button type="button" variant="outline" onClick={() => update({ coParent: null, stage: "player" })} data-testid="btn-coparent-skip">Skip for now</Button>
            </div>
            <p className="text-xs text-muted-foreground">You can invite them later from your Family page. Nothing waits on them.</p>
          </div>
        )}

        {draft.stage === "player" && (
          <div className="space-y-4" data-testid="step-player">
            <h2 className="text-lg font-black tracking-tight">Player profile</h2>
            <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900" data-testid="note-check-other-parent">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>Check with your child's other parent before creating a player profile. Your child only needs one profile. If another parent already created it, ask them for a family invitation.</p>
            </div>
            {co && <p className="text-xs text-muted-foreground" data-testid="text-staged-coparent">After the profile is ready we will invite {co.firstName} {co.lastName} ({co.email}).</p>}
            {kids.isLoading ? <Skeleton className="h-16 rounded-lg" /> : kids.isError ? (
              <div className="space-y-2 rounded-lg border border-destructive/40 p-3 text-sm" data-testid="error-children-load">
                <p>We could not load your family, so we cannot tell whether your player already exists.</p>
                <Button type="button" variant="outline" size="sm" onClick={() => void kids.refetch()} data-testid="btn-retry-children">Retry</Button>
              </div>
            ) : (
              <>
                {(kids.data ?? []).length > 0 && (
                  <div className="space-y-2" data-testid="list-existing-children">
                    <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Choose your existing player</div>
                    {(kids.data ?? []).map((c) => (
                      <div key={c.id} className="flex items-center gap-3 rounded-lg border border-border p-3" data-testid={`row-linked-child-${c.id}`}>
                        <UserAvatar avatarUrl={c.avatarUrl} displayName={`${c.firstName} ${c.lastName}`.trim() || "Child"} size="md" />
                        <div className="min-w-0 flex-1 truncate font-bold">{c.firstName} {c.lastName}</div>
                        <Button type="button" variant="brand" size="sm" disabled={busy} onClick={() => void selectExisting(c)} data-testid={`btn-select-child-${c.id}`}>
                          {mode === "team" ? "Use for this team" : "Select"}
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
                {(kids.data ?? []).length > 0 && !showCreate ? (
                  <Button type="button" variant="outline" className="w-full font-bold" onClick={() => setShowCreate(true)} data-testid="btn-show-create-child-form">My child needs a new profile</Button>
                ) : (
                  <form onSubmit={(e) => { e.preventDefault(); void submitCreate(false); }} className="space-y-3" data-testid="form-new-player">
                    <p className="text-xs text-muted-foreground">New player. No email needed; the profile lives under your guardian account.</p>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1"><Label className="text-xs font-bold">First name</Label>
                        <Input value={first} onChange={(e) => { setFirst(e.target.value); setDuplicate(false); }} data-testid="input-child-first" /></div>
                      <div className="space-y-1"><Label className="text-xs font-bold">Last name</Label>
                        <Input value={last} onChange={(e) => { setLast(e.target.value); setDuplicate(false); }} data-testid="input-child-last" /></div>
                    </div>
                    {duplicate && (
                      <div className="space-y-2 rounded-lg border border-amber-400 bg-amber-50 p-3 text-xs text-amber-900" role="alert" data-testid="warning-possible-duplicate">
                        <p className="font-bold">A player with a similar name may already exist here.</p>
                        <p>Ask the other parent before continuing. We never link players by name. Only continue if this is a different child.</p>
                        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void submitCreate(true)} data-testid="btn-confirm-distinct">This is a different player, create it</Button>
                      </div>
                    )}
                    <Button type="submit" variant="brand" disabled={busy || duplicate} data-testid="btn-add-child">
                      {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{mode === "team" ? "Create player and add to roster" : "Create player profile"}
                    </Button>
                  </form>
                )}
              </>
            )}
            {error && <p role="alert" className="text-sm text-destructive" data-testid="error-setup">{error}</p>}
            {notice && <p className="text-xs text-muted-foreground" data-testid="text-setup-notice">{notice}</p>}
          </div>
        )}

        {draft.stage === "done" && (
          <div className="space-y-3" data-testid="step-done">
            <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm" data-testid="row-added-child">
              <CheckCircle2 className="h-4 w-4 text-emerald-700" />
              <span className="font-bold">{draft.childName}</span>
              <span className="ml-auto text-xs font-bold uppercase tracking-wider text-emerald-700">{mode === "team" ? "On roster" : "Ready"}</span>
            </div>
            {co && (
              <div className="space-y-2 rounded-lg border border-border p-3 text-sm" data-testid="coparent-status">
                <div className="flex items-center gap-2 font-bold">
                  <Mail className="h-4 w-4" /> {co.firstName} {co.lastName}
                  <span className={`ml-auto inline-flex items-center gap-1 text-xs uppercase tracking-wider ${connected ? "text-emerald-700" : "text-amber-700"}`} data-testid="status-coparent">
                    {connected ? <><CheckCircle2 className="h-3 w-3" /> Connected</> : <><Clock className="h-3 w-3" /> Pending</>}
                  </span>
                </div>
                {!draft.invitation && !inviting && <p className="text-xs text-muted-foreground" data-testid="text-invite-unsaved">The invitation has not been saved yet.</p>}
                {inviting && <p className="text-xs text-muted-foreground">Saving invitation...</p>}
                {!connected && delivery === "sent" && <p className="text-xs text-muted-foreground" data-testid="text-invite-sent">Invitation email sent to {co.email}. Status stays pending until they accept.</p>}
                {!connected && delivery === "saved" && <p className="text-xs text-muted-foreground" data-testid="text-invite-saved">Invitation saved as pending. We have not confirmed an email was delivered.</p>}
                {!connected && delivery === "failed" && <p className="text-xs text-amber-800" data-testid="text-invite-failed">Invitation saved, but the email could not be sent.</p>}
                {!connected && (!draft.invitation || delivery === "failed") && (
                  <Button type="button" variant="outline" size="sm" disabled={inviting || !draft.childId} onClick={() => void sendInvite(draft.childId!)} data-testid="btn-retry-invite">
                    {draft.invitation ? "Resend email" : "Try sending again"}
                  </Button>
                )}
                {notice && <p role="alert" className="text-xs text-destructive">{notice}</p>}
              </div>
            )}
            <Button type="button" variant="brand" className="w-full" disabled={busy || inviting} onClick={finish} data-testid="btn-finish-setup">
              {mode === "team" ? "Done, go to team" : "Done"}
            </Button>
          </div>
        )}

        {onSkipLater && draft.stage !== "done" && (
          <button type="button" className="text-xs font-semibold text-muted-foreground underline" onClick={onSkipLater} data-testid="btn-setup-later">I'll do this later</button>
        )}
      </CardContent>
    </Card>
  );
}
