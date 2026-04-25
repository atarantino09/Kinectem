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
import { useToast } from "@/hooks/use-toast";

type AdminUser = {
  id: string;
  firstName: string;
  lastName: string;
  displayName: string;
  email: string | null;
  role: "athlete" | "parent" | "coach" | "admin";
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

const ROLES = ["athlete", "parent", "coach", "admin"] as const;
const PAGE_SIZE = 25;

export default function AdminUsers() {
  const [q, setQ] = useState("");
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [roleFilter, setRoleFilter] = useState<string>("");
  const [page, setPage] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<AdminUser | null>(null);
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

  return (
    <AdminLayout>
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <h1 className="text-2xl font-black">Users</h1>
        <Button onClick={() => setCreateOpen(true)} data-testid="btn-new-user">
          New user
        </Button>
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
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Created</TableHead>
            <TableHead>Last sign-in</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableRow>
              <TableCell colSpan={7} className="text-center py-6 text-muted-foreground">
                Loading…
              </TableCell>
            </TableRow>
          ) : (
            (data?.data ?? []).map((u) => (
              <TableRow key={u.id} data-testid={`row-user-${u.email ?? u.id}`}>
                <TableCell className="font-medium">{u.displayName}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{u.email}</TableCell>
                <TableCell>
                  <Select value={u.role} onValueChange={(v) => updateRole(u.id, v)}>
                    <SelectTrigger
                      className="h-8 w-32"
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
                <TableCell className="text-sm">
                  {new Date(u.createdAt).toLocaleDateString()}
                </TableCell>
                <TableCell className="text-sm">
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
                <TableCell className="text-right space-x-1">
                  {u.deletedAt ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => restore(u.id)}
                      data-testid={`btn-restore-${u.email}`}
                    >
                      Restore
                    </Button>
                  ) : (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setEditing(u)}
                        data-testid={`btn-edit-${u.email}`}
                      >
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => masquerade(u.id)}
                        data-testid={`btn-masquerade-${u.email}`}
                      >
                        View as
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => resetPassword(u.id)}
                      >
                        Reset PW
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => softDelete(u.id)}
                        data-testid={`btn-delete-${u.email}`}
                      >
                        Deactivate
                      </Button>
                    </>
                  )}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      <div className="flex items-center justify-between mt-4 text-sm text-muted-foreground">
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
      <EditUserDialog
        user={editing}
        onOpenChange={(v) => !v && setEditing(null)}
        onSaved={refetch}
      />
    </AdminLayout>
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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create user</DialogTitle>
          <DialogDescription>Manually provision an account.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
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
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit user</DialogTitle>
          <DialogDescription>
            Update profile, role, and guardian fields.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
          <div className="grid grid-cols-2 gap-3">
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
          <div className="grid grid-cols-2 gap-3">
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
