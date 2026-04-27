import { useEffect, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { BellOff } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Props {
  enabled: boolean;
}

// Notification preferences card on the family dashboard. Only the
// "expired confirmation email" toggle today, but factored so the
// section can grow without bloating GuardianPage.
export function EmailPrefCard({ enabled }: Props) {
  const { toast } = useToast();
  const [emailOptOut, setEmailOptOut] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const r = await customFetch<{ emailOptOut: boolean }>(
          "/api/v1/notifications/email-preference",
        );
        if (!cancelled) setEmailOptOut(!!r.emailOptOut);
      } catch {
        // ignore — leave the toggle in its default state
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const onToggle = async (silenced: boolean) => {
    // The switch represents "Email me" — when it is OFF the parent is
    // opting out of the expired-confirmation email.
    const optOut = !silenced;
    setSaving(true);
    setEmailOptOut(optOut);
    try {
      const r = await customFetch<{ emailOptOut: boolean }>(
        "/api/v1/notifications/email-preference",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ emailOptOut: optOut }),
        },
      );
      setEmailOptOut(!!r.emailOptOut);
      toast({
        title: r.emailOptOut
          ? "Expired-confirmation emails turned off"
          : "Expired-confirmation emails turned on",
      });
    } catch {
      // revert on failure
      setEmailOptOut(!optOut);
      toast({
        title: "Failed to update email preference",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="rounded-xl border-border" data-testid="card-email-pref">
      <CardContent className="p-6 space-y-3">
        <div className="flex items-center gap-2">
          <BellOff className="w-4 h-4 text-primary" />
          <h2 className="font-black tracking-tight">
            Notification preferences
          </h2>
        </div>
        {loading ? (
          <Skeleton className="h-12 rounded-lg" />
        ) : (
          <div className="flex items-start gap-3 p-3 rounded-lg border border-border">
            <div className="flex-1 min-w-0">
              <p className="font-bold text-sm">
                Email me when a confirmation link expires
              </p>
              <p className="text-xs text-muted-foreground">
                You'll always see expired links in your in-app notifications.
                Turn this off if those reminders are enough.
              </p>
            </div>
            <Switch
              checked={!emailOptOut}
              disabled={saving}
              onCheckedChange={onToggle}
              data-testid="switch-expired-email"
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
