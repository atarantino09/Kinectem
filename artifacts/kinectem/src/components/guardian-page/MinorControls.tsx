import { useCallback, useEffect, useState } from "react";
import { Link } from "wouter";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { UserAvatar } from "@/components/UserAvatar";
import { Check, Download, ExternalLink, Lock, Unlock, X } from "lucide-react";
import type { Child } from "./types";

type Actor = { id: string; displayName: string; avatarUrl: string | null };

type FollowItem = { id: string; actor: Actor; createdAt: string };
type DmItem = {
  id: string;
  body: string;
  createdAt: string;
  conversationId: string;
  actor: Actor;
};
type CommentItem = {
  id: string;
  body: string;
  createdAt: string;
  postId: string;
  actor: Actor;
};
type TagItem = {
  id: string;
  kind: "article" | "highlight";
  postId: string;
  createdAt: string;
  actor: Actor;
};
type AllowEntry = {
  counterpartyUserId: string;
  displayName: string;
  avatarUrl: string | null;
  note: string | null;
  createdAt: string;
};

type ListEnvelope<T> = { data: T[] };

type ActivityResponse = {
  articles: { id: string; title: string | null; createdAt: string }[];
  highlights: { id: string; title: string | null; createdAt: string }[];
  comments: {
    id: string;
    body: string;
    createdAt: string;
    moderationStatus: string;
  }[];
  dmsSent: { id: string; createdAt: string; moderationStatus: string }[];
  dmsReceived: {
    id: string;
    senderUserId: string;
    createdAt: string;
    moderationStatus: string;
  }[];
  followers: {
    followerUserId: string;
    createdAt: string;
    moderationStatus: string;
  }[];
  following: {
    followingUserId: string;
    createdAt: string;
    moderationStatus: string;
  }[];
};

interface Props {
  child: Child;
}

export function MinorControls({ child }: Props) {
  const [follows, setFollows] = useState<FollowItem[] | null>(null);
  const [dms, setDms] = useState<DmItem[] | null>(null);
  const [comments, setComments] = useState<CommentItem[] | null>(null);
  const [tags, setTags] = useState<TagItem[] | null>(null);
  const [allow, setAllow] = useState<AllowEntry[] | null>(null);
  const [activity, setActivity] = useState<ActivityResponse | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [allowDraft, setAllowDraft] = useState("");

  const base = `/api/v1/guardians/children/${child.id}`;

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [f, d, c, t, a, act] = await Promise.all([
        customFetch<ListEnvelope<FollowItem>>(`${base}/pending-follows`),
        customFetch<ListEnvelope<DmItem>>(`${base}/pending-dms`),
        customFetch<ListEnvelope<CommentItem>>(`${base}/pending-comments`),
        customFetch<ListEnvelope<TagItem>>(`${base}/pending-tags`),
        customFetch<ListEnvelope<AllowEntry>>(`${base}/dm-allowlist`),
        customFetch<ActivityResponse>(`${base}/activity`),
      ]);
      setFollows(f.data ?? []);
      setDms(d.data ?? []);
      setComments(c.data ?? []);
      setTags(t.data ?? []);
      setAllow(a.data ?? []);
      setActivity(act);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    }
  }, [base]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const decide = useCallback(
    async (
      kind: "follow" | "dm" | "comment" | "tag",
      id: string,
      decision: "approve" | "decline",
    ) => {
      const key = `${kind}:${id}:${decision}`;
      setBusy(key);
      try {
        await customFetch(`${base}/pending/${kind}/${id}/${decision}`, {
          method: "POST",
        });
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Action failed");
      } finally {
        setBusy(null);
      }
    },
    [base, refresh],
  );

  const addAllow = useCallback(async () => {
    const id = allowDraft.trim();
    if (!id) return;
    setBusy("allow:add");
    try {
      await customFetch(`${base}/dm-allowlist`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ counterpartyUserId: id }),
      });
      setAllowDraft("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add");
    } finally {
      setBusy(null);
    }
  }, [allowDraft, base, refresh]);

  const removeAllow = useCallback(
    async (counterpartyUserId: string) => {
      setBusy(`allow:rm:${counterpartyUserId}`);
      try {
        await customFetch(`${base}/dm-allowlist/${counterpartyUserId}`, {
          method: "DELETE",
        });
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to remove");
      } finally {
        setBusy(null);
      }
    },
    [base, refresh],
  );

  const deleteAccount = useCallback(async () => {
    const confirmed = window.confirm(
      `Permanently delete ${child.firstName}'s Kinectem account?\n\n` +
        `The account is locked immediately. After a 30-day cooling-off ` +
        `period, all of ${child.firstName}'s data is hard-deleted from ` +
        `our database. This cannot be undone.`,
    );
    if (!confirmed) return;
    setBusy("delete");
    setError(null);
    try {
      await customFetch(`${base}/request-deletion`, { method: "POST" });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Deletion request failed");
    } finally {
      setBusy(null);
    }
  }, [base, child.firstName, refresh]);

  const exportData = useCallback(async () => {
    setBusy("export");
    try {
      const data = await customFetch<unknown>(`${base}/export`);
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `kinectem-export-${child.id}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setBusy(null);
    }
  }, [base, child.id]);

  const consentAction = useCallback(
    async (kind: "revoke" | "regrant") => {
      const path = kind === "revoke" ? "revoke-consent" : "regrant-consent";
      const word = kind === "revoke" ? "pause" : "re-activate";
      if (
        !window.confirm(
          `Are you sure you want to ${word} ${child.firstName}'s account?`,
        )
      )
        return;
      setBusy(`consent:${kind}`);
      try {
        await customFetch(`${base}/${path}`, { method: "POST" });
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed");
      } finally {
        setBusy(null);
      }
    },
    [base, child.firstName, refresh],
  );

  if (!follows || !dms || !comments || !tags || !allow || !activity) {
    return <Skeleton className="h-32 rounded-lg" />;
  }

  const renderActor = (a: Actor, sub?: string) => (
    <div className="flex items-center gap-2 min-w-0">
      <UserAvatar
        displayName={a.displayName}
        avatarUrl={a.avatarUrl}
        size="sm"
      />
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{a.displayName}</div>
        {sub ? (
          <div className="truncate text-xs text-muted-foreground">{sub}</div>
        ) : null}
      </div>
    </div>
  );

  const decideRow = (
    kind: "follow" | "dm" | "comment" | "tag",
    id: string,
  ) => (
    <div className="flex items-center gap-2 shrink-0">
      <Button
        size="sm"
        variant="outline"
        disabled={busy === `${kind}:${id}:approve`}
        onClick={() => void decide(kind, id, "approve")}
      >
        <Check className="w-3 h-3 mr-1" /> Approve
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={busy === `${kind}:${id}:decline`}
        onClick={() => void decide(kind, id, "decline")}
      >
        <X className="w-3 h-3 mr-1" /> Decline
      </Button>
    </div>
  );

  const Section = ({
    title,
    empty,
    children,
  }: {
    title: string;
    empty: boolean;
    children: React.ReactNode;
  }) => (
    <div className="space-y-2">
      <h4 className="text-sm font-black tracking-tight">{title}</h4>
      {empty ? (
        <p className="text-xs text-muted-foreground">Nothing pending.</p>
      ) : (
        <div className="space-y-2">{children}</div>
      )}
    </div>
  );

  return (
    <Card className="rounded-xl border-border">
      <CardContent className="p-4 space-y-5">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-black tracking-tight">
            Communication controls — {child.firstName}
          </h3>
          <div className="flex items-center gap-2">
            <Link href={`/users/${child.id}`}>
              <Button size="sm" variant="outline">
                <ExternalLink className="w-3 h-3 mr-1" /> Open timeline
              </Button>
            </Link>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void exportData()}
              disabled={busy === "export"}
            >
              <Download className="w-3 h-3 mr-1" /> Export
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void consentAction("revoke")}
              disabled={busy === "consent:revoke"}
            >
              <Lock className="w-3 h-3 mr-1" /> Pause
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void consentAction("regrant")}
              disabled={busy === "consent:regrant"}
            >
              <Unlock className="w-3 h-3 mr-1" /> Re-activate
            </Button>
            {/* Task #367 — right-to-delete. Marks the account
                pending_deletion immediately; an operator script
                hard-deletes the row after a 30-day cooling-off
                window. Behind a strong confirm because the action
                is irreversible. */}
            <Button
              size="sm"
              variant="outline"
              className="text-red-600 hover:text-red-700"
              onClick={() => void deleteAccount()}
              disabled={busy === "delete"}
            >
              <Lock className="w-3 h-3 mr-1" /> Delete account
            </Button>
          </div>
        </div>

        {error ? (
          <p className="text-xs text-red-600">{error}</p>
        ) : null}

        <Section title="Pending follow requests" empty={follows.length === 0}>
          {follows.map((f) => (
            <div
              key={f.id}
              className="flex items-center justify-between gap-2 rounded-lg border border-border p-2"
            >
              {renderActor(f.actor, "wants to follow")}
              {decideRow("follow", f.id)}
            </div>
          ))}
        </Section>

        <Section title="Pending direct messages" empty={dms.length === 0}>
          {dms.map((m) => (
            <div
              key={m.id}
              className="flex items-center justify-between gap-2 rounded-lg border border-border p-2"
            >
              {renderActor(m.actor, m.body)}
              {decideRow("dm", m.id)}
            </div>
          ))}
        </Section>

        <Section title="Pending comments" empty={comments.length === 0}>
          {comments.map((c) => (
            <div
              key={c.id}
              className="flex items-center justify-between gap-2 rounded-lg border border-border p-2"
            >
              {renderActor(c.actor, c.body)}
              {decideRow("comment", c.id)}
            </div>
          ))}
        </Section>

        <Section title="Pending tags" empty={tags.length === 0}>
          {tags.map((t) => (
            <div
              key={t.id}
              className="flex items-center justify-between gap-2 rounded-lg border border-border p-2"
            >
              {renderActor(t.actor, `tagged in ${t.kind}`)}
              {decideRow("tag", t.id)}
            </div>
          ))}
        </Section>

        <div className="space-y-2">
          <h4 className="text-sm font-black tracking-tight">DM allowlist</h4>
          <p className="text-xs text-muted-foreground">
            People on this list can DM {child.firstName} without needing your
            approval.
          </p>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={allowDraft}
              onChange={(e) => setAllowDraft(e.target.value)}
              placeholder="User ID"
              className="flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-sm"
            />
            <Button
              size="sm"
              onClick={() => void addAllow()}
              disabled={busy === "allow:add" || !allowDraft.trim()}
            >
              Add
            </Button>
          </div>
          {allow.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No one is on the allowlist yet.
            </p>
          ) : (
            <div className="space-y-2">
              {allow.map((a) => (
                <div
                  key={a.counterpartyUserId}
                  className="flex items-center justify-between gap-2 rounded-lg border border-border p-2"
                >
                  {renderActor(
                    {
                      id: a.counterpartyUserId,
                      displayName: a.displayName,
                      avatarUrl: a.avatarUrl,
                    },
                    a.note ?? undefined,
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy === `allow:rm:${a.counterpartyUserId}`}
                    onClick={() => void removeAllow(a.counterpartyUserId)}
                  >
                    Remove
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="space-y-2">
          <h4 className="text-sm font-black tracking-tight">Recent activity</h4>
          <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
            <div className="rounded-lg border border-border p-2">
              <div className="font-medium text-foreground">
                Posts ({activity.articles.length + activity.highlights.length})
              </div>
              {activity.articles.slice(0, 3).map((a) => (
                <div key={a.id} className="truncate">
                  {a.title ?? "Untitled recap"} · {new Date(a.createdAt).toLocaleDateString()}
                </div>
              ))}
              {activity.highlights.slice(0, 3).map((h) => (
                <div key={h.id} className="truncate">
                  {h.title ?? "Untitled highlight"} · {new Date(h.createdAt).toLocaleDateString()}
                </div>
              ))}
              {activity.articles.length + activity.highlights.length === 0 ? (
                <div>None yet.</div>
              ) : null}
            </div>
            <div className="rounded-lg border border-border p-2">
              <div className="font-medium text-foreground">
                Comments ({activity.comments.length})
              </div>
              {activity.comments.slice(0, 3).map((c) => (
                <div key={c.id} className="truncate">
                  [{c.moderationStatus}] {c.body}
                </div>
              ))}
              {activity.comments.length === 0 ? <div>None yet.</div> : null}
            </div>
            <div className="rounded-lg border border-border p-2">
              <div className="font-medium text-foreground">
                DMs (sent {activity.dmsSent.length} · received {activity.dmsReceived.length})
              </div>
              {activity.dmsSent.slice(0, 3).map((m) => (
                <div key={`s-${m.id}`} className="truncate">
                  sent · [{m.moderationStatus}] {new Date(m.createdAt).toLocaleString()}
                </div>
              ))}
              {activity.dmsReceived.slice(0, 3).map((m) => (
                <div key={`r-${m.id}`} className="truncate">
                  received · [{m.moderationStatus}] {new Date(m.createdAt).toLocaleString()}
                </div>
              ))}
              {activity.dmsSent.length + activity.dmsReceived.length === 0 ? (
                <div>None yet.</div>
              ) : null}
            </div>
            <div className="rounded-lg border border-border p-2">
              <div className="font-medium text-foreground">
                Follows (followers {activity.followers.length} · following{" "}
                {activity.following.length})
              </div>
              {activity.followers.slice(0, 3).map((f) => (
                <div key={`fr-${f.followerUserId}`} className="truncate">
                  follower · [{f.moderationStatus}]{" "}
                  <Link href={`/users/${f.followerUserId}`} className="underline">
                    {f.followerUserId.slice(0, 8)}
                  </Link>
                </div>
              ))}
              {activity.following.slice(0, 3).map((f) => (
                <div key={`fg-${f.followingUserId}`} className="truncate">
                  following · [{f.moderationStatus}]{" "}
                  <Link href={`/users/${f.followingUserId}`} className="underline">
                    {f.followingUserId.slice(0, 8)}
                  </Link>
                </div>
              ))}
              {activity.followers.length + activity.following.length === 0 ? (
                <div>None yet.</div>
              ) : null}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
