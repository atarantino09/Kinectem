import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  customFetch,
  useAddTeamMember,
  useCreateRosterInvite,
  createRosterInvite,
  useListTeamMembers,
  useListRosterInvites,
  getListTeamMembersQueryKey,
  getListRosterInvitesQueryKey,
  queryOpts,
  type AddTeamMemberRequestPosition,
} from "@workspace/api-client-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Loader2,
  Search,
  Mail,
  UserCheck,
  Shield,
  Users,
  CheckCircle2,
  XCircle,
  MinusCircle,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { getInitials } from "@/lib/format";

const POSITIONS = [
  { value: "player", label: "Player" },
  { value: "admin", label: "Admin" },
  { value: "coach", label: "Head Coach" },
  { value: "assistant_coach", label: "Assistant Coach" },
  { value: "manager", label: "Team Manager" },
  { value: "parent", label: "Parent / Guardian" },
  { value: "author", label: "Author (Game Recaps)" },
] as const;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BULK_CONCURRENCY = 5;

type SearchUser = {
  id: string;
  displayName: string;
  avatarUrl: string | null;
};

type ParsedRow = {
  email: string;
  status: "valid" | "invalid" | "duplicate" | "alreadyOnRoster" | "alreadyPending";
};

type SendOutcome = {
  email: string;
  status: "success" | "skipped" | "failed";
  reason?: string;
};

function parseEmails(raw: string): string[] {
  return raw
    .split(/[\n,;\s]+/g)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
}

export function InviteRosterDialog({
  teamId,
  seasonId,
  open,
  onOpenChange,
}: {
  teamId: string;
  seasonId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchUser[]>([]);
  const [searching, setSearching] = useState(false);
  const [position, setPosition] = useState<AddTeamMemberRequestPosition>("player");

  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [emailPosition, setEmailPosition] =
    useState<AddTeamMemberRequestPosition>("player");

  const [bulkText, setBulkText] = useState("");
  const [bulkPosition, setBulkPosition] =
    useState<AddTeamMemberRequestPosition>("player");
  const [bulkSending, setBulkSending] = useState(false);
  const [bulkProgress, setBulkProgress] = useState({ done: 0, total: 0 });
  const [bulkResults, setBulkResults] = useState<SendOutcome[] | null>(null);
  const bulkAbortRef = useRef(false);

  const addMember = useAddTeamMember();
  const createInvite = useCreateRosterInvite();

  const { data: membersResp } = useListTeamMembers(teamId, undefined, {
    query: queryOpts({ enabled: open }),
  });
  const { data: invitesResp } = useListRosterInvites(teamId, undefined, {
    query: queryOpts({ enabled: open }),
  });

  const existingEmails = useMemo(() => {
    const members = new Set<string>();
    type LooseMember = {
      email?: string | null;
      parents?: Array<{ email?: string | null }> | null;
    };
    for (const m of (membersResp?.data ?? []) as LooseMember[]) {
      if (m.email) members.add(String(m.email).trim().toLowerCase());
      for (const p of m.parents ?? []) {
        if (p.email) members.add(String(p.email).trim().toLowerCase());
      }
    }
    return members;
  }, [membersResp]);

  const pendingEmails = useMemo(() => {
    const set = new Set<string>();
    for (const i of invitesResp?.data ?? []) {
      if (i.email) set.add(String(i.email).trim().toLowerCase());
    }
    return set;
  }, [invitesResp]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setResults([]);
      setEmail("");
      setName("");
      setBulkText("");
      setBulkSending(false);
      setBulkProgress({ done: 0, total: 0 });
      setBulkResults(null);
      bulkAbortRef.current = false;
    }
  }, [open]);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const r = await customFetch<{ data: SearchUser[] }>(
          `/api/v1/users?q=${encodeURIComponent(query.trim())}`,
        );
        if (!cancelled) setResults(r.data ?? []);
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query]);

  const invalidate = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: getListTeamMembersQueryKey(teamId) }),
      qc.invalidateQueries({ queryKey: getListRosterInvitesQueryKey(teamId) }),
    ]);
  };

  const onAddUser = async (u: SearchUser) => {
    try {
      await addMember.mutateAsync({
        teamId,
        data: {
          userId: u.id,
          seasonId,
          position,
        },
      });
      toast({ title: `Added ${u.displayName} (pending acceptance)` });
      await invalidate();
      onOpenChange(false);
    } catch {
      toast({ title: "Failed to add member", variant: "destructive" });
    }
  };

  const onSendInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      toast({ title: "Email required", variant: "destructive" });
      return;
    }
    try {
      await createInvite.mutateAsync({
        teamId,
        data: {
          email: email.trim(),
          seasonId,
          position: emailPosition,
        },
      });
      toast({ title: `Invite sent to ${email}` });
      await invalidate();
      onOpenChange(false);
    } catch {
      toast({ title: "Failed to send invite", variant: "destructive" });
    }
  };

  const parsedRows: ParsedRow[] = useMemo(() => {
    const seen = new Set<string>();
    const rows: ParsedRow[] = [];
    for (const e of parseEmails(bulkText)) {
      if (seen.has(e)) {
        rows.push({ email: e, status: "duplicate" });
        continue;
      }
      seen.add(e);
      if (!EMAIL_RE.test(e)) {
        rows.push({ email: e, status: "invalid" });
      } else if (existingEmails.has(e)) {
        rows.push({ email: e, status: "alreadyOnRoster" });
      } else if (pendingEmails.has(e)) {
        rows.push({ email: e, status: "alreadyPending" });
      } else {
        rows.push({ email: e, status: "valid" });
      }
    }
    return rows;
  }, [bulkText, existingEmails, pendingEmails]);

  const counts = useMemo(() => {
    const c = { valid: 0, duplicates: 0, invalid: 0, alreadyOn: 0, alreadyPending: 0 };
    for (const r of parsedRows) {
      if (r.status === "valid") c.valid++;
      else if (r.status === "duplicate") c.duplicates++;
      else if (r.status === "invalid") c.invalid++;
      else if (r.status === "alreadyOnRoster") c.alreadyOn++;
      else if (r.status === "alreadyPending") c.alreadyPending++;
    }
    return c;
  }, [parsedRows]);

  const onSendBulk = async () => {
    const validEmails = parsedRows
      .filter((r) => r.status === "valid")
      .map((r) => r.email);
    const skipped: SendOutcome[] = parsedRows
      .filter((r) => r.status !== "valid")
      .map((r) => ({
        email: r.email,
        status: "skipped",
        reason:
          r.status === "duplicate"
            ? "Duplicate in list"
            : r.status === "invalid"
              ? "Invalid email"
              : r.status === "alreadyOnRoster"
                ? "Already on roster"
                : "Already invited",
      }));

    if (validEmails.length === 0) {
      toast({ title: "No valid email addresses to send", variant: "destructive" });
      return;
    }

    bulkAbortRef.current = false;
    setBulkSending(true);
    setBulkProgress({ done: 0, total: validEmails.length });

    const sent: SendOutcome[] = [];
    let cursor = 0;

    const worker = async () => {
      while (!bulkAbortRef.current) {
        const idx = cursor++;
        if (idx >= validEmails.length) return;
        const addr = validEmails[idx];
        try {
          await createRosterInvite(teamId, {
            email: addr,
            seasonId,
            position: bulkPosition,
          });
          sent.push({ email: addr, status: "success" });
        } catch (err) {
          let msg = "Failed";
          if (err && typeof err === "object" && "message" in err) {
            msg = String((err as { message?: unknown }).message ?? "Failed");
          }
          sent.push({ email: addr, status: "failed", reason: msg });
        } finally {
          setBulkProgress((p) => ({ done: p.done + 1, total: p.total }));
        }
      }
    };

    const workers = Array.from(
      { length: Math.min(BULK_CONCURRENCY, validEmails.length) },
      () => worker(),
    );
    await Promise.all(workers);

    await invalidate();
    setBulkSending(false);
    setBulkResults([...sent, ...skipped]);
  };

  const onCancelBulk = () => {
    bulkAbortRef.current = true;
  };

  const helperFor = (pos: AddTeamMemberRequestPosition) => {
    if (pos === "player") {
      return (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          <Shield className="w-4 h-4 mt-0.5 shrink-0" />
          <p>
            <span className="font-bold">These invites go to the parents.</span>{" "}
            Each parent creates a guardian account, then adds their child(ren) to the roster.
          </p>
        </div>
      );
    }
    if (pos === "author") {
      return (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          <Shield className="w-4 h-4 mt-0.5 shrink-0" />
          <p>
            <span className="font-bold">Authors can write game recap articles.</span>{" "}
            This is a parent role with one extra permission. Their recaps go to an admin for approval before they post.
          </p>
        </div>
      );
    }
    return null;
  };

  const successCount = bulkResults?.filter((r) => r.status === "success").length ?? 0;
  const skippedCount = bulkResults?.filter((r) => r.status === "skipped").length ?? 0;
  const failedCount = bulkResults?.filter((r) => r.status === "failed").length ?? 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-black tracking-tight">
            Invite to roster
          </DialogTitle>
          <DialogDescription>
            Add an existing Kinectem user, send a single email invite, or paste a list of emails to invite the whole team at once.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="search" className="mt-2">
          <TabsList className="grid grid-cols-3 w-full">
            <TabsTrigger value="search" className="font-bold">
              <UserCheck className="w-4 h-4 mr-2" /> Existing user
            </TabsTrigger>
            <TabsTrigger value="email" className="font-bold">
              <Mail className="w-4 h-4 mr-2" /> Email invite
            </TabsTrigger>
            <TabsTrigger value="bulk" className="font-bold" data-testid="tab-bulk-invite">
              <Users className="w-4 h-4 mr-2" /> Bulk invite
            </TabsTrigger>
          </TabsList>

          <TabsContent value="search" className="space-y-3 mt-4">
            <div className="space-y-1.5">
              <Label className="font-bold">Position</Label>
              <Select
                value={position}
                onValueChange={(v) =>
                  setPosition(v as AddTeamMemberRequestPosition)
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {POSITIONS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="font-bold">Find user</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search by name or email..."
                  className="pl-9"
                  autoFocus
                  data-testid="input-roster-search"
                />
              </div>
            </div>
            <div className="border border-border rounded-lg max-h-64 overflow-y-auto divide-y divide-border">
              {searching && (
                <div className="p-4 flex items-center justify-center text-sm text-muted-foreground">
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Searching...
                </div>
              )}
              {!searching && query.trim().length >= 2 && results.length === 0 && (
                <div className="p-4 text-center text-sm text-muted-foreground">
                  No users found.
                </div>
              )}
              {!searching && query.trim().length < 2 && (
                <div className="p-4 text-center text-sm text-muted-foreground">
                  Type at least 2 characters.
                </div>
              )}
              {results.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => onAddUser(u)}
                  disabled={addMember.isPending}
                  className="w-full flex items-center gap-3 p-3 text-left hover:bg-muted/50 disabled:opacity-50"
                  data-testid={`btn-add-user-${u.id}`}
                >
                  <div className="w-9 h-9 rounded-full bg-slate-900 text-primary-foreground flex items-center justify-center text-[10px] font-bold">
                    {getInitials(u.displayName)}
                  </div>
                  <div className="flex-1">
                    <p className="font-bold text-sm">{u.displayName}</p>
                  </div>
                  <span className="text-xs font-bold text-primary uppercase tracking-wider">
                    Add
                  </span>
                </button>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="email" className="mt-4">
            <form onSubmit={onSendInvite} className="space-y-3">
              <div className="space-y-1.5">
                <Label className="font-bold">Position</Label>
                <Select
                  value={emailPosition}
                  onValueChange={(v) =>
                    setEmailPosition(v as AddTeamMemberRequestPosition)
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {POSITIONS.map((p) => (
                      <SelectItem key={p.value} value={p.value}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {emailPosition === "player" && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                  <Shield className="w-4 h-4 mt-0.5 shrink-0" />
                  <p>
                    <span className="font-bold">This invite goes to the parent.</span>{" "}
                    They'll create a guardian account, then add their child(ren) to the roster — they can add more than one if siblings play on the team.
                  </p>
                </div>
              )}
              {emailPosition === "author" && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                  <Shield className="w-4 h-4 mt-0.5 shrink-0" />
                  <p>
                    <span className="font-bold">Authors can write game recap articles.</span>{" "}
                    This is a parent role with one extra permission. Their recaps go to an admin for approval before they post.
                  </p>
                </div>
              )}
              <div className="space-y-1.5">
                <Label className="font-bold">
                  {emailPosition === "player"
                    ? "Parent / guardian email"
                    : "Email address"}
                </Label>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={
                    emailPosition === "player"
                      ? "parent@example.com"
                      : "name@example.com"
                  }
                  data-testid="input-invite-email"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="font-bold">
                  {emailPosition === "player"
                    ? "Player's name (optional)"
                    : "Name (optional)"}
                </Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={
                    emailPosition === "player"
                      ? "Child's name"
                      : "Recipient name"
                  }
                />
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => onOpenChange(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="brand"
                  disabled={createInvite.isPending}
                  data-testid="btn-send-invite"
                >
                  {createInvite.isPending ? "Sending..." : "Send invite"}
                </Button>
              </DialogFooter>
            </form>
          </TabsContent>

          <TabsContent value="bulk" className="mt-4 space-y-3">
            {bulkResults ? (
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                    <p className="text-2xl font-black text-emerald-700">{successCount}</p>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">Sent</p>
                  </div>
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                    <p className="text-2xl font-black text-amber-700">{skippedCount}</p>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-amber-700">Skipped</p>
                  </div>
                  <div className="rounded-lg border border-rose-200 bg-rose-50 p-3">
                    <p className="text-2xl font-black text-rose-700">{failedCount}</p>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-rose-700">Failed</p>
                  </div>
                </div>
                <div className="border border-border rounded-lg max-h-64 overflow-y-auto divide-y divide-border text-sm">
                  {bulkResults.map((r, i) => (
                    <div
                      key={`${r.email}-${i}`}
                      className="flex items-center gap-2 p-2"
                      data-testid={`bulk-result-row-${r.status}`}
                    >
                      {r.status === "success" && (
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                      )}
                      {r.status === "skipped" && (
                        <MinusCircle className="w-4 h-4 text-amber-600 shrink-0" />
                      )}
                      {r.status === "failed" && (
                        <XCircle className="w-4 h-4 text-rose-600 shrink-0" />
                      )}
                      <span className="flex-1 truncate font-mono text-xs">{r.email}</span>
                      {r.reason && (
                        <span className="text-[11px] text-muted-foreground">{r.reason}</span>
                      )}
                    </div>
                  ))}
                </div>
                <DialogFooter>
                  <Button
                    type="button"
                    variant="brand"
                    onClick={() => onOpenChange(false)}
                    data-testid="btn-bulk-done"
                  >
                    Done
                  </Button>
                </DialogFooter>
              </div>
            ) : (
              <>
                <div className="space-y-1.5">
                  <Label className="font-bold">Position</Label>
                  <Select
                    value={bulkPosition}
                    onValueChange={(v) =>
                      setBulkPosition(v as AddTeamMemberRequestPosition)
                    }
                    disabled={bulkSending}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {POSITIONS.map((p) => (
                        <SelectItem key={p.value} value={p.value}>
                          {p.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {helperFor(bulkPosition)}
                <div className="space-y-1.5">
                  <Label className="font-bold">Email addresses</Label>
                  <Textarea
                    value={bulkText}
                    onChange={(e) => setBulkText(e.target.value)}
                    placeholder={"parent1@example.com\nparent2@example.com\nparent3@example.com"}
                    rows={6}
                    className="font-mono text-xs"
                    disabled={bulkSending}
                    data-testid="textarea-bulk-emails"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Paste one per line, or separated by commas, semicolons, or spaces.
                  </p>
                </div>
                {parsedRows.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 text-[11px] font-bold">
                    <span
                      className="rounded-full bg-emerald-100 text-emerald-800 px-2 py-0.5"
                      data-testid="bulk-count-valid"
                    >
                      {counts.valid} valid
                    </span>
                    {counts.duplicates > 0 && (
                      <span className="rounded-full bg-slate-100 text-slate-700 px-2 py-0.5">
                        {counts.duplicates} duplicate
                      </span>
                    )}
                    {counts.invalid > 0 && (
                      <span className="rounded-full bg-rose-100 text-rose-800 px-2 py-0.5">
                        {counts.invalid} invalid
                      </span>
                    )}
                    {counts.alreadyOn > 0 && (
                      <span className="rounded-full bg-amber-100 text-amber-800 px-2 py-0.5">
                        {counts.alreadyOn} on roster
                      </span>
                    )}
                    {counts.alreadyPending > 0 && (
                      <span className="rounded-full bg-amber-100 text-amber-800 px-2 py-0.5">
                        {counts.alreadyPending} already invited
                      </span>
                    )}
                  </div>
                )}
                <DialogFooter>
                  {bulkSending ? (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={onCancelBulk}
                      data-testid="btn-bulk-cancel"
                    >
                      Stop
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => onOpenChange(false)}
                    >
                      Cancel
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="brand"
                    onClick={onSendBulk}
                    disabled={bulkSending || counts.valid === 0}
                    data-testid="btn-bulk-send"
                  >
                    {bulkSending
                      ? `Sending ${bulkProgress.done} of ${bulkProgress.total}…`
                      : `Send ${counts.valid} invite${counts.valid === 1 ? "" : "s"}`}
                  </Button>
                </DialogFooter>
              </>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
