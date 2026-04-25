import { useEffect, useState } from "react";
import { Link } from "wouter";
import {
  customFetch,
  useGetLoggedInUser,
  type PrivateUserResponse,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Shield,
  UserPlus,
  Search,
  Users,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Mail,
  BellOff,
  Pencil,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatDate, getInitials } from "@/lib/format";
import { EditProfileDialog } from "@/components/EditProfileDialog";

interface Child {
  id: string;
  firstName: string;
  lastName: string;
  role: string;
  email: string | null;
  avatarUrl: string | null;
  requireTagConsent: boolean;
  guardianEmail: string | null;
  guardianConfirmedAt: string | null;
  confirmationStatus: "none" | "confirmed" | "pending" | "expired";
  confirmedByMe: boolean;
}

interface SearchUser {
  id: string;
  firstName: string;
  lastName: string;
  role: string;
  email: string | null;
  avatarUrl: string | null;
}

export default function GuardianPage() {
  const { data: me } = useGetLoggedInUser();
  const { toast } = useToast();
  const [children, setChildren] = useState<Child[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchUser[]>([]);
  const [searching, setSearching] = useState(false);
  const [linking, setLinking] = useState<string | null>(null);
  const [resending, setResending] = useState<string | null>(null);
  const [emailOptOut, setEmailOptOut] = useState(false);
  const [emailPrefLoading, setEmailPrefLoading] = useState(true);
  const [savingEmailPref, setSavingEmailPref] = useState(false);
  const [editingChild, setEditingChild] =
    useState<PrivateUserResponse | null>(null);
  const [loadingEditFor, setLoadingEditFor] = useState<string | null>(null);

  const openEditDialog = async (child: Child) => {
    setLoadingEditFor(child.id);
    try {
      const full = await customFetch<PrivateUserResponse>(
        `/api/v1/users/${child.id}`,
      );
      setEditingChild(full);
    } catch {
      toast({
        title: "Could not open editor",
        description: "Try again in a moment.",
        variant: "destructive",
      });
    } finally {
      setLoadingEditFor(null);
    }
  };

  const refresh = async () => {
    setLoading(true);
    try {
      const r = await customFetch<{ data: Child[] }>(
        "/api/v1/users/me/children",
      );
      setChildren(r.data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    if (!me || me.role !== "parent") {
      setEmailPrefLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setEmailPrefLoading(true);
      try {
        const r = await customFetch<{ emailOptOut: boolean }>(
          "/api/v1/notifications/email-preference",
        );
        if (!cancelled) setEmailOptOut(!!r.emailOptOut);
      } catch {
        // ignore — leave the toggle in its default state
      } finally {
        if (!cancelled) setEmailPrefLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [me]);

  const toggleExpiredEmail = async (silenced: boolean) => {
    // The switch represents "Email me" — when it is OFF the parent is
    // opting out of the expired-confirmation email.
    const optOut = !silenced;
    setSavingEmailPref(true);
    setEmailOptOut(optOut);
    try {
      const r = await customFetch<{ emailOptOut: boolean }>(
        "/api/v1/notifications/email-preference",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ emailOptOut: optOut }),
        },
      );
      setEmailOptOut(!!r.emailOptOut);
      toast({
        title: r.emailOptOut
          ? "Expired-confirmation emails turned off"
          : "Expired-confirmation emails turned on",
      });
    } catch {
      // revert on failure
      setEmailOptOut(!optOut);
      toast({
        title: "Failed to update email preference",
        variant: "destructive",
      });
    } finally {
      setSavingEmailPref(false);
    }
  };

  useEffect(() => {
    if (!query.trim() || query.trim().length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await customFetch<{ data: SearchUser[] }>(
          `/api/v1/users?role=athlete&q=${encodeURIComponent(query.trim())}`,
        );
        setResults(r.data ?? []);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  const linkChild = async (childId: string) => {
    setLinking(childId);
    try {
      await customFetch("/api/v1/users/me/children", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ childId }),
      });
      toast({ title: "Child linked to your guardian account" });
      setQuery("");
      setResults([]);
      await refresh();
    } catch (e) {
      const msg = (e as Error)?.message ?? "Failed to link child";
      toast({ title: msg, variant: "destructive" });
    } finally {
      setLinking(null);
    }
  };

  const resendConfirmation = async (child: Child) => {
    setResending(child.id);
    try {
      const r = await customFetch<{
        ok: boolean;
        guardianEmail: string;
        guardianConfirmUrl: string;
      }>(
        `/api/v1/users/me/children/${child.id}/resend-guardian-confirm`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      toast({
        title: `New confirmation link sent to ${r.guardianEmail}`,
        description: r.guardianConfirmUrl,
      });
      await refresh();
    } catch (e) {
      const msg = (e as Error)?.message ?? "Failed to resend link";
      toast({ title: msg, variant: "destructive" });
    } finally {
      setResending(null);
    }
  };

  const toggleConsent = async (child: Child, value: boolean) => {
    try {
      await customFetch(
        `/api/v1/users/me/children/${child.id}/visibility`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ requireTagConsent: value }),
        },
      );
      setChildren((prev) =>
        prev.map((c) =>
          c.id === child.id ? { ...c, requireTagConsent: value } : c,
        ),
      );
      toast({
        title: value
          ? `Tag consent now required for ${child.firstName}`
          : `Tag consent no longer required for ${child.firstName}`,
      });
    } catch {
      toast({ title: "Failed to update setting", variant: "destructive" });
    }
  };

  if (me && me.role !== "parent") {
    return (
      <Card className="rounded-xl border-border">
        <CardContent className="p-8 text-center space-y-2">
          <Shield className="w-10 h-10 text-muted-foreground mx-auto" />
          <h2 className="text-xl font-black tracking-tight">
            Guardian dashboard
          </h2>
          <p className="text-sm text-muted-foreground">
            This page is only available to parent or guardian accounts.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-600 to-blue-600 flex items-center justify-center">
          <Users className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-3xl font-black tracking-tight">Family</h1>
          <p className="text-sm text-muted-foreground">
            Link your children's accounts and control how they appear on
            Kinectem.
          </p>
        </div>
      </div>

      {/* Notification preferences */}
      <Card className="rounded-xl border-border" data-testid="card-email-pref">
        <CardContent className="p-6 space-y-3">
          <div className="flex items-center gap-2">
            <BellOff className="w-4 h-4 text-primary" />
            <h2 className="font-black tracking-tight">
              Notification preferences
            </h2>
          </div>
          {emailPrefLoading ? (
            <Skeleton className="h-12 rounded-lg" />
          ) : (
            <div className="flex items-start gap-3 p-3 rounded-lg border border-border">
              <div className="flex-1 min-w-0">
                <p className="font-bold text-sm">
                  Email me when a confirmation link expires
                </p>
                <p className="text-xs text-muted-foreground">
                  You'll always see expired links in your in-app notifications.
                  Turn this off if those reminders are enough.
                </p>
              </div>
              <Switch
                checked={!emailOptOut}
                disabled={savingEmailPref}
                onCheckedChange={toggleExpiredEmail}
                data-testid="switch-expired-email"
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Linked children */}
      <Card className="rounded-xl border-border">
        <CardContent className="p-6 space-y-4">
          <h2 className="font-black tracking-tight">Linked children</h2>
          {loading ? (
            <Skeleton className="h-20 rounded-lg" />
          ) : children.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              You haven't linked any children yet. Find an athlete below to get
              started.
            </p>
          ) : (
            <div className="space-y-3">
              {children.map((c) => (
                <div
                  key={c.id}
                  className="flex flex-col gap-3 p-3 rounded-lg border border-border"
                  data-testid={`row-child-${c.id}`}
                >
                  <div className="flex items-center gap-3">
                    <Avatar className="w-10 h-10 border border-border shrink-0">
                      {c.avatarUrl && <AvatarImage src={c.avatarUrl} />}
                      <AvatarFallback className="bg-slate-900 text-white font-bold text-xs">
                        {getInitials(`${c.firstName} ${c.lastName}`)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <Link href={`/users/${c.id}`}>
                        <p className="font-bold text-sm cursor-pointer hover:text-primary truncate">
                          {c.firstName} {c.lastName}
                        </p>
                      </Link>
                      <p className="text-xs text-muted-foreground truncate">
                        {c.email ?? "No email on file"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        size="sm"
                        variant="outline"
                        className="font-bold rounded-full gap-1.5"
                        disabled={loadingEditFor === c.id}
                        onClick={() => openEditDialog(c)}
                        data-testid={`btn-edit-child-${c.id}`}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                        {loadingEditFor === c.id ? "Loading…" : "Edit profile"}
                      </Button>
                      <div className="text-right text-xs">
                        <p className="font-bold">Require tag consent</p>
                        <p className="text-muted-foreground">
                          {c.requireTagConsent
                            ? "Coaches must ask first"
                            : "Anyone may tag"}
                        </p>
                      </div>
                      <Switch
                        checked={c.requireTagConsent}
                        onCheckedChange={(v) => toggleConsent(c, v)}
                        data-testid={`switch-consent-${c.id}`}
                      />
                    </div>
                  </div>

                  {c.confirmationStatus !== "none" && (
                    <div
                      className="flex flex-wrap items-center gap-2 pt-2 border-t border-border"
                      data-testid={`status-confirmation-${c.id}`}
                    >
                      {c.confirmationStatus === "confirmed" && (
                        <>
                          <Badge
                            variant="outline"
                            className="font-bold gap-1 border-green-600 text-green-700 dark:text-green-400"
                          >
                            <CheckCircle2 className="w-3 h-3" />
                            {c.confirmedByMe
                              ? "Confirmed by you"
                              : "Confirmed"}
                          </Badge>
                          {c.guardianConfirmedAt && (
                            <span
                              className="text-xs text-muted-foreground"
                              data-testid={`text-confirmed-on-${c.id}`}
                            >
                              Confirmed on {formatDate(c.guardianConfirmedAt)}
                            </span>
                          )}
                        </>
                      )}
                      {c.confirmationStatus === "pending" && (
                        <Badge
                          variant="outline"
                          className="font-bold gap-1 border-amber-500 text-amber-700 dark:text-amber-400"
                        >
                          <Clock className="w-3 h-3" />
                          Pending guardian confirmation
                        </Badge>
                      )}
                      {c.confirmationStatus === "expired" && (
                        <Badge
                          variant="outline"
                          className="font-bold gap-1 border-red-500 text-red-700 dark:text-red-400"
                        >
                          <AlertTriangle className="w-3 h-3" />
                          Confirmation link expired
                        </Badge>
                      )}
                      {c.guardianEmail && (
                        <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
                          <Mail className="w-3 h-3" />
                          {c.guardianEmail}
                        </span>
                      )}
                      {(c.confirmationStatus === "pending" ||
                        c.confirmationStatus === "expired") && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="ml-auto font-bold rounded-full"
                          disabled={resending === c.id}
                          onClick={() => resendConfirmation(c)}
                          data-testid={`btn-resend-${c.id}`}
                        >
                          {resending === c.id
                            ? "Sending..."
                            : "Resend confirmation link"}
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {editingChild && (
        <EditProfileDialog
          user={editingChild}
          open={true}
          onOpenChange={(next) => {
            if (!next) setEditingChild(null);
          }}
          onSaved={() => {
            setEditingChild(null);
            void refresh();
          }}
        />
      )}

      {/* Link a new child */}
      <Card className="rounded-xl border-border">
        <CardContent className="p-6 space-y-4">
          <div className="flex items-center gap-2">
            <UserPlus className="w-4 h-4 text-primary" />
            <h2 className="font-black tracking-tight">Link a child</h2>
          </div>
          <p className="text-xs text-muted-foreground">
            Search for your child's athlete account by name. We'll attach it to
            your guardian profile.
          </p>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Type a child's name..."
              className="pl-9"
              data-testid="input-search-child"
            />
          </div>
          {query.trim().length >= 2 && (
            <div className="space-y-2">
              {searching ? (
                <Skeleton className="h-12 rounded-lg" />
              ) : results.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No matching athlete accounts found.
                </p>
              ) : (
                results.map((u) => {
                  const alreadyLinked = children.some((c) => c.id === u.id);
                  return (
                    <div
                      key={u.id}
                      className="flex items-center gap-3 p-3 rounded-lg border border-border"
                    >
                      <Avatar className="w-9 h-9 border border-border shrink-0">
                        {u.avatarUrl && <AvatarImage src={u.avatarUrl} />}
                        <AvatarFallback className="bg-slate-900 text-white font-bold text-xs">
                          {getInitials(`${u.firstName} ${u.lastName}`)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-sm truncate">
                          {u.firstName} {u.lastName}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">
                          {u.email ?? "No email"}
                        </p>
                      </div>
                      {alreadyLinked ? (
                        <Badge variant="outline" className="font-bold">
                          Linked
                        </Badge>
                      ) : (
                        <Button
                          size="sm"
                          className="font-bold rounded-full"
                          disabled={linking === u.id}
                          onClick={() => linkChild(u.id)}
                          data-testid={`btn-link-${u.id}`}
                        >
                          {linking === u.id ? "Linking..." : "Link"}
                        </Button>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
