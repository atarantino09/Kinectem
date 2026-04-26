import { Link } from "wouter";
import {
  useListUserFollowers,
  useListUserFollowing,
  useListTeamFollowers,
  useListOrgFollowers,
} from "@workspace/api-client-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { UserAvatar } from "@/components/UserAvatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Users } from "lucide-react";

type Variant =
  | { kind: "user-followers"; userId: string }
  | { kind: "user-following"; userId: string }
  | { kind: "team-followers"; teamId: string }
  | { kind: "org-followers"; orgId: string };

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  variant: Variant;
}

interface Item {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  href: string;
  badge?: string;
}

export function FollowListDialog({ open, onOpenChange, title, variant }: Props) {
  const items = useFollowItems(variant, open);

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
        <div className="max-h-[60vh] overflow-y-auto px-2 py-2">
          {items.isLoading ? (
            <div className="space-y-2 p-2">
              <Skeleton className="h-12 rounded-lg" />
              <Skeleton className="h-12 rounded-lg" />
              <Skeleton className="h-12 rounded-lg" />
            </div>
          ) : items.data.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              <Users className="w-8 h-8 mx-auto mb-2 opacity-50" />
              No one yet.
            </div>
          ) : (
            <ul className="space-y-1">
              {items.data.map((it) => (
                <li key={it.id}>
                  <Link href={it.href}>
                    <div
                      onClick={() => onOpenChange(false)}
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
      </DialogContent>
    </Dialog>
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
      query: { enabled: enabled && v.kind === "user-followers" } as never,
    },
  );
  const userFollowing = useListUserFollowing(
    v.kind === "user-following" ? v.userId : "",
    undefined,
    {
      query: { enabled: enabled && v.kind === "user-following" } as never,
    },
  );
  const teamFollowers = useListTeamFollowers(
    v.kind === "team-followers" ? v.teamId : "",
    undefined,
    {
      query: { enabled: enabled && v.kind === "team-followers" } as never,
    },
  );
  const orgFollowers = useListOrgFollowers(
    v.kind === "org-followers" ? v.orgId : "",
    undefined,
    {
      query: { enabled: enabled && v.kind === "org-followers" } as never,
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
