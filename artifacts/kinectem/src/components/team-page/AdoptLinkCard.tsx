import { useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

// Coach-facing control on a solo team: mint a one-time shareable link that
// lets the coach's organization admin (who may not be on the team) adopt this
// team into their org. The coach hands the link off out-of-band; the admin
// confirms which org on the `/adopt-team/<token>` landing page. The link is
// single-use and the coach can regenerate it to revoke an outstanding one.
// Hand-written customFetch — these endpoints have no openapi.yaml entry.
export function AdoptLinkCard({ teamId }: { teamId: string }) {
  const { toast } = useToast();
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const link = token
    ? `${window.location.origin}${import.meta.env.BASE_URL}adopt-team/${token}`
    : "";

  async function generate(rotate: boolean) {
    setLoading(true);
    try {
      const res = await customFetch<{ ok: boolean; token: string }>(
        `/api/v1/teams/${teamId}/adopt-link`,
        { method: "POST", body: JSON.stringify({ rotate }) },
      );
      setToken(res.token);
      if (rotate) {
        toast({
          title: "New link generated",
          description: "The previous link no longer works.",
        });
      }
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Couldn't create link",
        description:
          err instanceof Error
            ? err.message
            : "Something went wrong. Please try again.",
      });
    } finally {
      setLoading(false);
    }
  }

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      toast({ title: "Link copied" });
    } catch {
      toast({
        variant: "destructive",
        title: "Couldn't copy",
        description: "Copy the link manually instead.",
      });
    }
  }

  if (!token) {
    return (
      <button
        type="button"
        onClick={() => generate(false)}
        disabled={loading}
        className="text-xs font-bold uppercase tracking-wider text-sky-700 hover:underline disabled:opacity-60"
        data-testid="button-create-adopt-link"
      >
        {loading ? "Creating link…" : "Send an adopt link to your club →"}
      </button>
    );
  }

  return (
    <div className="space-y-2 pt-1">
      <p className="text-xs text-sky-800">
        Share this one-time link with your organization's admin so they can
        adopt this team. It works once.
      </p>
      <div className="flex items-center gap-2">
        <Input
          readOnly
          value={link}
          onFocus={(e) => e.currentTarget.select()}
          className="h-8 text-xs"
          data-testid="input-adopt-link"
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={copy}
          className="font-bold shrink-0"
          data-testid="button-copy-adopt-link"
        >
          Copy
        </Button>
      </div>
      <button
        type="button"
        onClick={() => generate(true)}
        disabled={loading}
        className="text-xs font-bold uppercase tracking-wider text-sky-700 hover:underline disabled:opacity-60"
        data-testid="button-regenerate-adopt-link"
      >
        {loading ? "Regenerating…" : "Regenerate link"}
      </button>
    </div>
  );
}
