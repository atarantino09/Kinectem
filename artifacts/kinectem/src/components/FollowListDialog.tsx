import { useState } from "react";
import { Link } from "wouter";
import {
  useListUserFollowers,
  useListUserFollowing,
  useListTeamFollowers,
  useListOrgFollowers,
  customFetch,
  getListOrgFollowersQueryKey,
  getListTeamFollowersQueryKey,
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
import { Trash2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiErrorMessage } from "@/lib/api-errors";

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
  /** Set only by pages which have already established manager permissions. */
  canManageFollowers?: boolean;
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
  canManageFollowers = false,
}: Props) {
  const items = useFollowItems(variant, open);
  const qc = useQueryClient();
  const { toast } = useToast();
  const [removing, setRemoving] = useState<Item | null>(null);
  const [removingPending, setRemovingPending] = useState(false);
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(() => new Set());
  const hasMembers = members != null;
  const canRemove =
    canManageFollowers &&
    (variant.kind === "team-followers" || variant.kind === "org-followers");
  const visibleItems = items.data.filter((item) => !hiddenIds.has(item.id));

  const removeFollower = async () => {
    if (!removing || !canRemove) return;
    const target = removing;
    const route =
      variant.kind === "team-followers"
        ? `/api/v1/teams/${variant.teamId}/followers/${target.id}`
        : `/api/v1/organizations/${(variant as Extract<Variant, { kind: "org-followers" }>).orgId}/followers/${target.id}`;
    setRemovingPending(true);
    setHiddenIds((ids) => new Set(ids).add(target.id));
    try {
      await customFetch(route, { method: "DELETE" });
      toast({ title: `${target.displayName} removed from followers` });
      await qc.invalidateQueries({
        queryKey:
          variant.kind === "team-followers"
            ? getListTeamFollowersQueryKey(variant.teamId)
            : getListOrgFollowersQueryKey(
                (variant as Extract<Variant, { kind: "org-followers" }>).orgId,
              ),
      });
      setRemoving(null);
    } catch (err) {
      setHiddenIds((ids) => {
        const next = new Set(ids);
        next.delete(target.id);
        return next;
      });
      toast({
        title: "Couldn't remove follower",
        description: apiErrorMessage(err) ?? "Please try again.",
        variant: "destructive",
      });
    } finally {
      setRemovingPending(false);
    }
  };

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
                data={visibleItems}
                onNavigate={() => onOpenChange(false)}
                onRemove={canRemove ? setRemoving : undefined}
              />
            </TabsContent>
          </Tabs>
        ) : (
          <ItemList
            isLoading={items.isLoading}
            data={visibleItems}
            onNavigate={() => onOpenChange(false)}
            onRemove={canRemove ? setRemoving : undefined}
          />
        )}
      </DialogContent>
      <AlertDialog
        open={removing !== null}
        onOpenChange={(isOpen) => !isOpen && !removingPending && setRemoving(null)}
      >
        <AlertDialogContent data-testid="dialog-remove-follower-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>Remove follower?</AlertDialogTitle>
            <AlertDialogDescription>
              {removing
                ? `${removing.displayName} will no longer follow this ${variant.kind === "team-followers" ? "team" : "organization"}.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removingPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={removingPending}
              onClick={(event) => {
                event.preventDefault();
                void removeFollower();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-remove-follower"
            >
              {removingPending ? "Removing…" : "Remove follower"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}

function ItemList({
  isLoading,
  data,
  onNavigate,
  onRemove,
}: {
  isLoading: boolean;
  data: Item[];
  onNavigate: () => void;
  onRemove?: (item: Item) => void;
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
                  {onRemove && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      aria-label={`Remove ${it.displayName} from followers`}
                      data-testid={`button-remove-follower-${it.id}`}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        onRemove(it);
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
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
