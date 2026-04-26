import { useState, useEffect, useRef } from "react";
import { Link, useParams, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListConversations,
  useListMessages,
  useSendMessage,
  useMarkConversationRead,
  useCreateConversation,
  useSearchConversationContacts,
  useGetLoggedInUser,
  requestUpload,
  confirmUpload,
  getListMessagesQueryKey,
  getListConversationsQueryKey,
  getGetUnreadMessageCountQueryKey,
  getSearchConversationContactsQueryKey,
  type ConversationListItem,
  type ConversationContactResult,
  type MessageResponse,
  type DeletedMessageStub,
  type MessageAsset,
} from "@workspace/api-client-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { UserAvatar } from "@/components/UserAvatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  MessageSquare,
  Send,
  Plus,
  Search,
  ArrowLeft,
  ImagePlus,
  X,
} from "lucide-react";
import { timeAgo, getInitials } from "@/lib/format";
import { shrinkImage, IMAGE_UPLOAD_MAX_BYTES } from "@/lib/shrinkImage";
import { AvatarLightbox } from "@/components/AvatarLightbox";

function isDeleted(
  m: MessageResponse | DeletedMessageStub,
): m is DeletedMessageStub {
  return (m as DeletedMessageStub).deleted === true;
}

const ATTACHMENT_MAX_BYTES = IMAGE_UPLOAD_MAX_BYTES;
const ATTACHMENT_MAX_COUNT = 10;

type AttachmentDraft = {
  localId: string;
  file: File;
  previewUrl: string;
};

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

async function uploadAttachment(file: File): Promise<string> {
  const upload = await requestUpload({
    fileName: file.name,
    fileType: file.type || "application/octet-stream",
    fileSize: file.size,
  });
  const putResp = await fetch(upload.uploadUrl, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
  if (!putResp.ok) {
    throw new Error(`Upload failed (${putResp.status})`);
  }
  await confirmUpload(upload.assetId);
  return upload.assetId;
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
            <div
              key={c.id}
              className={`w-full p-3 rounded-lg flex gap-3 ${
                activeId === c.id ? "bg-muted" : "hover:bg-muted/60"
              }`}
              data-testid={`conversation-${c.id}`}
            >
              <AvatarLightbox
                avatarUrl={c.participant.avatarUrl}
                displayName={c.participant.displayName}
                triggerClassName="shrink-0 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                triggerTestId={`btn-open-conversation-avatar-lightbox-${c.id}`}
                dialogTestId={`dialog-conversation-avatar-lightbox-${c.id}`}
                imageTestId={`img-conversation-avatar-lightbox-${c.id}`}
              >
                <UserAvatar
                  avatarUrl={c.participant.avatarUrl}
                  displayName={c.participant.displayName}
                  size="lg"
                  className={`shrink-0 ${c.participant.avatarUrl ? "cursor-pointer" : ""}`}
                  fallbackClassName="bg-slate-900 text-primary-foreground"
                />
              </AvatarLightbox>
              <Link
                href={`/messages/${c.id}`}
                className="min-w-0 flex-1 text-left cursor-pointer"
                data-testid={`link-conversation-${c.id}`}
              >
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
              </Link>
            </div>
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
  const { data: currentUser } = useGetLoggedInUser();
  const myId = currentUser?.id ?? null;
  const { data: convsResp } = useListConversations();
  const activeConversation = convsResp?.data?.find((c) => c.id === conversationId);
  const participant = activeConversation?.participant;

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
        <div className="flex items-center justify-between border-b border-border pb-3 gap-2">
          {participant ? (
            participant.type === "user" ? (
              <Link
                href={`/users/${participant.id}`}
                className="flex items-center gap-2 min-w-0 cursor-pointer hover:underline"
                data-testid="link-conversation-header-participant"
              >
                <UserAvatar
                  avatarUrl={participant.avatarUrl}
                  displayName={participant.displayName}
                  size="xs"
                  className="shrink-0"
                  fallbackClassName="bg-slate-100 text-slate-800"
                />
                <h3
                  className="font-black tracking-tight text-base truncate"
                  data-testid="text-conversation-header-name"
                >
                  {participant.displayName}
                </h3>
              </Link>
            ) : (
              <div
                className="flex items-center gap-2 min-w-0"
                data-testid="conversation-header-participant"
              >
                <UserAvatar
                  avatarUrl={participant.avatarUrl}
                  displayName={participant.displayName}
                  size="xs"
                  className="shrink-0"
                  fallbackClassName="bg-slate-100 text-slate-800"
                />
                <h3
                  className="font-black tracking-tight text-base truncate"
                  data-testid="text-conversation-header-name"
                >
                  {participant.displayName}
                </h3>
              </div>
            )
          ) : (
            <h3
              className="font-black tracking-tight text-base"
              data-testid="text-conversation-header-name"
            >
              Conversation
            </h3>
          )}
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

        <div className="flex-1 overflow-y-auto pr-1">
          {isLoading ? (
            <Skeleton className="h-24 rounded-lg" />
          ) : messages.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              Start the conversation.
            </p>
          ) : (
            messages.map((m, i) => {
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
              const isMine = myId !== null && m.senderId === myId;
              return (
                <div
                  key={m.id}
                  data-testid={`message-${m.id}`}
                  className={`flex w-full ${groupedWithPrev ? "mt-0.5" : "mt-3"} ${
                    isMine ? "justify-end" : "justify-start"
                  }`}
                >
                  {!isMine && (
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
                      isMine ? "items-end" : "items-start"
                    }`}
                  >
                    {!isMine && !groupedWithPrev && (
                      <div className="flex items-baseline gap-2 mb-1 px-1">
                        <Link
                          href={`/users/${m.senderId}`}
                          onClick={(e) => e.stopPropagation()}
                          data-testid={`link-message-sender-${m.id}`}
                        >
                          <p className="font-bold text-xs cursor-pointer hover:underline">
                            {m.senderDisplayName}
                          </p>
                        </Link>
                        <p className="text-[10px] text-muted-foreground">
                          {timeAgo(m.createdAt)}
                        </p>
                      </div>
                    )}
                    {m.body && (
                      <div
                        className={`px-3.5 py-2 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap break-words ${
                          isMine
                            ? "brand-gradient text-primary-foreground"
                            : "bg-slate-100 text-foreground"
                        }`}
                      >
                        {m.body}
                      </div>
                    )}
                    {isMine && (
                      <p className="text-[10px] text-muted-foreground mt-0.5 px-1">
                        {timeAgo(m.createdAt)}
                      </p>
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
            })
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
  const [attachments, setAttachments] = useState<AttachmentDraft[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reset whenever the dialog opens or closes. Revoke any blob preview URLs
  // so we don't leak object URLs across compose sessions.
  useEffect(() => {
    if (!open) {
      setQuery("");
      setDebounced("");
      setRecipient(null);
      setBody("");
      setAttachments((prev) => {
        prev.forEach((a) => URL.revokeObjectURL(a.previewUrl));
        return [];
      });
      setIsUploading(false);
    }
  }, [open]);

  const onPickFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const room = ATTACHMENT_MAX_COUNT - attachments.length;
    if (room <= 0) {
      toast({
        title: "Attachment limit reached",
        description: `You can attach up to ${ATTACHMENT_MAX_COUNT} images.`,
        variant: "destructive",
      });
      return;
    }
    const incoming = Array.from(files).slice(0, room);
    const validFiles: File[] = [];
    for (const file of incoming) {
      if (!file.type.startsWith("image/")) {
        toast({
          title: "Only images are supported",
          description: `${file.name} was skipped.`,
          variant: "destructive",
        });
        continue;
      }
      if (file.size > ATTACHMENT_MAX_BYTES) {
        toast({
          title: "Image too large",
          description: `${file.name} exceeds the 5 MB limit.`,
          variant: "destructive",
        });
        continue;
      }
      validFiles.push(file);
    }
    if (validFiles.length === 0) return;
    const shrunk = await Promise.all(validFiles.map(shrinkImage));
    const accepted: AttachmentDraft[] = shrunk.map((file) => ({
      localId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      file,
      previewUrl: URL.createObjectURL(file),
    }));
    setAttachments((prev) => [...prev, ...accepted]);
  };

  const removeAttachment = (localId: string) => {
    setAttachments((prev) => {
      const target = prev.find((a) => a.localId === localId);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((a) => a.localId !== localId);
    });
  };

  // Debounce search input by ~250ms.
  useEffect(() => {
    const h = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(h);
  }, [query]);

  const enableSearch = !recipient && debounced.length >= 1;
  const { data: searchResp, isFetching: isSearching } =
    useSearchConversationContacts(
      { q: debounced, limit: 8 },
      {
        query: {
          queryKey: getSearchConversationContactsQueryKey({
            q: debounced,
            limit: 8,
          }),
          enabled: enableSearch,
        },
      },
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

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!recipient) return;
    const trimmed = body.trim();
    if (!trimmed && attachments.length === 0) return;
    let assetIds: string[] = [];
    if (attachments.length > 0) {
      setIsUploading(true);
      try {
        assetIds = await Promise.all(
          attachments.map((a) => uploadAttachment(a.file)),
        );
      } catch {
        setIsUploading(false);
        toast({
          title: "Couldn't upload attachments",
          description: "Please try again in a moment.",
          variant: "destructive",
        });
        return;
      }
      setIsUploading(false);
    }
    create.mutate({
      data: {
        recipientType: "user",
        recipientId: recipient.id,
        message: {
          ...(trimmed ? { body: trimmed } : {}),
          ...(assetIds.length > 0 ? { assetIds } : {}),
        },
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
                      <UserAvatar
                        avatarUrl={c.avatarUrl}
                        displayName={c.displayName}
                        size="md"
                        className="shrink-0"
                        fallbackClassName="bg-slate-900 text-primary-foreground"
                      />
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
              <Link
                href={`/users/${recipient.id}`}
                onClick={(e) => e.stopPropagation()}
                className="shrink-0"
                aria-label={`View ${recipient.displayName}'s profile`}
                data-testid="link-recipient-avatar"
              >
                <UserAvatar
                  avatarUrl={recipient.avatarUrl}
                  displayName={recipient.displayName}
                  size="md"
                  className="shrink-0 cursor-pointer hover:opacity-80"
                  fallbackClassName="bg-slate-900 text-primary-foreground"
                />
              </Link>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground">
                  To
                </p>
                <Link
                  href={`/users/${recipient.id}`}
                  onClick={(e) => e.stopPropagation()}
                  data-testid="link-recipient-name"
                >
                  <p className="font-bold text-sm truncate cursor-pointer hover:underline">
                    {recipient.displayName}
                  </p>
                </Link>
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
            {attachments.length > 0 && (
              <div
                className="grid grid-cols-3 gap-2"
                data-testid="new-message-attachments"
              >
                {attachments.map((a) => (
                  <div
                    key={a.localId}
                    className="relative rounded-lg overflow-hidden border border-border aspect-square bg-muted"
                    data-testid={`new-message-attachment-${a.localId}`}
                  >
                    <img
                      src={a.previewUrl}
                      alt={a.file.name}
                      className="w-full h-full object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => removeAttachment(a.localId)}
                      className="absolute top-1 right-1 bg-black/60 hover:bg-black/80 text-white rounded-full p-1"
                      aria-label="Remove attachment"
                      data-testid={`button-remove-attachment-${a.localId}`}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              data-testid="input-attachment-file"
              onChange={(e) => {
                onPickFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <div className="flex items-center justify-between gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="font-bold rounded-full gap-1.5"
                onClick={() => fileInputRef.current?.click()}
                disabled={attachments.length >= ATTACHMENT_MAX_COUNT}
                data-testid="button-attach-image"
              >
                <ImagePlus className="w-3.5 h-3.5" />
                Attach image
              </Button>
              <div className="flex gap-2">
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
                  disabled={
                    (!body.trim() && attachments.length === 0) ||
                    create.isPending ||
                    isUploading
                  }
                  className="font-bold gap-2 brand-gradient text-primary-foreground hover:opacity-95"
                  data-testid="button-send-new-message"
                >
                  <Send className="w-4 h-4" />
                  {isUploading ? "Uploading…" : "Send"}
                </Button>
              </div>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
