import { useMemo, useState } from "react";
import {
  Check,
  Copy,
  ExternalLink,
  Facebook,
  Instagram,
  Link as LinkIcon,
  Share2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

type CopiedValue = "message" | "link" | null;

export function buildOrganizationPageUrl(orgId: string): string {
  if (typeof window === "undefined") return "";
  const basePath = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
  return `${window.location.origin}${basePath}/organizations/${orgId}`;
}

export function buildOrganizationShareMessage(
  organizationName: string,
  pageUrl: string,
): string {
  return `Follow ${organizationName} on Kinectem — the youth-sports platform where your season's story comes to life. Sign up to keep up with team updates, game recaps, and the moments that matter: ${pageUrl}`;
}

async function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("Your browser blocked copying.");
}

export function OrgPageShareDialog({
  orgId,
  organizationName,
  open,
  onOpenChange,
}: {
  orgId: string;
  organizationName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const [copiedValue, setCopiedValue] = useState<CopiedValue>(null);
  const pageUrl = useMemo(() => buildOrganizationPageUrl(orgId), [orgId]);
  const message = useMemo(
    () => buildOrganizationShareMessage(organizationName, pageUrl),
    [organizationName, pageUrl],
  );
  const canNativeShare =
    typeof navigator !== "undefined" && typeof navigator.share === "function";

  const confirmCopy = async (kind: Exclude<CopiedValue, null>, text: string) => {
    try {
      await copyToClipboard(text);
      setCopiedValue(kind);
      window.setTimeout(() => setCopiedValue(null), 1800);
      toast({
        title: kind === "message" ? "Message copied" : "Link copied",
        description:
          kind === "message"
            ? "Paste it into Facebook, Instagram, email, or a message."
            : "Your organization page link is ready to share.",
      });
    } catch {
      toast({
        title: "Couldn't copy",
        description: "Select the text and copy it manually.",
        variant: "destructive",
      });
    }
  };

  const handleNativeShare = async () => {
    if (!canNativeShare) return;
    try {
      await navigator.share({
        title: `Follow ${organizationName} on Kinectem`,
        text: `Follow ${organizationName} on Kinectem — the youth-sports platform where your season's story comes to life. Sign up to keep up with team updates, game recaps, and the moments that matter.`,
        url: pageUrl,
      });
    } catch (error) {
      if ((error as { name?: string }).name === "AbortError") return;
      toast({
        title: "Couldn't open sharing",
        description: "Copy the message and link below instead.",
        variant: "destructive",
      });
    }
  };

  const handleFacebookShare = () => {
    const facebookUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(pageUrl)}`;
    window.open(facebookUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-xl min-w-0 max-h-[calc(100dvh-2rem)] overflow-y-auto"
        data-testid="dialog-share-organization-page"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-black tracking-tight">
            <Share2 className="h-5 w-5 text-primary shrink-0" />
            Share your organization page
          </DialogTitle>
          <DialogDescription>
            Invite your community to sign up, follow {organizationName}, and
            keep up with every season on Kinectem.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 min-w-0">
          <div className="space-y-2">
            <label
              htmlFor="organization-share-message"
              className="text-xs font-bold uppercase tracking-wide text-muted-foreground"
            >
              Ready-to-post message
            </label>
            <Textarea
              id="organization-share-message"
              value={message}
              readOnly
              className="min-h-28 resize-none text-sm leading-relaxed"
              data-testid="text-org-share-message"
            />
            <Button
              type="button"
              variant="brand"
              className="w-full font-bold"
              onClick={() => confirmCopy("message", message)}
              data-testid="btn-copy-org-share-message"
            >
              {copiedValue === "message" ? (
                <Check className="mr-2 h-4 w-4" />
              ) : (
                <Copy className="mr-2 h-4 w-4" />
              )}
              {copiedValue === "message" ? "Copied!" : "Copy message & link"}
            </Button>
          </div>

          <div className="space-y-2">
            <label
              htmlFor="organization-share-link"
              className="text-xs font-bold uppercase tracking-wide text-muted-foreground"
            >
              Organization page link
            </label>
            <div className="flex gap-2 min-w-0">
              <Input
                id="organization-share-link"
                value={pageUrl}
                readOnly
                className="min-w-0"
                data-testid="input-org-share-link"
              />
              <Button
                type="button"
                variant="outline"
                className="shrink-0 font-bold"
                onClick={() => confirmCopy("link", pageUrl)}
                data-testid="btn-copy-org-share-link"
              >
                {copiedValue === "link" ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <LinkIcon className="h-4 w-4" />
                )}
                <span className="sr-only">Copy organization page link</span>
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {canNativeShare && (
              <Button
                type="button"
                variant="outline"
                className="font-bold"
                onClick={handleNativeShare}
                data-testid="btn-native-share-org-page"
              >
                <Share2 className="mr-2 h-4 w-4" /> Share from this device
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              className="font-bold"
              onClick={handleFacebookShare}
              data-testid="btn-facebook-share-org-page"
            >
              <Facebook className="mr-2 h-4 w-4" /> Share on Facebook
              <ExternalLink className="ml-2 h-3.5 w-3.5 opacity-70" />
            </Button>
          </div>

          <div
            className="rounded-lg border border-border bg-muted/50 p-3 text-sm"
            data-testid="org-share-instagram-note"
          >
            <div className="flex items-center gap-2 font-bold">
              <Instagram className="h-4 w-4 text-primary" /> Posting to
              Instagram?
            </div>
            <p className="mt-1 text-muted-foreground">
              Instagram does not support pre-filled web posts. Copy the message
              above, then paste it into a post, story, bio, or direct message.
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}