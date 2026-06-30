import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  customFetch,
  useAddTeamMember,
  useCreateRosterInvite,
  createRosterInvite,
  useGetOrCreateTeamJoinLink,
  useGetLoggedInUser,
  useListTeamMembers,
  useListRosterInvites,
  getListTeamMembersQueryKey,
  getListRosterInvitesQueryKey,
  queryOpts,
  type AddTeamMemberRequestPosition,
} from "@workspace/api-client-react";
import { buildCoachInviteText } from "@workspace/invite-copy";
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
  Link2,
  Copy,
  AlertTriangle,
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
  // Task #654 — for successful sends, whether the invite email actually went
  // out (true), failed to send (false), or was not attempted because the
  // invitee already has an account and got an in-app notification (null).
  emailSent?: boolean | null;
  acceptUrl?: string;
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
  teamName,
  open,
  onOpenChange,
}: {
  teamId: string;
  seasonId: string;
  teamName: string;
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

  // Task #654 — outcome of the most recent single email invite, used to show
  // honest "emailed / couldn't email" feedback plus a copy-link fallback.
  const [inviteResult, setInviteResult] = useState<{
    email: string;
    emailSent: boolean | null;
    acceptUrl: string;
  } | null>(null);
  const [resultCopied, setResultCopied] = useState(false);
  const [resultMsgCopied, setResultMsgCopied] = useState(false);

  const addMember = useAddTeamMember();
  const createInvite = useCreateRosterInvite();

  const { data: me } = useGetLoggedInUser();

  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [linkErrored, setLinkErrored] = useState(false);
  const [copied, setCopied] = useState(false);
  const [messageCopied, setMessageCopied] = useState(false);
  const [showFullMessage, setShowFullMessage] = useState(false);
  const generateLink = useGetOrCreateTeamJoinLink({
    mutation: {
      onSuccess: (resp) => {
        setLinkToken(resp.token);
        setLinkErrored(false);
      },
      onError: () => {
        setLinkToken(null);
        setLinkErrored(true);
      },
    },
  });

  // Auto-load the existing join link when the dialog opens. Endpoint is
  // get-or-create — it reuses the single email-less rosterInvite for the
  // team, so this won't mint duplicates. Guarded by a ref so React
  // StrictMode's double-invoke doesn't fire the request twice.
  const autoFetchedRef = useRef<string | null>(null);
  const generateMutate = generateLink.mutate;
  useEffect(() => {
    if (!open) {
      autoFetchedRef.current = null;
      setLinkToken(null);
      setLinkErrored(false);
      setCopied(false);
      setMessageCopied(false);
      return;
    }
    if (autoFetchedRef.current === teamId) return;
    autoFetchedRef.current = teamId;
    setLinkToken(null);
    setLinkErrored(false);
    setCopied(false);
    setMessageCopied(false);
    generateMutate({ teamId });
  }, [open, teamId, generateMutate]);

  const fullLink = linkToken
    ? `${window.location.origin}${import.meta.env.BASE_URL}invites/${linkToken}`
    : null;

  const onCopyLink = () => {
    if (!fullLink) return;
    navigator.clipboard
      .writeText(fullLink)
      .then(() => {
        setCopied(true);
        toast({ title: "Link copied" });
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() =>
        toast({ title: "Couldn't copy link", variant: "destructive" }),
      );
  };

  // Task #634 — ready-to-paste "join Kinectem" outreach message. Same
  // wording as the invite email (shared from @workspace/invite-copy), with
  // the coach's name and the shareable join link substituted in.
  const coachName = me ? `${me.firstName} ${me.lastName}`.trim() : "";
  const inviteMessage =
    fullLink && coachName
      ? buildCoachInviteText({ coachName, link: fullLink })
      : null;

  const onCopyMessage = () => {
    if (!inviteMessage) return;
    navigator.clipboard
      .writeText(inviteMessage)
      .then(() => {
        setMessageCopied(true);
        toast({ title: "Message copied" });
        setTimeout(() => setMessageCopied(false), 2000);
      })
      .catch(() =>
        toast({ title: "Couldn't copy message", variant: "destructive" }),
      );
  };

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
      // Only a still-`pending` invite blocks re-inviting. Terminal states
      // (withdrawn/declined/expired/resolved/accepted) must NOT mark an email
      // as "already invited", otherwise a revoked email can never be re-sent.
      if (i.email && i.status === "pending") {
        set.add(String(i.email).trim().toLowerCase());
      }
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
      setShowFullMessage(false);
      setInviteResult(null);
      setResultCopied(false);
      setResultMsgCopied(false);
      bulkAbortRef.current = false;
    }
  }, [open]);

  // Task #654 — short, ready-to-paste outreach for a single recipient. Unlike
  // the long "join Kinectem" copy above, this names the specific team and the
  // invitee's own accept link so a coach can text/email it directly.
  const shortInviteMessage = (link: string) =>
    `You've been invited to join ${teamName} on Kinectem — accept here: ${link}`;

  const copyToClipboard = (text: string, label: string) =>
    navigator.clipboard
      .writeText(text)
      .then(() => toast({ title: `${label} copied` }))
      .catch(() =>
        toast({
          title: `Couldn't copy ${label.toLowerCase()}`,
          variant: "destructive",
        }),
      );

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
      const resp = await createInvite.mutateAsync({
        teamId,
        data: {
          email: email.trim(),
          seasonId,
          position: emailPosition,
        },
      });
      // Task #654 — `emailSent` + `acceptUrl` are appended by the server
      // outside the locked openapi.yaml, so read them via a narrow cast (same
      // pattern as `hasOwner`/`myClaimStatus`).
      const extra = resp as {
        emailSent?: boolean | null;
        acceptUrl?: string;
        token?: string;
      };
      const acceptUrl =
        extra.acceptUrl ??
        `${window.location.origin}${import.meta.env.BASE_URL}invites/${extra.token ?? ""}`;
      setResultCopied(false);
      setResultMsgCopied(false);
      setInviteResult({
        email: email.trim(),
        emailSent: extra.emailSent ?? null,
        acceptUrl,
      });
      await invalidate();
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
          const resp = await createRosterInvite(teamId, {
            email: addr,
            seasonId,
            position: bulkPosition,
          });
          // Task #654 — capture the per-recipient email outcome (appended
          // outside the locked spec) so undelivered invites can be listed.
          const extra = resp as {
            emailSent?: boolean | null;
            acceptUrl?: string;
          };
          sent.push({
            email: addr,
            status: "success",
            emailSent: extra.emailSent ?? null,
            acceptUrl: extra.acceptUrl,
          });
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
  // Task #654 — invites that were created but whose email did NOT send. These
  // need manual follow-up (copy the link), so surface them explicitly.
  const undelivered =
    bulkResults?.filter(
      (r) => r.status === "success" && r.emailSent === false,
    ) ?? [];

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

        {(generateLink.isPending || fullLink || linkErrored) && (
          <div className="mt-2 min-w-0 max-w-full overflow-hidden rounded-xl border border-border p-3 space-y-2">
            <div className="flex items-center gap-2">
              <Link2 className="w-3.5 h-3.5 text-primary" />
              <h3 className="font-black tracking-tight text-sm">
                Shareable join link
              </h3>
            </div>
            {fullLink ? (
              <>
                <div className="flex flex-col sm:flex-row gap-2 sm:items-center min-w-0">
                  <code
                    className="block sm:flex-1 min-w-0 max-w-full text-xs bg-muted px-3 py-2 rounded-lg truncate"
                    data-testid="text-invite-share-link"
                  >
                    {fullLink}
                  </code>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={onCopyLink}
                    className="gap-1 font-bold self-start sm:self-auto shrink-0"
                    data-testid="button-copy-invite-share-link"
                  >
                    {copied ? (
                      <>
                        <CheckCircle2 className="w-3 h-3" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        Copy
                      </>
                    )}
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Anyone with this link can request to join the team.
                </p>
                <div className="mt-3 border-t border-border pt-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-black tracking-tight text-sm">
                      Message to copy &amp; share
                    </h3>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={onCopyMessage}
                      disabled={!inviteMessage}
                      className="gap-1 font-bold shrink-0"
                      data-testid="button-copy-invite-message"
                    >
                      {messageCopied ? (
                        <>
                          <CheckCircle2 className="w-3 h-3" />
                          Copied
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" />
                          Copy
                        </>
                      )}
                    </Button>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Sharing the link somewhere else (a group text, GroupMe,
                    TeamSnap)? Paste this message too — it already has your name
                    and the join link.
                  </p>
                  {inviteMessage ? (
                    <div>
                      <div className="relative">
                        <pre
                          className={
                            "whitespace-pre-wrap break-words rounded-lg bg-muted px-3 py-2 text-xs font-sans leading-5" +
                            (showFullMessage ? "" : " max-h-40 overflow-hidden")
                          }
                          data-testid="text-invite-message"
                        >
                          {inviteMessage}
                        </pre>
                        {!showFullMessage && (
                          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 rounded-b-lg bg-gradient-to-t from-muted to-transparent" />
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowFullMessage((v) => !v)}
                        className="mt-1 text-xs font-medium text-primary hover:underline"
                        data-testid="button-toggle-invite-message"
                      >
                        {showFullMessage ? "Show less" : "Show full message"}
                      </button>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground flex items-center gap-2">
                      <Loader2 className="w-3 h-3 animate-spin" /> Preparing
                      message…
                    </p>
                  )}
                </div>
              </>
            ) : linkErrored ? (
              <p className="text-xs text-muted-foreground">
                Shareable link isn't available for this team.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground flex items-center gap-2">
                <Loader2 className="w-3 h-3 animate-spin" /> Loading join link…
              </p>
            )}
          </div>
        )}

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

          <TabsContent value="email" className="mt-4 space-y-4">
            {inviteResult ? (
              <div className="space-y-3" data-testid="invite-result-panel">
                {inviteResult.emailSent === true && (
                  <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
                    <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
                    <p>
                      <span className="font-bold">
                        Invite emailed to {inviteResult.email}.
                      </span>{" "}
                      They'll get a link to accept. You can also share the link
                      below as a backup.
                    </p>
                  </div>
                )}
                {inviteResult.emailSent === false && (
                  <div
                    className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"
                    data-testid="invite-email-failed"
                  >
                    <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                    <p>
                      <span className="font-bold">
                        We couldn't send the email automatically.
                      </span>{" "}
                      The invite is still active — copy the link below and send
                      it to {inviteResult.email} yourself.
                    </p>
                  </div>
                )}
                {inviteResult.emailSent === null && (
                  <div className="flex items-start gap-2 rounded-lg border border-sky-200 bg-sky-50 p-3 text-xs text-sky-900">
                    <Mail className="w-4 h-4 mt-0.5 shrink-0" />
                    <p>
                      <span className="font-bold">
                        {inviteResult.email} already has a Kinectem account.
                      </span>{" "}
                      We sent them an in-app notification. You can also share the
                      link below.
                    </p>
                  </div>
                )}

                <div className="space-y-1.5">
                  <Label className="font-bold text-xs">Invite link</Label>
                  <div className="flex flex-col sm:flex-row gap-2 sm:items-center min-w-0">
                    <code
                      className="block sm:flex-1 min-w-0 max-w-full text-xs bg-muted px-3 py-2 rounded-lg truncate"
                      data-testid="text-invite-accept-link"
                    >
                      {inviteResult.acceptUrl}
                    </code>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        copyToClipboard(inviteResult.acceptUrl, "Link");
                        setResultCopied(true);
                        setTimeout(() => setResultCopied(false), 2000);
                      }}
                      className="gap-1 font-bold self-start sm:self-auto shrink-0"
                      data-testid="button-copy-invite-accept-link"
                    >
                      {resultCopied ? (
                        <>
                          <CheckCircle2 className="w-3 h-3" />
                          Copied
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" />
                          Copy
                        </>
                      )}
                    </Button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <Label className="font-bold text-xs">Message to send</Label>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        copyToClipboard(
                          shortInviteMessage(inviteResult.acceptUrl),
                          "Message",
                        );
                        setResultMsgCopied(true);
                        setTimeout(() => setResultMsgCopied(false), 2000);
                      }}
                      className="gap-1 font-bold shrink-0"
                      data-testid="button-copy-invite-accept-message"
                    >
                      {resultMsgCopied ? (
                        <>
                          <CheckCircle2 className="w-3 h-3" />
                          Copied
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" />
                          Copy
                        </>
                      )}
                    </Button>
                  </div>
                  <pre
                    className="whitespace-pre-wrap break-words rounded-lg bg-muted px-3 py-2 text-xs font-sans leading-5"
                    data-testid="text-invite-accept-message"
                  >
                    {shortInviteMessage(inviteResult.acceptUrl)}
                  </pre>
                </div>

                <DialogFooter>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setInviteResult(null);
                      setEmail("");
                      setName("");
                    }}
                    data-testid="btn-invite-another"
                  >
                    Invite someone else
                  </Button>
                  <Button
                    type="button"
                    variant="brand"
                    onClick={() => onOpenChange(false)}
                    data-testid="btn-invite-result-done"
                  >
                    Done
                  </Button>
                </DialogFooter>
              </div>
            ) : (
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
            )}
          </TabsContent>

          <TabsContent value="bulk" className="mt-4 space-y-3">
            {bulkResults ? (
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                    <p className="text-2xl font-black text-emerald-700">{successCount}</p>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">Invited</p>
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
                      {r.status === "success" && r.emailSent !== false && (
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                      )}
                      {r.status === "success" && r.emailSent === false && (
                        <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                      )}
                      {r.status === "skipped" && (
                        <MinusCircle className="w-4 h-4 text-amber-600 shrink-0" />
                      )}
                      {r.status === "failed" && (
                        <XCircle className="w-4 h-4 text-rose-600 shrink-0" />
                      )}
                      <span className="flex-1 truncate font-mono text-xs">{r.email}</span>
                      {r.status === "success" && r.emailSent === false && (
                        <span className="text-[11px] text-amber-700">Email not delivered</span>
                      )}
                      {r.reason && (
                        <span className="text-[11px] text-muted-foreground">{r.reason}</span>
                      )}
                    </div>
                  ))}
                </div>
                {undelivered.length > 0 && (
                  <div
                    className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-2"
                    data-testid="bulk-undelivered-panel"
                  >
                    <div className="flex items-start gap-2 text-xs text-amber-900">
                      <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                      <p>
                        <span className="font-bold">
                          {undelivered.length} invite
                          {undelivered.length === 1 ? "" : "s"} couldn't be
                          emailed automatically.
                        </span>{" "}
                        The invites are still active — copy each link and send it
                        to the person directly.
                      </p>
                    </div>
                    <div className="space-y-1.5">
                      {undelivered.map((r, i) => (
                        <div
                          key={`${r.email}-undelivered-${i}`}
                          className="flex items-center gap-2"
                          data-testid="bulk-undelivered-row"
                        >
                          <span className="flex-1 truncate font-mono text-[11px]">
                            {r.email}
                          </span>
                          {r.acceptUrl && (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="gap-1 font-bold shrink-0 h-7"
                              onClick={() =>
                                copyToClipboard(r.acceptUrl!, "Link")
                              }
                              data-testid="button-copy-bulk-undelivered-link"
                            >
                              <Copy className="w-3 h-3" /> Copy link
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
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
                  <p className="text-[11px] text-muted-foreground">
                    Kinectem emails each address the same invite message shown
                    with the shareable link above — with your name and the
                    team's join link.
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
