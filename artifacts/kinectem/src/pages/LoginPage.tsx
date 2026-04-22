import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { getInitials } from "@/lib/format";
import { Loader2 } from "lucide-react";

interface DemoUser {
  id: string;
  firstName: string;
  lastName: string;
  role: string;
  email: string | null;
  avatarUrl: string | null;
  sport: string | null;
  position: string | null;
}

type Mode = "signin" | "signup";

export default function LoginPage() {
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const [mode, setMode] = useState<Mode>("signin");
  const [users, setUsers] = useState<DemoUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sign-up form
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [role, setRole] = useState<"athlete" | "coach" | "admin" | "parent">("athlete");
  const [email, setEmail] = useState("");
  const [dob, setDob] = useState("");

  useEffect(() => {
    customFetch<DemoUser[]>("/api/v1/auth/users")
      .then((rows) => setUsers(rows))
      .catch((e) => setError(e?.message ?? "Failed to load demo users"))
      .finally(() => setLoading(false));
  }, []);

  const signInAs = async (userId: string) => {
    setSubmitting(true);
    setError(null);
    try {
      await customFetch("/api/v1/auth/login", {
        method: "POST",
        body: JSON.stringify({ userId }),
      });
      await qc.invalidateQueries();
      setLocation("/");
    } catch (e) {
      setError((e as Error)?.message ?? "Login failed");
    } finally {
      setSubmitting(false);
    }
  };

  const signUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await customFetch("/api/v1/auth/signup", {
        method: "POST",
        body: JSON.stringify({
          firstName,
          lastName,
          role,
          email: email || null,
          dateOfBirth: dob || null,
        }),
      });
      await qc.invalidateQueries();
      setLocation("/");
    } catch (err) {
      setError((err as Error)?.message ?? "Sign-up failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-white to-blue-50 flex items-center justify-center p-6">
      <div className="w-full max-w-2xl">
        <div className="text-center mb-8">
          <h1 className="font-black text-4xl tracking-tight bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text text-transparent">
            Kinectem
          </h1>
          <p className="text-muted-foreground mt-1">Youth sports, by the people who play them.</p>
        </div>

        <Card className="rounded-xl shadow-lg border-border">
          <CardHeader className="border-b">
            <div className="flex gap-2">
              <Button
                type="button"
                variant={mode === "signin" ? "default" : "outline"}
                className="flex-1 font-bold rounded-lg"
                onClick={() => setMode("signin")}
              >
                Sign in
              </Button>
              <Button
                type="button"
                variant={mode === "signup" ? "default" : "outline"}
                className="flex-1 font-bold rounded-lg"
                onClick={() => setMode("signup")}
              >
                Create account
              </Button>
            </div>
          </CardHeader>

          <CardContent className="p-6">
            {error && (
              <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
                {error}
              </div>
            )}

            {mode === "signin" ? (
              <div>
                <CardTitle className="font-black text-lg mb-1">Continue as one of the demo users</CardTitle>
                <p className="text-sm text-muted-foreground mb-4">
                  Pick any account to explore the platform from that perspective.
                </p>
                {loading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin" /> Loading users...
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[420px] overflow-y-auto">
                    {users.map((u) => {
                      const name = `${u.firstName} ${u.lastName}`.trim();
                      return (
                        <button
                          key={u.id}
                          disabled={submitting}
                          onClick={() => signInAs(u.id)}
                          data-testid={`btn-signin-${u.id}`}
                          className="flex items-center gap-3 p-3 rounded-lg border border-border hover-elevate active-elevate-2 text-left disabled:opacity-50"
                        >
                          <Avatar className="w-10 h-10 border border-border shrink-0">
                            {u.avatarUrl && <AvatarImage src={u.avatarUrl} />}
                            <AvatarFallback className="bg-slate-900 text-white font-bold text-xs">
                              {getInitials(name)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0 flex-1">
                            <p className="font-bold text-sm truncate">{name}</p>
                            <p className="text-xs text-muted-foreground truncate capitalize">
                              {u.role}
                              {u.position ? ` • ${u.position}` : ""}
                            </p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : (
              <form onSubmit={signUp} className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="firstName">First name</Label>
                    <Input
                      id="firstName"
                      required
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label htmlFor="lastName">Last name</Label>
                    <Input
                      id="lastName"
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                    />
                  </div>
                </div>

                <div>
                  <Label htmlFor="role">I am a...</Label>
                  <Select value={role} onValueChange={(v) => setRole(v as typeof role)}>
                    <SelectTrigger id="role">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="athlete">Athlete</SelectItem>
                      <SelectItem value="coach">Coach</SelectItem>
                      <SelectItem value="parent">Parent / Guardian</SelectItem>
                      <SelectItem value="admin">Org admin</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label htmlFor="email">Email (optional)</Label>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>

                {role === "athlete" && (
                  <div>
                    <Label htmlFor="dob">Date of birth (required for under-13 gate)</Label>
                    <Input
                      id="dob"
                      type="date"
                      value={dob}
                      onChange={(e) => setDob(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Athletes under 13 will be prompted to link a parent or guardian account.
                    </p>
                  </div>
                )}

                <Button
                  type="submit"
                  disabled={submitting}
                  className="w-full font-bold rounded-lg"
                  data-testid="btn-create-account"
                >
                  {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Create account
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
