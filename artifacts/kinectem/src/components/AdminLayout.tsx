import { Link, useLocation } from "wouter";
import {
  BarChart3,
  Users,
  ShieldAlert,
  History,
  Bot,
  Mail,
  Eye,
  Link2,
  Tag,
  Building2,
  CalendarDays,
  Megaphone,
  Trophy,
  CalendarClock,
  ArrowLeft,
  ChevronDown,
  Lock,
  ClipboardCheck,
  FileText,
  Handshake,
} from "lucide-react";
import { useWhoami } from "@/hooks/useWhoami";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

// Founding 100 is intentionally absent: its in-app destination is retired,
// while the separate /api/founding-admin manager is preserved.
const NAV = [
  { href: "/admin", label: "Dashboard", icon: BarChart3 },
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/posts", label: "Posts", icon: FileText },
  { href: "/admin/moderation", label: "Moderation", icon: ShieldAlert },
  { href: "/admin/activity", label: "Activity log", icon: History },
  {
    href: "/admin/competition-claim-links",
    label: "Competition links",
    icon: Link2,
  },
  { href: "/admin/claims", label: "Claims", icon: ClipboardCheck },
  { href: "/admin/ai-keys", label: "AI Assist", icon: Bot },
  { href: "/admin/email", label: "Email", icon: Mail },
  { href: "/admin/email-preview", label: "Email preview", icon: Eye },
  { href: "/admin/daily-digest", label: "Daily digest", icon: CalendarClock },
  { href: "/admin/promo-codes", label: "Promo codes", icon: Tag },
  { href: "/admin/organizations", label: "Organizations", icon: Building2 },
  {
    href: "/admin/organizations?section=partner",
    label: "Partner landing page",
    icon: Handshake,
    testId: "partner-landing",
  },
  { href: "/admin/schedule", label: "Schedule", icon: CalendarDays },
  { href: "/admin/tournaments", label: "Tournaments", icon: Trophy },
  { href: "/admin/announcements", label: "Announcements", icon: Megaphone },
];

export function AdminLayout({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();
  const [navOpen, setNavOpen] = useState(false);
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
    <div
      className="grid grid-cols-1 md:grid-cols-[220px_minmax(0,1fr)] gap-6"
      data-testid="admin-layout"
    >
      <aside className="min-w-0 self-start space-y-1 md:sticky md:top-20">
        <button
          type="button"
          className="flex min-h-11 w-full items-center justify-between rounded-lg border bg-card px-4 py-2 text-left text-sm font-semibold md:hidden"
          aria-expanded={navOpen}
          aria-controls="admin-sections"
          onClick={() => setNavOpen((open) => !open)}
          data-testid="admin-mobile-sections"
        >
          <span>Admin · {location.startsWith("/admin/organizations") && new URLSearchParams(window.location.search).get("section") === "partner"
            ? "Partner landing page"
            : NAV.find((item) => item.href === location)?.label ?? "Sections"}</span>
          <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${navOpen ? "rotate-180" : ""}`} aria-hidden="true" />
        </button>
        <div
          id="admin-sections"
          className={`${navOpen ? "block" : "hidden"} max-h-[60vh] space-y-1 overflow-y-auto rounded-lg border bg-card p-2 md:block md:max-h-none md:overflow-visible md:rounded-none md:border-0 md:bg-transparent md:p-0`}
        >
        <Link
          href="/"
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-4"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Kinectem
        </Link>
        <div className="text-xs uppercase tracking-wide font-bold text-muted-foreground px-3 py-2">
          Admin
        </div>
        {NAV.map((item) => {
          const partnerSectionActive =
            location.startsWith("/admin/organizations") &&
            new URLSearchParams(window.location.search).get("section") ===
              "partner";
          const active =
            item.href === "/admin"
              ? location === "/admin" || location === "/admin/"
              : item.href === "/admin/email"
                ? location === item.href
              : item.href === "/admin/organizations?section=partner"
                ? partnerSectionActive
              : item.href === "/admin/organizations"
                ? (!partnerSectionActive && location.startsWith(item.href)) ||
                  location === "/admin/org-quick-setup" ||
                  location === "/admin/org-claim-links"
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
              onClick={() => setNavOpen(false)}
              data-testid={`admin-nav-${item.testId ?? item.href.split("/").pop() ?? "dashboard"}`}
            >
              <Icon className="w-4 h-4" /> {item.label}
            </Link>
          );
        })}
        </div>
      </aside>
      <section className="min-w-0">{children}</section>
    </div>
  );
}
