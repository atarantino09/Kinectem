import { Link } from "wouter";
import {
  useListUserFollowers,
  useListUserFollowing,
  useListTeamFollowers,
  useListOrgFollowers,
  queryOpts,
} from "@workspace/api-client-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { UserAvatar } from "@/components/UserAvatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Users } from "lucide-react";

type Variant =
  | { kind: "user-followers"; userId: string }
  | { kind: "user-following"; userId: string }
  | { kind: "team-followers"; teamId: string }
  | { kind: "org-followers"; orgId: string };

export interface MemberItem {
  userId: string;
  displayName: string;
  avatarUrl?: string | null;
  role: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  variant: Variant;
  /**
   * When supplied, the dialog gains a "Members" tab alongside "Followers"
   * so a single button can surface both lists. Used on the org page to fold
   * the members list into the followers button.
   */
  members?: MemberItem[];
}

interface Item {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  href: string;
  badge?: string;
}

export function FollowListDialog({
  open,
  onOpenChange,
  title,
  variant,
  members,
}: Props) {
  const items = useFollowItems(variant, open);
  const hasMembers = members != null;

  const memberItems: Item[] = (members ?? []).map((m) => ({
    id: m.userId,
    displayName: m.displayName,
    avatarUrl: m.avatarUrl ?? null,
    href: `/users/${m.userId}`,
    badge: m.role,
  }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-md p-0 overflow-hidden"
        data-testid={`dialog-${variant.kind}`}
      >
        <DialogHeader className="px-5 pt-5 pb-3 border-b">
          <DialogTitle className="text-lg font-black tracking-tight">
            {title}
          </DialogTitle>
        </DialogHeader>
        {hasMembers ? (
          <Tabs defaultValue="members" className="w-full">
            <div className="px-5 pt-3">
              <TabsList className="w-full">
                <TabsTrigger
                  value="members"
                  className="flex-1"
                  data-testid="tab-org-members"
                >
                  Members ({memberItems.length})
                </TabsTrigger>
                <TabsTrigger
                  value="followers"
                  className="flex-1"
                  data-testid="tab-org-followers"
                >
                  Followers ({items.data.length})
                </TabsTrigger>
              </TabsList>
            </div>
            <TabsContent value="members" className="mt-0">
              <ItemList
                isLoading={false}
                data={memberItems}
                onNavigate={() => onOpenChange(false)}
              />
            </TabsContent>
            <TabsContent value="followers" className="mt-0">
              <ItemList
                isLoading={items.isLoading}
                data={items.data}
                onNavigate={() => onOpenChange(false)}
              />
            </TabsContent>
          </Tabs>
        ) : (
          <ItemList
            isLoading={items.isLoading}
            data={items.data}
            onNavigate={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ItemList({
  isLoading,
  data,
  onNavigate,
}: {
  isLoading: boolean;
  data: Item[];
  onNavigate: () => void;
}) {
  return (
    <div className="max-h-[60vh] overflow-y-auto px-2 py-2">
      {isLoading ? (
        <div className="space-y-2 p-2">
          <Skeleton className="h-12 rounded-lg" />
          <Skeleton className="h-12 rounded-lg" />
          <Skeleton className="h-12 rounded-lg" />
        </div>
      ) : data.length === 0 ? (
        <div className="p-8 text-center text-sm text-muted-foreground">
          <Users className="w-8 h-8 mx-auto mb-2 opacity-50" />
          No one yet.
        </div>
      ) : (
        <ul className="space-y-1">
          {data.map((it) => (
            <li key={it.id}>
              <Link href={it.href}>
                <div
                  onClick={onNavigate}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-muted cursor-pointer"
                  data-testid={`follow-item-${it.id}`}
                >
                  <UserAvatar
                    avatarUrl={it.avatarUrl}
                    displayName={it.displayName}
                    size="lg"
                    fallbackClassName="bg-slate-900 text-primary-foreground font-black"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-sm truncate">
                      {it.displayName}
                    </p>
                    {it.badge && (
                      <p className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground">
                        {it.badge}
                      </p>
                    )}
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function useFollowItems(
  v: Variant,
  enabled: boolean,
): { isLoading: boolean; data: Item[] } {
  const userFollowers = useListUserFollowers(
    v.kind === "user-followers" ? v.userId : "",
    undefined,
    {
      query: queryOpts({ enabled: enabled && v.kind === "user-followers" }),
    },
  );
  const userFollowing = useListUserFollowing(
    v.kind === "user-following" ? v.userId : "",
    undefined,
    {
      query: queryOpts({ enabled: enabled && v.kind === "user-following" }),
    },
  );
  const teamFollowers = useListTeamFollowers(
    v.kind === "team-followers" ? v.teamId : "",
    undefined,
    {
      query: queryOpts({ enabled: enabled && v.kind === "team-followers" }),
    },
  );
  const orgFollowers = useListOrgFollowers(
    v.kind === "org-followers" ? v.orgId : "",
    undefined,
    {
      query: queryOpts({ enabled: enabled && v.kind === "org-followers" }),
    },
  );

  if (v.kind === "user-followers") {
    return {
      isLoading: userFollowers.isLoading,
      data: (userFollowers.data?.data ?? []).map((r) => ({
        id: r.id,
        displayName: r.displayName,
        avatarUrl: r.avatarUrl ?? null,
        href: `/users/${r.id}`,
      })),
    };
  }
  if (v.kind === "user-following") {
    return {
      isLoading: userFollowing.isLoading,
      data: (userFollowing.data?.data ?? []).map((r) => ({
        id: r.id,
        displayName: r.displayName,
        avatarUrl: r.avatarUrl ?? null,
        href:
          r.entityType === "organization"
            ? `/organizations/${r.id}`
            : `/users/${r.id}`,
        badge: r.entityType === "organization" ? "Organization" : "Person",
      })),
    };
  }
  if (v.kind === "team-followers") {
    return {
      isLoading: teamFollowers.isLoading,
      data: (teamFollowers.data?.data ?? []).map((r) => ({
        id: r.id,
        displayName: r.displayName,
        avatarUrl: r.avatarUrl ?? null,
        href: `/users/${r.id}`,
      })),
    };
  }
  return {
    isLoading: orgFollowers.isLoading,
    data: (orgFollowers.data?.data ?? []).map((r) => ({
      id: r.id,
      displayName: r.displayName,
      avatarUrl: r.avatarUrl ?? null,
      href: `/users/${r.id}`,
    })),
  };
}
