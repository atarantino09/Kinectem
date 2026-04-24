import { useState, useEffect } from "react";
import { Link, useParams, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListConversations,
  useListMessages,
  useSendMessage,
  useMarkConversationRead,
  useCreateConversation,
  useSearchConversationContacts,
  getListMessagesQueryKey,
  getListConversationsQueryKey,
  getGetUnreadMessageCountQueryKey,
  type ConversationListItem,
  type ConversationContactResult,
  type MessageResponse,
  type DeletedMessageStub,
} from "@workspace/api-client-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { MessageSquare, Send, Plus, Search, ArrowLeft } from "lucide-react";
import { timeAgo, getInitials } from "@/lib/format";

function isDeleted(
  m: MessageResponse | DeletedMessageStub,
): m is DeletedMessageStub {
  return (m as DeletedMessageStub).deleted === true;
}

export default function MessagesPage() {
  const params = useParams<{ conversationId?: string }>();
  const activeId = params.conversationId;
  const [composeOpen, setComposeOpen] = useState(false);

  const { data: convs, isLoading } = useListConversations();
  const items = convs?.data ?? [];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4 -mt-2">
      <aside className="space-y-1">
        <div className="flex items-center justify-between px-2 mb-2">
          <h2 className="text-xl font-black tracking-tight">Messages</h2>
          <Button
            size="sm"
            className="font-bold rounded-full gap-1.5 brand-gradient text-primary-foreground hover:opacity-95"
            onClick={() => setComposeOpen(true)}
            data-testid="button-new-message"
          >
            <Plus className="w-4 h-4" />
            New message
          </Button>
        </div>
        {isLoading ? (
          <Skeleton className="h-32 rounded-xl" />
        ) : items.length === 0 ? (
          <Card className="rounded-xl border border-border">
            <CardContent className="p-6 text-center text-sm text-muted-foreground space-y-3">
              <p>No conversations yet.</p>
              <Button
                size="sm"
                variant="outline"
                className="font-bold rounded-full"
                onClick={() => setComposeOpen(true)}
                data-testid="button-new-message-empty"
              >
                <Plus className="w-4 h-4 mr-1.5" />
                Start a conversation
              </Button>
            </CardContent>
          </Card>
        ) : (
          items.map((c: ConversationListItem) => (
            <Link key={c.id} href={`/messages/${c.id}`}>
              <button
                className={`w-full text-left p-3 rounded-lg flex gap-3 cursor-pointer ${
                  activeId === c.id ? "bg-muted" : "hover:bg-muted/60"
                }`}
                data-testid={`conversation-${c.id}`}
              >
                <Avatar className="w-10 h-10 shrink-0">
                  {c.participant.avatarUrl && (
                    <AvatarImage src={c.participant.avatarUrl} />
                  )}
                  <AvatarFallback className="bg-slate-900 text-primary-foreground text-xs font-bold">
                    {getInitials(c.participant.displayName)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between">
                    <p className="font-bold text-sm truncate">
                      {c.participant.displayName}
                    </p>
                    {c.unreadCount > 0 && (
                      <Badge className="text-[10px] font-black bg-primary text-primary-foreground h-4 px-1.5">
                        {c.unreadCount}
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground truncate">
                    {c.lastMessage?.bodyPreview ?? "No messages yet"}
                  </p>
                </div>
              </button>
            </Link>
          ))
        )}
      </aside>

      <section>
        {activeId ? (
          <ConversationView conversationId={activeId} />
        ) : (
          <Card className="rounded-xl border border-border h-full min-h-[400px]">
            <CardContent className="p-12 text-center">
              <MessageSquare className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">
                Select a conversation to start chatting.
              </p>
            </CardContent>
          </Card>
        )}
      </section>

      <NewMessageDialog open={composeOpen} onOpenChange={setComposeOpen} />
    </div>
  );
}

function ConversationView({ conversationId }: { conversationId: string }) {
  const qc = useQueryClient();
  const [body, setBody] = useState("");

  const { data: msgsResp, isLoading } = useListMessages(conversationId);
  const messages = msgsResp?.data ?? [];

  const invalidate = () => {
    qc.invalidateQueries({
      queryKey: getListMessagesQueryKey(conversationId),
    });
    qc.invalidateQueries({ queryKey: getListConversationsQueryKey() });
    qc.invalidateQueries({ queryKey: getGetUnreadMessageCountQueryKey() });
  };

  const send = useSendMessage({
    mutation: {
      onSuccess: () => {
        invalidate();
        setBody("");
      },
    },
  });
  const markRead = useMarkConversationRead({
    mutation: { onSuccess: invalidate },
  });

  const onSend = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = body.trim();
    if (!trimmed) return;
    send.mutate({ conversationId, data: { body: trimmed } });
  };

  return (
    <Card className="rounded-xl border border-border flex flex-col min-h-[500px]">
      <CardContent className="p-4 flex flex-col flex-1 gap-3">
        <div className="flex items-center justify-between border-b border-border pb-3">
          <h3 className="font-black tracking-tight text-base">Conversation</h3>
          <Button
            variant="ghost"
            size="sm"
            className="text-xs font-bold"
            onClick={() => markRead.mutate({ conversationId })}
            data-testid="button-mark-read"
          >
            Mark read
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto space-y-2 pr-1">
          {isLoading ? (
            <Skeleton className="h-24 rounded-lg" />
          ) : messages.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              Start the conversation.
            </p>
          ) : (
            messages.map((m) =>
              isDeleted(m) ? (
                <div
                  key={m.id}
                  className="text-xs text-muted-foreground italic py-2"
                >
                  message deleted • {timeAgo(m.createdAt)}
                </div>
              ) : (
                <div key={m.id} className="flex gap-2 py-1">
                  <Avatar className="w-7 h-7 mt-0.5">
                    {m.senderAvatarUrl && (
                      <AvatarImage src={m.senderAvatarUrl} />
                    )}
                    <AvatarFallback className="bg-slate-100 text-slate-800 text-[10px] font-bold">
                      {getInitials(m.senderDisplayName)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <p className="font-bold text-xs">
                        {m.senderDisplayName}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        {timeAgo(m.createdAt)}
                      </p>
                    </div>
                    {m.body && (
                      <p className="text-sm leading-relaxed whitespace-pre-wrap">
                        {m.body}
                      </p>
                    )}
                  </div>
                </div>
              ),
            )
          )}
        </div>

        <form onSubmit={onSend} className="flex gap-2 border-t border-border pt-3">
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Type a message…"
            rows={2}
            className="resize-none"
            data-testid="input-message-body"
          />
          <Button
            type="submit"
            disabled={!body.trim() || send.isPending}
            className="font-bold gap-2 self-end"
            data-testid="button-send-message"
          >
            <Send className="w-4 h-4" />
            Send
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function NewMessageDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [recipient, setRecipient] = useState<ConversationContactResult | null>(
    null,
  );
  const [body, setBody] = useState("");

  // Reset whenever the dialog opens or closes.
  useEffect(() => {
    if (!open) {
      setQuery("");
      setDebounced("");
      setRecipient(null);
      setBody("");
    }
  }, [open]);

  // Debounce search input by ~250ms.
  useEffect(() => {
    const h = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(h);
  }, [query]);

  const enableSearch = !recipient && debounced.length >= 1;
  const { data: searchResp, isFetching: isSearching } =
    useSearchConversationContacts(
      { q: debounced, limit: 8 },
      { query: { enabled: enableSearch } },
    );
  const results = searchResp?.data ?? [];

  const create = useCreateConversation({
    mutation: {
      onSuccess: (conv) => {
        qc.invalidateQueries({ queryKey: getListConversationsQueryKey() });
        qc.invalidateQueries({ queryKey: getGetUnreadMessageCountQueryKey() });
        onOpenChange(false);
        setLocation(`/messages/${conv.id}`);
      },
      onError: () => {
        toast({
          title: "Couldn't send message",
          description: "Please try again in a moment.",
          variant: "destructive",
        });
      },
    },
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!recipient) return;
    const trimmed = body.trim();
    if (!trimmed) return;
    create.mutate({
      data: {
        recipientType: "user",
        recipientId: recipient.id,
        message: { body: trimmed },
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-md sm:rounded-xl"
        data-testid="dialog-new-message"
      >
        <DialogHeader>
          <DialogTitle className="font-black tracking-tight text-xl">
            New message
          </DialogTitle>
        </DialogHeader>

        {!recipient ? (
          <div className="space-y-3">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by name…"
                className="pl-9"
                data-testid="input-contact-search"
              />
            </div>

            {!enableSearch ? (
              <p className="text-xs text-muted-foreground px-1 py-6 text-center">
                Type a name to find someone.
              </p>
            ) : isSearching ? (
              <Skeleton className="h-24 rounded-lg" />
            ) : results.length === 0 ? (
              <p className="text-xs text-muted-foreground px-1 py-6 text-center">
                No matches for &ldquo;{debounced}&rdquo;.
              </p>
            ) : (
              <ul className="max-h-72 overflow-y-auto -mx-2">
                {results.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => setRecipient(c)}
                      className="w-full text-left p-2 rounded-lg flex items-center gap-3 hover:bg-muted"
                      data-testid={`contact-result-${c.id}`}
                    >
                      <Avatar className="w-9 h-9 shrink-0">
                        {c.avatarUrl && <AvatarImage src={c.avatarUrl} />}
                        <AvatarFallback className="bg-slate-900 text-primary-foreground text-xs font-bold">
                          {getInitials(c.displayName)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <p className="font-bold text-sm truncate">
                          {c.displayName}
                        </p>
                        {c.relationship && (
                          <p className="text-[11px] text-muted-foreground truncate">
                            {c.relationship}
                          </p>
                        )}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-3">
            <div className="flex items-center gap-3 p-2 rounded-lg bg-muted/60">
              <Avatar className="w-9 h-9 shrink-0">
                {recipient.avatarUrl && (
                  <AvatarImage src={recipient.avatarUrl} />
                )}
                <AvatarFallback className="bg-slate-900 text-primary-foreground text-xs font-bold">
                  {getInitials(recipient.displayName)}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground">
                  To
                </p>
                <p className="font-bold text-sm truncate">
                  {recipient.displayName}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-xs font-bold gap-1"
                onClick={() => setRecipient(null)}
                data-testid="button-change-recipient"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Change
              </Button>
            </div>
            <Textarea
              autoFocus
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Type a message…"
              rows={4}
              className="resize-none"
              data-testid="input-new-message-body"
            />
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                className="font-bold"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={!body.trim() || create.isPending}
                className="font-bold gap-2 brand-gradient text-primary-foreground hover:opacity-95"
                data-testid="button-send-new-message"
              >
                <Send className="w-4 h-4" />
                Send
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
