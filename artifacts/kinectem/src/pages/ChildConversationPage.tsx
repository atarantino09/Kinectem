import { useEffect, useState } from "react";
import { Link, useParams } from "wouter";
import {
  customFetch,
  type ConversationListItem,
  type MessageResponse,
  type DeletedMessageStub,
  type MessageAsset,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { UserAvatar } from "@/components/UserAvatar";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Eye, MessageSquare } from "lucide-react";
import { timeAgo } from "@/lib/format";
import { AvatarLightbox } from "@/components/AvatarLightbox";

interface Child {
  id: string;
  firstName: string;
  lastName: string;
  nickname: string | null;
  avatarUrl: string | null;
}

function isDeleted(
  m: MessageResponse | DeletedMessageStub,
): m is DeletedMessageStub {
  return (m as DeletedMessageStub).deleted === true;
}

function MessageAttachments({
  assets,
  testIdPrefix,
}: {
  assets: MessageAsset[];
  testIdPrefix: string;
}) {
  const images = assets.filter(
    (a) => a.url && a.mimeType.startsWith("image/"),
  );
  if (images.length === 0) return null;
  return (
    <div className="mt-2 grid grid-cols-2 gap-1.5 max-w-md">
      {images.map((a) => (
        <a
          key={a.id}
          href={a.url ?? "#"}
          target="_blank"
          rel="noreferrer"
          className="block rounded-lg overflow-hidden border border-border bg-muted aspect-square"
          data-testid={`${testIdPrefix}-attachment-${a.id}`}
        >
          <img
            src={a.url ?? ""}
            alt={a.fileName}
            className="w-full h-full object-cover"
          />
        </a>
      ))}
    </div>
  );
}

export default function ChildConversationPage() {
  const params = useParams<{ childId: string; conversationId: string }>();
  const { childId, conversationId } = params;

  const [child, setChild] = useState<Child | null>(null);
  const [conv, setConv] = useState<ConversationListItem | null>(null);
  const [messages, setMessages] = useState<
    (MessageResponse | DeletedMessageStub)[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        // Find the child in the parent's child list so we can show their
        // name in the header without exposing a generic /users/:id call.
        const list = await customFetch<{ data: Child[] }>(
          "/api/v1/users/me/children",
        );
        const found = (list.data ?? []).find((c) => c.id === childId) ?? null;
        if (cancelled) return;
        setChild(found);

        const [conversation, msgsResp] = await Promise.all([
          customFetch<ConversationListItem>(
            `/api/v1/users/me/children/${childId}/conversations/${conversationId}`,
          ),
          customFetch<{ data: (MessageResponse | DeletedMessageStub)[] }>(
            `/api/v1/users/me/children/${childId}/conversations/${conversationId}/messages`,
          ),
        ]);
        if (cancelled) return;
        setConv(conversation);
        setMessages(msgsResp.data ?? []);
      } catch (e) {
        if (cancelled) return;
        setError(
          (e as Error)?.message ??
            "We couldn't load this conversation. It may have been deleted.",
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [childId, conversationId]);

  const childFirst = child?.firstName ?? "your child";
  const participant = conv?.participant ?? null;

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <Link
        href="/family"
        className="inline-flex items-center gap-1.5 text-xs font-bold text-muted-foreground hover:text-foreground"
        data-testid="link-back-to-family"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Back to family
      </Link>

      <Card
        className="rounded-xl border-border"
        data-testid="card-child-conversation"
      >
        <CardContent className="p-4 space-y-3">
          {/* Read-only banner so the parent always knows what they're looking at */}
          <div
            className="flex items-start gap-2 rounded-lg bg-muted/60 border border-border px-3 py-2"
            data-testid="banner-read-only"
          >
            <Eye className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
            <div className="text-xs">
              <p className="font-bold">
                Viewing as {childFirst}'s guardian — read only
              </p>
              <p className="text-muted-foreground">
                You can see everything {childFirst} sees in this conversation,
                but you can't reply on their behalf.
              </p>
            </div>
          </div>

          {loading ? (
            <Skeleton className="h-40 rounded-lg" />
          ) : error ? (
            <p
              className="text-sm text-muted-foreground py-6 text-center"
              data-testid="text-conversation-error"
            >
              {error}
            </p>
          ) : (
            <>
              <div className="flex items-center justify-between border-b border-border pb-3 gap-2">
                {participant ? (
                  <div
                    className="flex items-center gap-2 min-w-0"
                    data-testid="conversation-header-participant"
                  >
                    <UserAvatar
                      avatarUrl={participant.avatarUrl}
                      displayName={participant.displayName}
                      size="sm"
                      className="shrink-0"
                      fallbackClassName="bg-slate-100 text-slate-800"
                    />
                    <div className="min-w-0">
                      <h3
                        className="font-black tracking-tight text-base truncate"
                        data-testid="text-conversation-header-name"
                      >
                        {participant.displayName}
                      </h3>
                      <p className="text-xs text-muted-foreground truncate">
                        Talking with {childFirst}
                      </p>
                    </div>
                  </div>
                ) : (
                  <h3 className="font-black tracking-tight text-base">
                    Conversation
                  </h3>
                )}
                {conv && conv.unreadCount > 0 && (
                  <Badge
                    className="text-[10px] font-black bg-primary text-primary-foreground h-5 px-2"
                    data-testid="badge-unread"
                  >
                    {conv.unreadCount} unread
                  </Badge>
                )}
              </div>

              {messages.length === 0 ? (
                <div className="text-center py-12">
                  <MessageSquare className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">
                    No messages in this conversation yet.
                  </p>
                </div>
              ) : (
                <div
                  className="space-y-2 max-h-[600px] overflow-y-auto pr-1"
                  data-testid="list-child-messages"
                >
                  {messages.map((m, i) => {
                    if (isDeleted(m)) {
                      return (
                        <div
                          key={m.id}
                          className="text-xs text-muted-foreground italic py-2 text-center"
                        >
                          message deleted • {timeAgo(m.createdAt)}
                        </div>
                      );
                    }
                    let prevSenderId: string | null = null;
                    for (let j = i - 1; j >= 0; j--) {
                      const candidate = messages[j];
                      if (!isDeleted(candidate)) {
                        prevSenderId = candidate.senderId;
                        break;
                      }
                    }
                    const groupedWithPrev = prevSenderId === m.senderId;
                    // From the child's seat: messages they sent are "outgoing".
                    const isFromChild = m.senderId === childId;
                    return (
                      <div
                        key={m.id}
                        data-testid={`message-${m.id}`}
                        className={`flex w-full ${
                          groupedWithPrev ? "mt-0.5" : "mt-3"
                        } ${isFromChild ? "justify-end" : "justify-start"}`}
                      >
                        {!isFromChild && (
                          <div className="w-7 mr-2 shrink-0">
                            {!groupedWithPrev && (
                              <AvatarLightbox
                                avatarUrl={m.senderAvatarUrl}
                                displayName={m.senderDisplayName}
                                triggerClassName="rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                                triggerTestId={`btn-open-message-avatar-lightbox-${m.id}`}
                                dialogTestId={`dialog-message-avatar-lightbox-${m.id}`}
                                imageTestId={`img-message-avatar-lightbox-${m.id}`}
                              >
                                <UserAvatar
                                  avatarUrl={m.senderAvatarUrl}
                                  displayName={m.senderDisplayName}
                                  size="xs"
                                  className={
                                    m.senderAvatarUrl
                                      ? "cursor-pointer hover:opacity-80"
                                      : undefined
                                  }
                                  fallbackClassName="bg-slate-100 text-slate-800"
                                />
                              </AvatarLightbox>
                            )}
                          </div>
                        )}
                        <div
                          className={`flex flex-col max-w-[75%] ${
                            isFromChild ? "items-end" : "items-start"
                          }`}
                        >
                          {!groupedWithPrev && (
                            <div className="flex items-baseline gap-2 mb-1 px-1">
                              <p className="font-bold text-xs">
                                {isFromChild
                                  ? `${childFirst} (your child)`
                                  : m.senderDisplayName}
                              </p>
                              <p className="text-[10px] text-muted-foreground">
                                {timeAgo(m.createdAt)}
                              </p>
                            </div>
                          )}
                          {m.body && (
                            <div
                              className={`px-3.5 py-2 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap break-words ${
                                isFromChild
                                  ? "brand-gradient text-primary-foreground"
                                  : "bg-slate-100 text-foreground"
                              }`}
                            >
                              {m.body}
                            </div>
                          )}
                          {m.assets && m.assets.length > 0 && (
                            <MessageAttachments
                              assets={m.assets}
                              testIdPrefix={`message-${m.id}`}
                            />
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
