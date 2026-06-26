import { useEffect, useState } from "react";
import { useSearch } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { UserAvatar } from "@/components/UserAvatar";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Megaphone, Building2, Users } from "lucide-react";
import {
  fetchInbox,
  fetchBroadcast,
  markBroadcastRead,
  postBroadcastReply,
  inboxQueryKey,
  unreadCountQueryKey,
  broadcastDetailQueryKey,
  formatBroadcastTime,
  type BroadcastInboxItem,
  type BroadcastDetail,
  type BroadcastThread,
} from "@/components/broadcasts/broadcastsApi";

// ---------------------------------------------------------------------------
// /announcements — the recipient inbox for broadcasts. Selecting one opens the
// detail view: org broadcasts are read-only; team broadcasts show private
// per-family reply threads (a parent sees only their own thread; staff see all
// and can reply into each).
// ---------------------------------------------------------------------------
export default function AnnouncementsPage() {
  const search = useSearch();
  const initialId = new URLSearchParams(search).get("b");
  const [selectedId, setSelectedId] = useState<string | null>(initialId);

  useEffect(() => {
    if (initialId) setSelectedId(initialId);
  }, [initialId]);

  if (selectedId) {
    return (
      <BroadcastDetailView
        broadcastId={selectedId}
        onBack={() => setSelectedId(null)}
      />
    );
  }
  return <InboxView onSelect={setSelectedId} />;
}

function InboxView({ onSelect }: { onSelect: (id: string) => void }) {
  const { data, isLoading } = useQuery({
    queryKey: inboxQueryKey(),
    queryFn: fetchInbox,
  });

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div className="flex items-center gap-2">
        <Megaphone className="w-6 h-6 text-primary" />
        <h1 className="text-2xl font-black">Announcements</h1>
      </div>

      {isLoading && (
        <p className="text-sm text-muted-foreground">Loading…</p>
      )}

      {!isLoading && (data?.length ?? 0) === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            <Megaphone className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p className="font-semibold">No announcements yet</p>
            <p className="text-sm">
              Messages from your organizations and teams will show up here.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="space-y-2">
        {data?.map((item) => (
          <InboxRow key={item.id} item={item} onSelect={onSelect} />
        ))}
      </div>
    </div>
  );
}

function InboxRow({
  item,
  onSelect,
}: {
  item: BroadcastInboxItem;
  onSelect: (id: string) => void;
}) {
  const ScopeIcon = item.scope === "organization" ? Building2 : Users;
  return (
    <button
      type="button"
      onClick={() => onSelect(item.id)}
      className="w-full text-left"
      data-testid={`broadcast-row-${item.id}`}
    >
      <Card
        className={item.read ? "" : "border-primary/40 bg-primary/[0.03]"}
      >
        <CardContent className="py-4 flex items-start gap-3">
          <div className="mt-0.5">
            <UserAvatar
              avatarUrl={item.sender?.avatarUrl}
              displayName={item.sender?.displayName ?? "?"}
              size="md"
            />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              {!item.read && (
                <span className="w-2 h-2 rounded-full bg-primary shrink-0" />
              )}
              <span className="font-bold truncate">
                {item.sourceName ?? "Kinectem"}
              </span>
              <Badge
                variant="outline"
                className="rounded-full text-[10px] font-bold gap-1"
              >
                <ScopeIcon className="w-3 h-3" />
                {item.scope === "organization" ? "Org" : "Team"}
              </Badge>
              {item.canReply && (
                <Badge
                  variant="outline"
                  className="rounded-full text-[10px] font-bold border-emerald-300 text-emerald-700"
                >
                  Reply allowed
                </Badge>
              )}
            </div>
            <p className="text-sm text-foreground/90 line-clamp-2 mt-1 whitespace-pre-wrap">
              {item.body}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {item.sender?.displayName ? `${item.sender.displayName} · ` : ""}
              {formatBroadcastTime(item.createdAt)}
            </p>
          </div>
        </CardContent>
      </Card>
    </button>
  );
}

function BroadcastDetailView({
  broadcastId,
  onBack,
}: {
  broadcastId: string;
  onBack: () => void;
}) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: broadcastDetailQueryKey(broadcastId),
    queryFn: () => fetchBroadcast(broadcastId),
  });

  // Mark read on open (fire-and-forget; refresh the badge + inbox after).
  useEffect(() => {
    if (!data || data.read) return;
    void (async () => {
      try {
        await markBroadcastRead(broadcastId);
        await qc.invalidateQueries({ queryKey: unreadCountQueryKey() });
        await qc.invalidateQueries({ queryKey: inboxQueryKey() });
      } catch {
        // non-critical
      }
    })();
  }, [data, broadcastId, qc]);

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <Button
        variant="ghost"
        size="sm"
        onClick={onBack}
        className="font-semibold -ml-2"
        data-testid="btn-broadcast-back"
      >
        <ArrowLeft className="w-4 h-4 mr-1.5" /> Announcements
      </Button>

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

      {data && (
        <>
          <Card>
            <CardContent className="py-5 space-y-3">
              <div className="flex items-center gap-3">
                <UserAvatar
                  avatarUrl={data.sender?.avatarUrl}
                  displayName={data.sender?.displayName ?? "?"}
                  size="md"
                />
                <div className="min-w-0">
                  <p className="font-bold truncate">
                    {data.sourceName ?? "Kinectem"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {data.sender?.displayName
                      ? `${data.sender.displayName} · `
                      : ""}
                    {formatBroadcastTime(data.createdAt)}
                  </p>
                </div>
              </div>
              <p className="whitespace-pre-wrap text-foreground/90 leading-relaxed">
                {data.body}
              </p>
            </CardContent>
          </Card>

          {data.scope === "team" && data.allowReplies ? (
            <RepliesSection broadcast={data} />
          ) : (
            <p className="text-xs text-muted-foreground text-center">
              Replies are turned off for this announcement.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function RepliesSection({ broadcast }: { broadcast: BroadcastDetail }) {
  // A parent replies into their own (single) thread; staff reply per family.
  if (broadcast.isStaff) {
    return <StaffThreads broadcast={broadcast} />;
  }
  if (broadcast.canReply) {
    const myThread = broadcast.threads[0] ?? null;
    return (
      <Card>
        <CardContent className="py-4 space-y-3">
          <h2 className="font-bold text-sm">Your conversation with staff</h2>
          <ThreadMessages thread={myThread} emptyHint="No replies yet. Start the conversation below — only team staff can see it." />
          <ReplyBox broadcastId={broadcast.id} />
        </CardContent>
      </Card>
    );
  }
  return (
    <p className="text-xs text-muted-foreground text-center">
      Only parents and team staff can reply to team messages.
    </p>
  );
}

function StaffThreads({ broadcast }: { broadcast: BroadcastDetail }) {
  if (broadcast.threads.length === 0) {
    return (
      <Card>
        <CardContent className="py-6 text-center text-sm text-muted-foreground">
          No replies yet. Parents who reply will appear here as private,
          per-family threads.
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="space-y-3">
      <h2 className="font-bold text-sm">Family replies</h2>
      {broadcast.threads.map((thread) => (
        <Card key={thread.familyParentUserId}>
          <CardContent className="py-4 space-y-3">
            <p className="font-bold text-sm">
              {thread.familyName ?? "Family"}
            </p>
            <ThreadMessages thread={thread} emptyHint="" />
            <ReplyBox
              broadcastId={broadcast.id}
              familyParentUserId={thread.familyParentUserId}
            />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function ThreadMessages({
  thread,
  emptyHint,
}: {
  thread: BroadcastThread | null;
  emptyHint: string;
}) {
  const replies = thread?.replies ?? [];
  if (replies.length === 0) {
    return emptyHint ? (
      <p className="text-xs text-muted-foreground">{emptyHint}</p>
    ) : null;
  }
  return (
    <div className="space-y-2">
      {replies.map((r) => (
        <div
          key={r.id}
          className={r.isMine ? "flex justify-end" : "flex justify-start"}
        >
          <div
            className={
              "max-w-[80%] rounded-2xl px-3 py-2 text-sm " +
              (r.isMine
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-foreground")
            }
          >
            {!r.isMine && r.sender?.displayName && (
              <p className="text-[11px] font-bold opacity-80 mb-0.5">
                {r.sender.displayName}
              </p>
            )}
            <p className="whitespace-pre-wrap">{r.body}</p>
            <p
              className={
                "text-[10px] mt-1 " +
                (r.isMine
                  ? "text-primary-foreground/70"
                  : "text-muted-foreground")
              }
            >
              {formatBroadcastTime(r.createdAt)}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

function ReplyBox({
  broadcastId,
  familyParentUserId,
}: {
  broadcastId: string;
  familyParentUserId?: string;
}) {
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const { toast } = useToast();
  const qc = useQueryClient();

  const onSend = async () => {
    const trimmed = body.trim();
    if (!trimmed) return;
    setSending(true);
    try {
      await postBroadcastReply(broadcastId, trimmed, familyParentUserId);
      setBody("");
      await qc.invalidateQueries({
        queryKey: broadcastDetailQueryKey(broadcastId),
      });
    } catch (err) {
      toast({
        title: "Couldn't send reply",
        description: err instanceof Error ? err.message : "Something went wrong.",
        variant: "destructive",
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex items-end gap-2">
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value.slice(0, 4000))}
        placeholder="Write a private reply…"
        rows={2}
        className="resize-none"
        data-testid="input-broadcast-reply"
      />
      <Button
        variant="brand"
        onClick={onSend}
        disabled={sending || !body.trim()}
        data-testid="btn-send-reply"
      >
        {sending ? "…" : "Send"}
      </Button>
    </div>
  );
}
