import { Link, useLocation } from "wouter";
import {
  BarChart3,
  Users,
  ShieldAlert,
  History,
  ArrowLeft,
  Lock,
} from "lucide-react";
import { useWhoami } from "@/hooks/useWhoami";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const NAV = [
  { href: "/admin", label: "Dashboard", icon: BarChart3 },
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/moderation", label: "Moderation", icon: ShieldAlert },
  { href: "/admin/activity", label: "Activity log", icon: History },
];

export function AdminLayout({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();
  const { data: who, isLoading } = useWhoami();

  useEffect(() => {
    if (isLoading) return;
    if (!who?.authenticated) {
      setLocation("/login");
    }
  }, [who, isLoading, setLocation]);

  if (isLoading || !who) {
    return (
      <div className="p-8 text-muted-foreground" data-testid="admin-loading">
        Loading admin console…
      </div>
    );
  }

  if (!who.authenticated) {
    return (
      <div className="p-8 text-muted-foreground" data-testid="admin-loading">
        Redirecting to sign in…
      </div>
    );
  }

  if (who.realUser?.role !== "admin") {
    return (
      <div className="max-w-lg mx-auto py-12" data-testid="admin-forbidden">
        <Card>
          <CardContent className="p-8 text-center space-y-4">
            <div className="mx-auto w-12 h-12 rounded-full bg-muted flex items-center justify-center">
              <Lock className="w-6 h-6 text-muted-foreground" />
            </div>
            <h1 className="text-2xl font-black tracking-tight">
              Admin access required
            </h1>
            <p className="text-sm text-muted-foreground">
              This area is only available to platform administrators. If you
              think you should have access, contact your Kinectem admin.
            </p>
            <Link href="/">
              <Button data-testid="btn-admin-back-feed">Back to feed</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-6" data-testid="admin-layout">
      <aside className="md:sticky md:top-20 self-start space-y-1">
        <Link href="/" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-4">
          <ArrowLeft className="w-4 h-4" /> Back to Kinectem
        </Link>
        <div className="text-xs uppercase tracking-wide font-bold text-muted-foreground px-3 py-2">
          Admin
        </div>
        {NAV.map((item) => {
          const active =
            item.href === "/admin"
              ? location === "/admin" || location === "/admin/"
              : location.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm font-semibold ${
                active
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-muted text-foreground"
              }`}
              data-testid={`admin-nav-${item.href.split("/").pop() || "dashboard"}`}
            >
              <Icon className="w-4 h-4" /> {item.label}
            </Link>
          );
        })}
      </aside>
      <section className="min-w-0">{children}</section>
    </div>
  );
}
