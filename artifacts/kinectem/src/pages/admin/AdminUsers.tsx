import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { customFetch } from "@workspace/api-client-react";
import { AdminLayout } from "@/components/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { MoreHorizontal } from "lucide-react";

type AdminUser = {
  id: string;
  firstName: string;
  lastName: string;
  displayName: string;
  email: string | null;
  role: "athlete" | "parent" | "coach" | "admin" | "fan";
  createdAt: string;
  lastSignInAt: string | null;
  deletedAt: string | null;
  avatarUrl: string | null;
  sport: string | null;
  position: string | null;
  jerseyNumber: number | null;
  grade: string | null;
  location: string | null;
  bio: string | null;
  dateOfBirth: string | null;
  parentId: string | null;
  guardianEmail: string | null;
  guardianConfirmedAt: string | null;
  requireTagConsent: boolean;
  organizations: { id: string; name: string }[];
};

type UsersResponse = {
  data: AdminUser[];
  pagination: {
    nextCursor: string | null;
    hasMore: boolean;
    totalCount: number;
    limit: number;
    offset: number;
  };
};

const ROLES = ["athlete", "parent", "coach", "admin", "fan"] as const;
const PAGE_SIZE = 25;

export default function AdminUsers() {
  const [q, setQ] = useState("");
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [roleFilter, setRoleFilter] = useState<string>("");
  const [page, setPage] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [assigning, setAssigning] = useState<AdminUser | null>(null);
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [permDeleting, setPermDeleting] = useState<AdminUser | null>(null);
  const qc = useQueryClient();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (includeDeleted) params.set("includeDeleted", "1");
  if (roleFilter) params.set("role", roleFilter);
  params.set("limit", String(PAGE_SIZE));
  params.set("offset", String(page * PAGE_SIZE));

  const { data, isLoading } = useQuery<UsersResponse>({
    queryKey: ["admin", "users", q, includeDeleted, roleFilter, page],
    queryFn: () =>
      customFetch<UsersResponse>(`/api/v1/admin/users?${params}`, {
        method: "GET",
      }),
  });

  const refetch = () => qc.invalidateQueries({ queryKey: ["admin", "users"] });

  const updateRole = async (id: string, role: string) => {
    try {
      await customFetch(`/api/v1/admin/users/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role }),
      });
      toast({ title: "Role updated" });
      refetch();
    } catch (err) {
      toast({ title: "Update failed", description: (err as Error).message, variant: "destructive" });
    }
  };

  const softDelete = async (id: string) => {
    if (!confirm("Deactivate this user? They will not be able to sign in.")) return;
    try {
      await customFetch(`/api/v1/admin/users/${id}`, { method: "DELETE" });
      toast({ title: "User deactivated" });
      refetch();
    } catch (err) {
      toast({ title: "Failed", description: (err as Error).message, variant: "destructive" });
    }
  };

  const restore = async (id: string) => {
    try {
      await customFetch(`/api/v1/admin/users/${id}/restore`, { method: "POST" });
      toast({ title: "User restored" });
      refetch();
    } catch (err) {
      toast({ title: "Failed", description: (err as Error).message, variant: "destructive" });
    }
  };

  const resetPassword = async (id: string) => {
    if (!confirm("Reset this user's password? Their existing sessions will be revoked.")) return;
    try {
      const result = await customFetch<{ tempPassword: string }>(
        `/api/v1/admin/users/${id}/reset-password`,
        { method: "POST" },
      );
      toast({
        title: "Password reset",
        description: `Temporary password: ${result.tempPassword}`,
      });
    } catch (err) {
      toast({ title: "Failed", description: (err as Error).message, variant: "destructive" });
    }
  };

  const masquerade = async (id: string) => {
    try {
      await customFetch(`/api/v1/admin/masquerade/${id}/start`, { method: "POST" });
      toast({ title: "Now viewing as that user" });
      await qc.invalidateQueries();
      setLocation("/");
    } catch (err) {
      toast({ title: "Failed", description: (err as Error).message, variant: "destructive" });
    }
  };

  const totalCount = data?.pagination.totalCount ?? 0;
  const showingFrom = totalCount === 0 ? 0 : page * PAGE_SIZE + 1;
  const showingTo = Math.min(totalCount, page * PAGE_SIZE + (data?.data.length ?? 0));
  const organizationNames = (u: AdminUser) => u.organizations.map((org) => org.name).join(", ") || "—";

  const userActions = (u: AdminUser) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          aria-label={`Actions for ${u.displayName}`}
          data-testid={`btn-user-actions-${u.email ?? u.id}`}
        >
          Actions <MoreHorizontal className="ml-1 h-4 w-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {u.deletedAt ? (
          <>
            <DropdownMenuItem onSelect={() => void restore(u.id)} data-testid={`btn-restore-${u.email}`}>
              Restore
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setPermDeleting(u)} className="text-destructive focus:text-destructive" data-testid={`btn-permanent-delete-${u.email}`}>
              Permanently delete
            </DropdownMenuItem>
          </>
        ) : (
          <>
            <DropdownMenuItem onSelect={() => setEditing(u)} data-testid={`btn-edit-${u.email}`}>
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setAssigning(u)} data-testid={`btn-assign-${u.email}`}>
              Assign
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void masquerade(u.id)} data-testid={`btn-masquerade-${u.email}`}>
              View as
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void resetPassword(u.id)}>
              Reset PW
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void softDelete(u.id)} className="text-destructive focus:text-destructive" data-testid={`btn-delete-${u.email}`}>
              Deactivate
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <AdminLayout>
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <h1 className="text-2xl font-black">Users</h1>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => setInviteOpen(true)}
            data-testid="btn-invite-user"
          >
            Invite user
          </Button>
          <Button onClick={() => setCreateOpen(true)} data-testid="btn-new-user">
            New user
          </Button>
        </div>
      </div>
      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <Input
          placeholder="Search by name or email..."
          value={q}
          onChange={(e) => {
            setPage(0);
            setQ(e.target.value);
          }}
          className="max-w-xs"
          data-testid="input-user-search"
        />
        <Select
          value={roleFilter || "all"}
          onValueChange={(v) => {
            setPage(0);
            setRoleFilter(v === "all" ? "" : v);
          }}
        >
          <SelectTrigger className="w-36" data-testid="select-role-filter">
            <SelectValue placeholder="All roles" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All roles</SelectItem>
            {ROLES.map((r) => (
              <SelectItem key={r} value={r}>
                {r}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <label className="flex items-center gap-2 text-sm">
          <Switch
            checked={includeDeleted}
            onCheckedChange={(v) => {
              setPage(0);
              setIncludeDeleted(v);
            }}
            data-testid="switch-include-deleted"
          />
          Include deactivated
        </label>
      </div>
      <div className="space-y-3 lg:hidden" data-testid="admin-users-mobile-list">
        {isLoading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
        ) : (data?.data ?? []).length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No users found.</p>
        ) : (data?.data ?? []).map((u) => (
          <article
            key={u.id}
            className="min-w-0 rounded-xl border bg-card p-4 shadow-sm"
            data-testid={`card-user-${u.email ?? u.id}`}
          >
            <div className="flex min-w-0 items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="break-words font-semibold leading-snug [overflow-wrap:anywhere]">{u.displayName}</h2>
                <p className="mt-1 break-all text-sm text-muted-foreground">{u.email ?? "No email address"}</p>
              </div>
              <div className="shrink-0">
                {u.deletedAt ? <Badge variant="destructive">Deactivated</Badge> : <Badge variant="secondary">Active</Badge>}
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-end justify-between gap-3 border-t pt-3">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground" htmlFor={`mobile-role-${u.id}`}>Role</Label>
                <Select value={u.role} onValueChange={(v) => updateRole(u.id, v)}>
                  <SelectTrigger id={`mobile-role-${u.id}`} className="h-10 w-32" data-testid={`select-mobile-role-${u.email}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {userActions(u)}
            </div>
            <p className="mt-3 break-words text-sm [overflow-wrap:anywhere]">
              <span className="font-medium text-muted-foreground">Organizations: </span>
              {organizationNames(u)}
            </p>
            <p className="mt-3 text-xs text-muted-foreground">
              Created {new Date(u.createdAt).toLocaleDateString()}
              <span className="mx-2" aria-hidden="true">·</span>
              Last sign-in {u.lastSignInAt ? new Date(u.lastSignInAt).toLocaleDateString() : "—"}
            </p>
          </article>
        ))}
      </div>
      <div className="hidden lg:block overflow-x-auto" data-testid="admin-users-table">
      <Table className="min-w-[830px] xl:min-w-[1080px]">
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Organizations</TableHead>
            <TableHead className="hidden xl:table-cell">Created</TableHead>
            <TableHead className="hidden xl:table-cell">Last sign-in</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="sticky right-0 z-10 bg-background text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableRow>
              <TableCell colSpan={8} className="text-center py-6 text-muted-foreground">
                Loading…
              </TableCell>
            </TableRow>
          ) : (
            (data?.data ?? []).map((u) => (
              <TableRow key={u.id} data-testid={`row-user-${u.email ?? u.id}`}>
                <TableCell className="max-w-32 truncate font-medium" title={u.displayName}>{u.displayName}</TableCell>
                <TableCell className="max-w-48 truncate text-sm text-muted-foreground" title={u.email ?? undefined}>{u.email}</TableCell>
                <TableCell>
                  <Select value={u.role} onValueChange={(v) => updateRole(u.id, v)}>
                    <SelectTrigger
                      className="h-8 w-28"
                      data-testid={`select-role-${u.email}`}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ROLES.map((r) => (
                        <SelectItem key={r} value={r}>
                          {r}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell className="max-w-44 text-sm">
                  <span className="block truncate" title={organizationNames(u)}>
                    {organizationNames(u)}
                  </span>
                </TableCell>
                <TableCell className="hidden text-sm xl:table-cell">
                  {new Date(u.createdAt).toLocaleDateString()}
                </TableCell>
                <TableCell className="hidden text-sm xl:table-cell">
                  {u.lastSignInAt
                    ? new Date(u.lastSignInAt).toLocaleDateString()
                    : "—"}
                </TableCell>
                <TableCell>
                  {u.deletedAt ? (
                    <Badge variant="destructive">Deactivated</Badge>
                  ) : (
                    <Badge variant="secondary">Active</Badge>
                  )}
                </TableCell>
                <TableCell className="sticky right-0 z-10 bg-background text-right">{userActions(u)}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 mt-4 text-sm text-muted-foreground">
        <div data-testid="users-pagination-info">
          Showing {showingFrom}–{showingTo} of {totalCount}
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            data-testid="btn-prev-page"
          >
            Previous
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!data?.pagination.hasMore}
            onClick={() => setPage((p) => p + 1)}
            data-testid="btn-next-page"
          >
            Next
          </Button>
        </div>
      </div>
      <CreateUserDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={refetch}
      />
      <InviteUserDialog open={inviteOpen} onOpenChange={setInviteOpen} />
      <AssignUserDialog
        user={assigning}
        onOpenChange={(v) => !v && setAssigning(null)}
        onAssigned={refetch}
      />
      <EditUserDialog
        user={editing}
        onOpenChange={(v) => !v && setEditing(null)}
        onSaved={refetch}
      />
      <PermanentDeleteDialog
        user={permDeleting}
        onOpenChange={(v) => !v && setPermDeleting(null)}
        onDeleted={refetch}
      />
    </AdminLayout>
  );
}

function PermanentDeleteDialog({
  user,
  onOpenChange,
  onDeleted,
}: {
  user: AdminUser | null;
  onOpenChange: (v: boolean) => void;
  onDeleted: () => void;
}) {
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    setConfirm("");
  }, [user]);

  const expectedName = (user?.displayName ?? "").trim();
  const expectedEmail = (user?.email ?? "").trim();
  const normalized = confirm.trim().replace(/\s+/g, " ").toLowerCase();
  const matches =
    (expectedName.length > 0 && normalized === expectedName.replace(/\s+/g, " ").toLowerCase()) ||
    (expectedEmail.length > 0 && normalized === expectedEmail.toLowerCase());

  const submit = async () => {
    if (!user || !matches) return;
    setSubmitting(true);
    try {
      await customFetch(`/api/v1/admin/users/${user.id}/permanent`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirm }),
      });
      toast({ title: "Account permanently deleted", description: "Its email is now free to reuse." });
      onOpenChange(false);
      onDeleted();
    } catch (err) {
      toast({ title: "Failed", description: (err as Error).message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={!!user} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Permanently delete account</DialogTitle>
          <DialogDescription>
            This cannot be undone. It removes the account and all of its content
            from the database, freeing the email for a brand-new signup.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="text-sm text-muted-foreground">
            Type the account's exact name{" "}
            <span className="font-semibold text-foreground">{expectedName}</span>
            {expectedEmail ? (
              <>
                {" "}or email{" "}
                <span className="font-semibold text-foreground">{expectedEmail}</span>
              </>
            ) : null}{" "}
            to confirm.
          </div>
          <Input
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder={expectedEmail || expectedName}
            data-testid="input-permanent-delete-confirm"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={submit}
            disabled={!matches || submitting}
            data-testid="btn-confirm-permanent-delete"
          >
            {submitting ? "Deleting…" : "Permanently delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreateUserDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: () => void;
}) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<(typeof ROLES)[number]>("athlete");
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();

  const submit = async () => {
    setSubmitting(true);
    try {
      await customFetch("/api/v1/admin/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ firstName, lastName, email, password, role }),
      });
      toast({ title: "User created" });
      onOpenChange(false);
      setFirstName("");
      setLastName("");
      setEmail("");
      setPassword("");
      setRole("athlete");
      onCreated();
    } catch (err) {
      toast({ title: "Failed", description: (err as Error).message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create user</DialogTitle>
          <DialogDescription>Manually provision an account.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label>First name</Label>
              <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} data-testid="input-create-firstname" />
            </div>
            <div>
              <Label>Last name</Label>
              <Input value={lastName} onChange={(e) => setLastName(e.target.value)} data-testid="input-create-lastname" />
            </div>
          </div>
          <div>
            <Label>Email</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="input-create-email" />
          </div>
          <div>
            <Label>Password (min 8 chars)</Label>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} data-testid="input-create-password" />
          </div>
          <div>
            <Label>Role</Label>
            <Select value={role} onValueChange={(v) => setRole(v as (typeof ROLES)[number])}>
              <SelectTrigger data-testid="select-create-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting} data-testid="btn-submit-create-user">
            {submitting ? "Creating…" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditUserDialog({
  user,
  onOpenChange,
  onSaved,
}: {
  user: AdminUser | null;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
}) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<(typeof ROLES)[number]>("athlete");
  const [bio, setBio] = useState("");
  const [sport, setSport] = useState("");
  const [position, setPosition] = useState("");
  const [jerseyNumber, setJerseyNumber] = useState<string>("");
  const [grade, setGrade] = useState("");
  const [location, setLocation] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [guardianEmail, setGuardianEmail] = useState("");
  const [requireTagConsent, setRequireTagConsent] = useState(false);
  const [clearGuardianConfirmation, setClearGuardianConfirmation] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();

  // Populate when user changes (open).
  useEffect(() => {
    if (!user) return;
    setFirstName(user.firstName);
    setLastName(user.lastName);
    setEmail(user.email ?? "");
    setRole(user.role);
    setBio(user.bio ?? "");
    setSport(user.sport ?? "");
    setPosition(user.position ?? "");
    setJerseyNumber(user.jerseyNumber == null ? "" : String(user.jerseyNumber));
    setGrade(user.grade ?? "");
    setLocation(user.location ?? "");
    setDateOfBirth(user.dateOfBirth ? user.dateOfBirth.slice(0, 10) : "");
    setGuardianEmail(user.guardianEmail ?? "");
    setRequireTagConsent(user.requireTagConsent);
    setClearGuardianConfirmation(false);
  }, [user]);

  const reset = () => {
    setFirstName("");
    setLastName("");
    setEmail("");
    setBio("");
    setSport("");
    setPosition("");
    setJerseyNumber("");
    setGrade("");
    setLocation("");
    setDateOfBirth("");
    setGuardianEmail("");
    setRequireTagConsent(false);
    setClearGuardianConfirmation(false);
  };

  const submit = async () => {
    if (!user) return;
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        firstName,
        lastName,
        email,
        role,
        bio: bio || null,
        sport: sport || null,
        position: position || null,
        jerseyNumber: jerseyNumber === "" ? null : Number(jerseyNumber),
        grade: grade || null,
        location: location || null,
        dateOfBirth: dateOfBirth || null,
        guardianEmail: guardianEmail || null,
        requireTagConsent,
      };
      if (clearGuardianConfirmation) body["clearGuardianConfirmation"] = true;
      await customFetch(`/api/v1/admin/users/${user.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      toast({ title: "User updated" });
      reset();
      onOpenChange(false);
      onSaved();
    } catch (err) {
      toast({ title: "Failed", description: (err as Error).message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={!!user}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit user</DialogTitle>
          <DialogDescription>
            Update profile, role, and guardian fields.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label>First name</Label>
              <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} data-testid="input-edit-firstname" />
            </div>
            <div>
              <Label>Last name</Label>
              <Input value={lastName} onChange={(e) => setLastName(e.target.value)} data-testid="input-edit-lastname" />
            </div>
          </div>
          <div>
            <Label>Email</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="input-edit-email" />
          </div>
          <div>
            <Label>Role</Label>
            <Select value={role} onValueChange={(v) => setRole(v as (typeof ROLES)[number])}>
              <SelectTrigger data-testid="select-edit-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label>Sport</Label>
              <Input value={sport} onChange={(e) => setSport(e.target.value)} />
            </div>
            <div>
              <Label>Position</Label>
              <Input value={position} onChange={(e) => setPosition(e.target.value)} />
            </div>
            <div>
              <Label>Jersey #</Label>
              <Input
                type="number"
                value={jerseyNumber}
                onChange={(e) => setJerseyNumber(e.target.value)}
              />
            </div>
            <div>
              <Label>Grade</Label>
              <Input value={grade} onChange={(e) => setGrade(e.target.value)} />
            </div>
            <div>
              <Label>Location</Label>
              <Input value={location} onChange={(e) => setLocation(e.target.value)} />
            </div>
            <div>
              <Label>Date of birth</Label>
              <Input
                type="date"
                value={dateOfBirth}
                onChange={(e) => setDateOfBirth(e.target.value)}
              />
            </div>
          </div>
          <div>
            <Label>Bio</Label>
            <Textarea value={bio} onChange={(e) => setBio(e.target.value)} rows={3} />
          </div>
          <div className="border rounded p-3 space-y-3">
            <div className="text-sm font-bold">Guardian</div>
            <div>
              <Label>Guardian email</Label>
              <Input
                type="email"
                value={guardianEmail}
                onChange={(e) => setGuardianEmail(e.target.value)}
                data-testid="input-edit-guardian-email"
              />
              {user?.guardianConfirmedAt && (
                <div className="text-xs text-muted-foreground mt-1">
                  Confirmed {new Date(user.guardianConfirmedAt).toLocaleDateString()}
                </div>
              )}
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={requireTagConsent}
                onCheckedChange={setRequireTagConsent}
              />
              Require guardian consent for tags
            </label>
            {user?.guardianConfirmedAt && (
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  checked={clearGuardianConfirmation}
                  onCheckedChange={setClearGuardianConfirmation}
                  data-testid="switch-clear-guardian-confirmation"
                />
                Clear current guardian confirmation
              </label>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              reset();
              onOpenChange(false);
            }}
          >
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting} data-testid="btn-submit-edit-user">
            {submitting ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Platform-admin org/team pickers + assign & invite dialogs.
// ---------------------------------------------------------------------------

type AdminOrgRow = { organizationId: string; organizationName: string };
type AdminTeamRow = {
  id: string;
  name: string;
  sport: string | null;
  organizationId: string | null;
  organizationName: string | null;
};

function useAdminOrgs(enabled: boolean) {
  return useQuery<{ data: AdminOrgRow[] }>({
    queryKey: ["admin", "organizations"],
    queryFn: () =>
      customFetch<{ data: AdminOrgRow[] }>("/api/v1/admin/organizations", {
        method: "GET",
      }),
    enabled,
  });
}

function useAdminTeams(enabled: boolean) {
  return useQuery<{ data: AdminTeamRow[] }>({
    queryKey: ["admin", "teams"],
    queryFn: () =>
      customFetch<{ data: AdminTeamRow[] }>("/api/v1/admin/teams", {
        method: "GET",
      }),
    enabled,
  });
}

function teamLabel(t: AdminTeamRow): string {
  return t.organizationName ? `${t.name} — ${t.organizationName}` : t.name;
}

function AssignUserDialog({
  user,
  onOpenChange,
  onAssigned,
}: {
  user: AdminUser | null;
  onOpenChange: (v: boolean) => void;
  onAssigned: () => void;
}) {
  const open = !!user;
  const [target, setTarget] = useState<"org" | "team">("org");
  const [orgId, setOrgId] = useState("");
  const [orgRole, setOrgRole] = useState<"admin" | "member">("member");
  const [teamId, setTeamId] = useState("");
  const [position, setPosition] = useState<"player" | "coach">("player");
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();
  const orgs = useAdminOrgs(open);
  const teams = useAdminTeams(open);

  useEffect(() => {
    setTarget("org");
    setOrgId("");
    setOrgRole("member");
    setTeamId("");
    setPosition("player");
  }, [user]);

  const canSubmit = target === "org" ? !!orgId : !!teamId;

  const submit = async () => {
    if (!user || !canSubmit) return;
    setSubmitting(true);
    try {
      if (target === "org") {
        await customFetch(`/api/v1/organizations/${orgId}/members`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ userId: user.id, role: orgRole }),
        });
        toast({
          title: "Assigned to organization",
          description: `${user.displayName} is now a ${orgRole}.`,
        });
      } else {
        const result = await customFetch<{ outcome?: "already_active" | "auto_approved" | "invited" }>(
          `/api/v1/teams/${teamId}/members`,
          {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ userId: user.id, position }),
          },
        );
        toast(
          result.outcome === "auto_approved"
            ? {
                title: "Added to team",
                description:
                  "Your team assignment is already approved because you’re an organization admin. You don’t need to accept an invitation.",
              }
            : result.outcome === "already_active"
              ? {
                  title: "Already on team",
                  description: `${user.displayName} is already an active member of this team.`,
                }
              : {
                  title: "Added to team",
                  description: `${user.displayName} was added as a ${position} (pending until they accept).`,
                },
        );
      }
      onAssigned();
      onOpenChange(false);
    } catch (err) {
      toast({
        title: "Assignment failed",
        description: (err as Error).message,
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto" data-testid="dialog-assign-user">
        <DialogHeader>
          <DialogTitle>Assign {user?.displayName ?? "user"}</DialogTitle>
          <DialogDescription>
            Add this user to an organization or a team.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Assign to</Label>
            <Select
              value={target}
              onValueChange={(v) => setTarget(v as "org" | "team")}
            >
              <SelectTrigger data-testid="select-assign-target">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="org">Organization</SelectItem>
                <SelectItem value="team">Team</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {target === "org" ? (
            <>
              <div className="space-y-2">
                <Label>Organization</Label>
                <Select value={orgId} onValueChange={setOrgId}>
                  <SelectTrigger data-testid="select-assign-org">
                    <SelectValue placeholder="Choose an organization" />
                  </SelectTrigger>
                  <SelectContent>
                    {(orgs.data?.data ?? []).map((o) => (
                      <SelectItem key={o.organizationId} value={o.organizationId}>
                        {o.organizationName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Role</Label>
                <Select
                  value={orgRole}
                  onValueChange={(v) => setOrgRole(v as "admin" | "member")}
                >
                  <SelectTrigger data-testid="select-assign-org-role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="member">Member</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </>
          ) : (
            <>
              <div className="space-y-2">
                <Label>Team</Label>
                <Select value={teamId} onValueChange={setTeamId}>
                  <SelectTrigger data-testid="select-assign-team">
                    <SelectValue placeholder="Choose a team" />
                  </SelectTrigger>
                  <SelectContent>
                    {(teams.data?.data ?? []).map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {teamLabel(t)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Position</Label>
                <Select
                  value={position}
                  onValueChange={(v) => setPosition(v as "player" | "coach")}
                >
                  <SelectTrigger data-testid="select-assign-position">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="player">Player</SelectItem>
                    <SelectItem value="coach">Coach</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={!canSubmit || submitting}
            data-testid="btn-assign-submit"
          >
            {submitting ? "Assigning…" : "Assign"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function InviteUserDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [target, setTarget] = useState<"org" | "team">("org");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [orgId, setOrgId] = useState("");
  const [orgRole, setOrgRole] = useState<"admin" | "member">("member");
  const [teamId, setTeamId] = useState("");
  const [position, setPosition] = useState<"player" | "coach">("player");
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();
  const orgs = useAdminOrgs(open);
  const teams = useAdminTeams(open);

  useEffect(() => {
    if (open) return;
    setTarget("org");
    setEmail("");
    setName("");
    setOrgId("");
    setOrgRole("member");
    setTeamId("");
    setPosition("player");
  }, [open]);

  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const canSubmit = emailOk && (target === "org" ? !!orgId : !!teamId);

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      if (target === "org") {
        const r = await customFetch<{
          emailSent?: boolean;
          outcome?: "already_active" | "auto_approved" | "already_pending" | "invited";
        }>(
          `/api/v1/organizations/${orgId}/invites`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ email: email.trim(), role: orgRole }),
          },
        );
        toast(
          r?.outcome === "auto_approved"
            ? {
                title: "Assignment approved",
                description:
                  "Your team assignment is already approved because you’re an organization admin. You don’t need to accept an invitation.",
              }
            : r?.outcome === "already_active"
              ? { title: "Already a member", description: `${email.trim()} is already active. No invitation was sent.` }
              : r?.outcome === "already_pending"
                ? { title: "Invitation already pending", description: `A pending invitation already exists for ${email.trim()}. No new invitation was sent.` }
              : {
                  title: "Invite created",
                  description:
                    r?.emailSent === false
                      ? "Invite saved, but the email could not be sent. Manage it from the organization page."
                      : `Invite email sent to ${email.trim()}.`,
                },
        );
      } else {
        const r = await customFetch<{
          emailSent?: boolean | null;
          outcome?: "already_active" | "auto_approved" | "already_pending" | "invited";
        }>(
          `/api/v1/teams/${teamId}/invites`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              email: email.trim(),
              name: name.trim() || undefined,
              position,
            }),
          },
        );
        toast(
          r?.outcome === "auto_approved"
            ? {
                title: "Assignment approved",
                description:
                  "Your team assignment is already approved because you’re an organization admin. You don’t need to accept an invitation.",
              }
            : r?.outcome === "already_active"
              ? { title: "Already on team", description: `${email.trim()} is already active on this team. No invitation was sent.` }
              : r?.outcome === "already_pending"
                ? { title: "Invitation already pending", description: `A pending invitation already exists for ${email.trim()}. No new invitation was sent.` }
              : {
                  title: "Invite created",
                  description:
                    r?.emailSent === false
                      ? "Invite saved, but the email could not be sent. Manage it from the team roster."
                      : `Invite sent to ${email.trim()}.`,
                },
        );
      }
      onOpenChange(false);
    } catch (err) {
      toast({
        title: "Invite failed",
        description: (err as Error).message,
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto" data-testid="dialog-invite-user">
        <DialogHeader>
          <DialogTitle>Invite a user</DialogTitle>
          <DialogDescription>
            Send an email invite to join an organization or a team. Works for
            people who don't have an account yet.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Email</Label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="person@example.com"
              data-testid="input-invite-email"
            />
          </div>
          <div className="space-y-2">
            <Label>Invite to</Label>
            <Select
              value={target}
              onValueChange={(v) => setTarget(v as "org" | "team")}
            >
              <SelectTrigger data-testid="select-invite-target">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="org">Organization</SelectItem>
                <SelectItem value="team">Team</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {target === "org" ? (
            <>
              <div className="space-y-2">
                <Label>Organization</Label>
                <Select value={orgId} onValueChange={setOrgId}>
                  <SelectTrigger data-testid="select-invite-org">
                    <SelectValue placeholder="Choose an organization" />
                  </SelectTrigger>
                  <SelectContent>
                    {(orgs.data?.data ?? []).map((o) => (
                      <SelectItem key={o.organizationId} value={o.organizationId}>
                        {o.organizationName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Role</Label>
                <Select
                  value={orgRole}
                  onValueChange={(v) => setOrgRole(v as "admin" | "member")}
                >
                  <SelectTrigger data-testid="select-invite-org-role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="member">Member</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </>
          ) : (
            <>
              <div className="space-y-2">
                <Label>Team</Label>
                <Select value={teamId} onValueChange={setTeamId}>
                  <SelectTrigger data-testid="select-invite-team">
                    <SelectValue placeholder="Choose a team" />
                  </SelectTrigger>
                  <SelectContent>
                    {(teams.data?.data ?? []).map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {teamLabel(t)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Invitee name (optional)</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Jordan Smith"
                  data-testid="input-invite-name"
                />
              </div>
              <div className="space-y-2">
                <Label>Position</Label>
                <Select
                  value={position}
                  onValueChange={(v) => setPosition(v as "player" | "coach")}
                >
                  <SelectTrigger data-testid="select-invite-position">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="player">Player</SelectItem>
                    <SelectItem value="coach">Coach</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={!canSubmit || submitting}
            data-testid="btn-invite-submit"
          >
            {submitting ? "Sending…" : "Send invite"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
