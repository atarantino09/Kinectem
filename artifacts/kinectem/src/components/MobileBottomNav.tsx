import { Link, useLocation, useSearch } from "wouter";
import { useState } from "react";
import { Home, Building2, Plus, UsersRound, User } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CreateMenuItems } from "@/components/CreateMenuItems";
import { CreateOrgDialog } from "@/components/CreateOrgDialog";
import { cn } from "@/lib/utils";

type Props = {
  meId: string | undefined;
  canAuthorRecap: boolean;
};

export function MobileBottomNav({ meId, canAuthorRecap }: Props) {
  const [location, setLocation] = useLocation();
  const search = useSearch();
  const [createOrgOpen, setCreateOrgOpen] = useState(false);

  const isActive = (path: string, exact = false) => {
    if (exact) return location === path;
    return location === path || location.startsWith(`${path}/`);
  };

  const profileHref = meId ? `/users/${meId}` : "/login";
  const teamsHref = meId ? `/users/${meId}?tab=teams` : "/login";
  const homeActive = isActive("/", true);
  const orgsActive = isActive("/organizations");
  const onOwnProfile = meId ? location.startsWith(`/users/${meId}`) : false;
  const tabIsTeams = new URLSearchParams(search).get("tab") === "teams";
  const teamsActive = onOwnProfile && tabIsTeams;
  // "Profile" is active for any /users/:meId view EXCEPT when the Teams tab
  // is selected — that case belongs to the Teams entry instead.
  const profileActive = onOwnProfile && !tabIsTeams;

  const Item = ({
    href,
    label,
    Icon,
    active,
    testId,
  }: {
    href: string;
    label: string;
    Icon: typeof Home;
    active: boolean;
    testId: string;
  }) => (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      data-testid={testId}
      className={cn(
        "flex flex-col items-center justify-center gap-0.5 flex-1 h-full text-[11px] font-semibold transition-colors",
        active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon className="w-5 h-5" />
      <span>{label}</span>
    </Link>
  );

  return (
    <>
      <nav
        aria-label="Primary"
        data-testid="mobile-bottom-nav"
        className="fixed bottom-0 inset-x-0 z-40 border-t border-border bg-background md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="flex items-stretch h-16 max-w-6xl mx-auto px-2">
          <Item
            href="/"
            label="Home"
            Icon={Home}
            active={homeActive}
            testId="mobile-tab-home"
          />
          <Item
            href="/organizations"
            label="Orgs"
            Icon={Building2}
            active={orgsActive}
            testId="mobile-tab-orgs"
          />

          {/* Center "+" raised button */}
          <div className="flex items-center justify-center flex-1">
            {meId ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label="Create"
                    data-testid="mobile-tab-create"
                    className="-mt-6 w-14 h-14 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-95 transition-transform"
                  >
                    <Plus className="w-6 h-6" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="center" side="top" className="w-52">
                  <CreateMenuItems
                    canAuthorRecap={canAuthorRecap}
                    onCreateOrg={() => setCreateOrgOpen(true)}
                  />
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <button
                type="button"
                aria-label="Create"
                data-testid="mobile-tab-create"
                onClick={() => setLocation("/login")}
                className="-mt-6 w-14 h-14 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center"
              >
                <Plus className="w-6 h-6" />
              </button>
            )}
          </div>

          {meId && (
            <Item
              href={teamsHref}
              label="Teams"
              Icon={UsersRound}
              active={teamsActive}
              testId="mobile-tab-teams"
            />
          )}
          <Item
            href={profileHref}
            label={meId ? "Profile" : "Sign in"}
            Icon={User}
            active={profileActive}
            testId="mobile-tab-profile"
          />
        </div>
      </nav>
      <CreateOrgDialog open={createOrgOpen} onOpenChange={setCreateOrgOpen} />
    </>
  );
}
