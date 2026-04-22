import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  customFetch,
  useAddTeamMember,
  useCreateRosterInvite,
  getListTeamMembersQueryKey,
  getListRosterInvitesQueryKey,
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
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Search, Mail, UserCheck, Shield } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { getInitials } from "@/lib/format";

const POSITIONS = [
  { value: "player", label: "Player" },
  { value: "coach", label: "Head Coach" },
  { value: "assistant_coach", label: "Assistant Coach" },
  { value: "manager", label: "Team Manager" },
  { value: "parent", label: "Parent" },
] as const;

type SearchUser = {
  id: string;
  displayName: string;
  avatarUrl: string | null;
};

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
  const [position, setPosition] = useState<string>("player");

  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [emailPosition, setEmailPosition] = useState<string>("player");

  const addMember = useAddTeamMember();
  const createInvite = useCreateRosterInvite();

  useEffect(() => {
    if (!open) {
      setQuery("");
      setResults([]);
      setEmail("");
      setName("");
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
          position: position as never,
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
          position: emailPosition as never,
        },
      });
      toast({ title: `Invite sent to ${email}` });
      await invalidate();
      onOpenChange(false);
    } catch {
      toast({ title: "Failed to send invite", variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-black tracking-tight">
            Invite to roster
          </DialogTitle>
          <DialogDescription>
            Add an existing Kinectem user or send an email invite.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="search" className="mt-2">
          <TabsList className="grid grid-cols-2 w-full">
            <TabsTrigger value="search" className="font-bold">
              <UserCheck className="w-4 h-4 mr-2" /> Existing user
            </TabsTrigger>
            <TabsTrigger value="email" className="font-bold">
              <Mail className="w-4 h-4 mr-2" /> Email invite
            </TabsTrigger>
          </TabsList>

          <TabsContent value="search" className="space-y-3 mt-4">
            <div className="space-y-1.5">
              <Label className="font-bold">Position</Label>
              <Select value={position} onValueChange={setPosition}>
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
                <Select value={emailPosition} onValueChange={setEmailPosition}>
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
                  disabled={createInvite.isPending}
                  className="font-bold"
                  data-testid="btn-send-invite"
                >
                  {createInvite.isPending ? "Sending..." : "Send invite"}
                </Button>
              </DialogFooter>
            </form>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
