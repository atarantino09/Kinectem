import { useCallback, useEffect, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { UserAvatar } from "@/components/UserAvatar";
import { Check, Download, Lock, Unlock, X } from "lucide-react";
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

interface Props {
  child: Child;
}

export function MinorControls({ child }: Props) {
  const [follows, setFollows] = useState<FollowItem[] | null>(null);
  const [dms, setDms] = useState<DmItem[] | null>(null);
  const [comments, setComments] = useState<CommentItem[] | null>(null);
  const [tags, setTags] = useState<TagItem[] | null>(null);
  const [allow, setAllow] = useState<AllowEntry[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [allowDraft, setAllowDraft] = useState("");

  const base = `/api/v1/guardians/children/${child.id}`;

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [f, d, c, t, a] = await Promise.all([
        customFetch<ListEnvelope<FollowItem>>(`${base}/pending-follows`),
        customFetch<ListEnvelope<DmItem>>(`${base}/pending-dms`),
        customFetch<ListEnvelope<CommentItem>>(`${base}/pending-comments`),
        customFetch<ListEnvelope<TagItem>>(`${base}/pending-tags`),
        customFetch<ListEnvelope<AllowEntry>>(`${base}/dm-allowlist`),
      ]);
      setFollows(f.data ?? []);
      setDms(d.data ?? []);
      setComments(c.data ?? []);
      setTags(t.data ?? []);
      setAllow(a.data ?? []);
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

  if (!follows || !dms || !comments || !tags || !allow) {
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
      </CardContent>
    </Card>
  );
}
