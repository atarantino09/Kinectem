import { useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { useWhoami } from "@/hooks/useWhoami";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

export function MasqueradeBanner() {
  const { data: who } = useWhoami();
  const qc = useQueryClient();
  const { toast } = useToast();

  if (!who?.isMasquerading || !who.viewingAs || !who.realUser) return null;

  const stop = async () => {
    try {
      await customFetch("/api/v1/admin/masquerade/stop", { method: "POST" });
      toast({ title: "Masquerade stopped" });
      await qc.invalidateQueries();
      if (typeof window !== "undefined") {
        const base = import.meta.env.BASE_URL.replace(/\/$/, "");
        window.location.assign(`${base}/admin`);
      }
    } catch (err) {
      toast({
        title: "Failed to stop masquerade",
        description: (err as Error).message,
        variant: "destructive",
      });
    }
  };

  return (
    <div
      data-testid="masquerade-banner"
      className="bg-amber-500 text-amber-950 border-b border-amber-700 px-4 py-2 flex items-center justify-between gap-4"
    >
      <div className="text-sm font-semibold">
        You are viewing the site as{" "}
        <span className="font-black">{who.viewingAs.name}</span> ({who.viewingAs.email}).
        Your real account is{" "}
        <span className="font-black">{who.realUser.name}</span>.
      </div>
      <Button
        size="sm"
        variant="outline"
        className="border-amber-900 text-amber-950 hover:bg-amber-400 bg-amber-300"
        onClick={stop}
        data-testid="btn-stop-masquerade"
      >
        Stop masquerading
      </Button>
    </div>
  );
}
