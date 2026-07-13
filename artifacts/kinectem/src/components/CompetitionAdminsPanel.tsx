import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { UserAvatar } from "@/components/UserAvatar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  ChevronDown,
  Crown,
  Link2,
  Mail,
  ShieldCheck,
  UserPlus,
  X,
} from "lucide-react";

// Task #745 — shared "Admins" panel for a hub (kind="hub") or a competition
// (kind="competition"). Lists the owner + admins, lets any manager add an
// admin via user search or email invite, and lets ONLY the owner remove
// admins or withdraw pending invites (server enforces removal too; the
// owner is never removable). Minors never appear in the search results
// (COPPA — server-filtered). customFetch — routes are outside the locked
// openapi.yaml.

interface AdminMember {
  userId: string;
  displayName: string;
  email: string | null;
  avatarUrl: string | null;
  isOwner: boolean;
  since: string | null;
}

interface AdminInvite {
  id: string;
  invitedEmail: string;
  status: "pending" | "accepted" | "expired" | "withdrawn";
  invitedBy: { id: string; displayName: string } | null;
  createdAt: string;
  expiresAt: string | null;
}

interface SearchUser {
  id: string;
  displayName: string;
  email: string | null;
  avatarUrl: string | null;
}

export function CompetitionAdminsPanel({
  kind,
  targetId,
  collapsible = false,
}: {
  kind: "hub" | "competition";
  targetId: string;
  // Task #753 — when true, the panel renders collapsed by default with a
  // chevron toggle in its header (used on the hub page so competitions
  // list first). The competition console keeps the always-open layout.
  collapsible?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const base = kind === "hub" ? "organizers" : "competitions";
  const qc = useQueryClient();
  const { toast } = useToast();

  const adminsKey = ["competition-admins", kind, targetId];
  const invitesKey = ["competition-admin-invites", kind, targetId];

  const adminsQ = useQuery<{ data: AdminMember[]; viewerIsOwner: boolean }>({
    queryKey: adminsKey,
    queryFn: () =>
      customFetch<{ data: AdminMember[]; viewerIsOwner: boolean }>(
        `/api/v1/${base}/${targetId}/admins`,
        { method: "GET" },
      ),
    enabled: !!targetId,
  });
  const viewerIsOwner = adminsQ.data?.viewerIsOwner ?? false;

  const invitesQ = useQuery<{ data: AdminInvite[] }>({
    queryKey: invitesKey,
    queryFn: () =>
      customFetch<{ data: AdminInvite[] }>(
        `/api/v1/${base}/${targetId}/admin-invites`,
        { method: "GET" },
      ),
    enabled: !!targetId,
  });
  const invites = invitesQ.data?.data ?? [];

  // --- Add by user search -------------------------------------------------
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);

  const searchQ = useQuery<{ data: SearchUser[] }>({
    queryKey: ["competition-admin-user-search", debounced],
    queryFn: () =>
      customFetch<{ data: SearchUser[] }>(
        `/api/v1/competition-admin-user-search?q=${encodeURIComponent(debounced)}`,
        { method: "GET" },
      ),
    enabled: debounced.length >= 2,
  });
  const results = debounced.length >= 2 ? (searchQ.data?.data ?? []) : [];
  const memberIds = new Set((adminsQ.data?.data ?? []).map((m) => m.userId));

  const addAdmin = useMutation({
    mutationFn: (userId: string) =>
      customFetch<AdminMember>(`/api/v1/${base}/${targetId}/admins`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      }),
    onSuccess: (m) => {
      qc.invalidateQueries({ queryKey: adminsKey });
      setSearch("");
      toast({ title: `${m.displayName} is now an admin` });
    },
    onError: (err) =>
      toast({
        title: "Couldn't add admin",
        description: err instanceof Error ? err.message : "Try again.",
        variant: "destructive",
      }),
  });

  const removeAdmin = useMutation({
    mutationFn: (userId: string) =>
      customFetch(`/api/v1/${base}/${targetId}/admins/${userId}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminsKey });
      toast({ title: "Admin removed" });
    },
    onError: (err) =>
      toast({
        title: "Couldn't remove admin",
        description: err instanceof Error ? err.message : "Try again.",
        variant: "destructive",
      }),
  });

  // --- Email invites ------------------------------------------------------
  const [inviteEmail, setInviteEmail] = useState("");

  const copyText = async (text: string, okTitle: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: okTitle });
    } catch {
      toast({ title: "Couldn't copy the link", description: text });
    }
  };

  const sendInvite = useMutation({
    mutationFn: (email: string) =>
      customFetch<AdminInvite & { emailSent: boolean; acceptUrl: string }>(
        `/api/v1/${base}/${targetId}/admin-invites`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        },
      ),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: invitesKey });
      setInviteEmail("");
      if (r.emailSent) {
        toast({ title: `Invite sent to ${r.invitedEmail}` });
      } else {
        void copyText(
          r.acceptUrl,
          "Email couldn't be sent — invite link copied instead",
        );
      }
    },
    onError: (err) =>
      toast({
        title: "Couldn't send the invite",
        description: err instanceof Error ? err.message : "Try again.",
        variant: "destructive",
      }),
  });

  const copyInviteLink = useMutation({
    mutationFn: (inviteId: string) =>
      customFetch<{ acceptUrl: string }>(
        `/api/v1/${base}/${targetId}/admin-invites/${inviteId}/link`,
        { method: "POST" },
      ),
    onSuccess: (r) => void copyText(r.acceptUrl, "Invite link copied"),
    onError: (err) =>
      toast({
        title: "Couldn't copy the invite link",
        description: err instanceof Error ? err.message : "Try again.",
        variant: "destructive",
      }),
  });

  const withdrawInvite = useMutation({
    mutationFn: (inviteId: string) =>
      customFetch(`/api/v1/${base}/${targetId}/admin-invites/${inviteId}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: invitesKey });
      toast({ title: "Invite withdrawn" });
    },
    onError: (err) =>
      toast({
        title: "Couldn't withdraw the invite",
        description: err instanceof Error ? err.message : "Try again.",
        variant: "destructive",
      }),
  });

  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inviteEmail.trim());

  // Managers only — the server 403s for everyone else, so hide the panel
  // rather than render a broken card.
  if (adminsQ.isError) return null;

  const description = (
    <p className="text-sm text-muted-foreground">
      {kind === "hub"
        ? "Admins can manage this hub and every competition in it — including ones added later."
        : "Admins can manage this competition: schedule, branding, claims, and recap curation."}
    </p>
  );

  const body = (
    <CardContent className="space-y-4">
        {/* Current admins */}
        <div className="space-y-2">
          {(adminsQ.data?.data ?? []).map((m) => (
            <div
              key={m.userId}
              className="flex items-center gap-3 rounded-lg border border-border p-2.5"
              data-testid={`row-admin-${m.userId}`}
            >
              <UserAvatar
                avatarUrl={m.avatarUrl}
                displayName={m.displayName}
                size="sm"
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold truncate">{m.displayName}</p>
                {m.email ? (
                  <p className="text-xs text-muted-foreground truncate">
                    {m.email}
                  </p>
                ) : null}
              </div>
              {m.isOwner ? (
                <Badge className="shrink-0 gap-1" data-testid={`badge-owner-${m.userId}`}>
                  <Crown className="w-3 h-3" /> Owner
                </Badge>
              ) : viewerIsOwner ? (
                <Button
                  size="sm"
                  variant="ghost"
                  className="shrink-0 text-muted-foreground"
                  disabled={removeAdmin.isPending}
                  onClick={() => removeAdmin.mutate(m.userId)}
                  data-testid={`btn-remove-admin-${m.userId}`}
                >
                  <X className="w-3.5 h-3.5 mr-1" />
                  Remove
                </Button>
              ) : (
                <Badge variant="secondary" className="shrink-0">
                  Admin
                </Badge>
              )}
            </div>
          ))}
        </div>

        {/* Add by search */}
        <div className="space-y-2">
          <p className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">
            Add an admin
          </p>
          <div className="relative">
            <UserPlus className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search Kinectem users by name or email…"
              className="pl-8"
              data-testid="input-admin-search"
            />
          </div>
          {debounced.length >= 2 ? (
            <div className="rounded-lg border border-border divide-y divide-border">
              {searchQ.isLoading ? (
                <p className="p-2.5 text-xs text-muted-foreground">Searching…</p>
              ) : results.length === 0 ? (
                <p className="p-2.5 text-xs text-muted-foreground">
                  No matching users. You can invite them by email below.
                </p>
              ) : (
                results.map((u) => (
                  <div
                    key={u.id}
                    className="flex items-center gap-3 p-2.5"
                    data-testid={`row-search-${u.id}`}
                  >
                    <UserAvatar
                      avatarUrl={u.avatarUrl}
                      displayName={u.displayName}
                      size="sm"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold truncate">
                        {u.displayName}
                      </p>
                      {u.email ? (
                        <p className="text-xs text-muted-foreground truncate">
                          {u.email}
                        </p>
                      ) : null}
                    </div>
                    {memberIds.has(u.id) ? (
                      <Badge variant="secondary" className="shrink-0">
                        Already an admin
                      </Badge>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="shrink-0 font-bold rounded-full"
                        disabled={addAdmin.isPending}
                        onClick={() => addAdmin.mutate(u.id)}
                        data-testid={`btn-add-admin-${u.id}`}
                      >
                        Add
                      </Button>
                    )}
                  </div>
                ))
              )}
            </div>
          ) : null}
        </div>

        {/* Invite by email */}
        <div className="space-y-2">
          <p className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">
            Or invite by email
          </p>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (emailOk && !sendInvite.isPending)
                sendInvite.mutate(inviteEmail.trim());
            }}
          >
            <div className="relative flex-1">
              <Mail className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="coach@example.com"
                className="pl-8"
                data-testid="input-admin-invite-email"
              />
            </div>
            <Button
              type="submit"
              variant="outline"
              className="font-bold rounded-full shrink-0"
              disabled={!emailOk || sendInvite.isPending}
              data-testid="btn-send-admin-invite"
            >
              {sendInvite.isPending ? "Sending…" : "Send invite"}
            </Button>
          </form>
          {invites.length > 0 ? (
            <div className="space-y-1.5">
              {invites.map((i) => (
                <div
                  key={i.id}
                  className="flex items-center gap-2 rounded-lg border border-dashed border-border p-2.5"
                  data-testid={`row-admin-invite-${i.id}`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold truncate">
                      {i.invitedEmail}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Pending
                      {i.invitedBy ? ` · invited by ${i.invitedBy.displayName}` : ""}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="shrink-0 text-muted-foreground"
                    disabled={copyInviteLink.isPending}
                    onClick={() => copyInviteLink.mutate(i.id)}
                    data-testid={`btn-copy-invite-${i.id}`}
                  >
                    <Link2 className="w-3.5 h-3.5 mr-1" />
                    Copy link
                  </Button>
                  {viewerIsOwner ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="shrink-0 text-muted-foreground"
                      disabled={withdrawInvite.isPending}
                      onClick={() => withdrawInvite.mutate(i.id)}
                      data-testid={`btn-withdraw-invite-${i.id}`}
                    >
                      <X className="w-3.5 h-3.5 mr-1" />
                      Withdraw
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </CardContent>
  );

  if (collapsible) {
    return (
      <Collapsible open={open} onOpenChange={setOpen}>
        <Card data-testid={`card-admins-${kind}`}>
          <CollapsibleTrigger asChild>
            <CardHeader
              className="cursor-pointer select-none"
              role="button"
              data-testid={`btn-toggle-admins-${kind}`}
            >
              <CardTitle className="flex items-center gap-2 text-base">
                <ShieldCheck className="w-4 h-4" />
                Admins
                <ChevronDown
                  className={`w-4 h-4 ml-auto transition-transform ${open ? "rotate-180" : ""}`}
                />
              </CardTitle>
              {description}
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>{body}</CollapsibleContent>
        </Card>
      </Collapsible>
    );
  }

  return (
    <Card data-testid={`card-admins-${kind}`}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="w-4 h-4" />
          Admins
        </CardTitle>
        {description}
      </CardHeader>
      {body}
    </Card>
  );
}
