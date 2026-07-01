import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { AdminLayout } from "@/components/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useWhoami } from "@/hooks/useWhoami";
import { CalendarClock, Loader2, Plus, Power, Send, Trash2, UserPlus } from "lucide-react";

type Recipient = {
  id: string;
  email: string;
  label: string | null;
  enabled: boolean;
  lastSentAt: string | null;
  createdAt: string;
};
type RecipientsResponse = { data: Recipient[] };

export default function AdminDailyDigest() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: who } = useWhoami();

  const { data, isLoading } = useQuery<RecipientsResponse>({
    queryKey: ["admin", "daily-digest", "recipients"],
    queryFn: () =>
      customFetch<RecipientsResponse>(`/api/v1/admin/daily-digest/recipients`, {
        method: "GET",
      }),
  });
  const recipients = data?.data ?? [];

  const { data: settings } = useQuery<{ enabled: boolean }>({
    queryKey: ["admin", "daily-digest", "settings"],
    queryFn: () =>
      customFetch<{ enabled: boolean }>(`/api/v1/admin/daily-digest/settings`, {
        method: "GET",
      }),
  });
  const digestEnabled = settings?.enabled ?? true;
  const [savingEnabled, setSavingEnabled] = useState(false);

  const [email, setEmail] = useState("");
  const [label, setLabel] = useState("");
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<Recipient | null>(null);

  const [previewTo, setPreviewTo] = useState("");
  const [sendingPreview, setSendingPreview] = useState(false);

  // Default the preview recipient to the signed-in admin's email.
  useEffect(() => {
    if (!previewTo && who?.realUser?.email) setPreviewTo(who.realUser.email);
  }, [who?.realUser?.email, previewTo]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["admin", "daily-digest", "recipients"] });
  };

  const toggleDigest = async (enabled: boolean) => {
    setSavingEnabled(true);
    try {
      await customFetch(`/api/v1/admin/daily-digest/settings`, {
        method: "PATCH",
        body: JSON.stringify({ enabled }),
      });
      qc.invalidateQueries({ queryKey: ["admin", "daily-digest", "settings"] });
      toast({
        title: enabled ? "Daily digest turned on" : "Daily digest turned off",
        description: enabled
          ? "The scheduled email will send every morning."
          : "The scheduled email is paused. You can still send previews.",
      });
    } catch (err) {
      toast({
        title: "Update failed",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSavingEnabled(false);
    }
  };

  const add = async () => {
    if (!email.trim()) {
      toast({
        title: "Email required",
        description: "Enter an email address to add a recipient.",
      });
      return;
    }
    setAdding(true);
    try {
      await customFetch(`/api/v1/admin/daily-digest/recipients`, {
        method: "POST",
        body: JSON.stringify({
          email: email.trim(),
          label: label.trim() || undefined,
        }),
      });
      setEmail("");
      setLabel("");
      toast({ title: "Recipient added" });
      refresh();
    } catch (err) {
      toast({
        title: "Couldn't add recipient",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setAdding(false);
    }
  };

  const toggle = async (r: Recipient, enabled: boolean) => {
    setBusyId(r.id);
    try {
      await customFetch(`/api/v1/admin/daily-digest/recipients/${r.id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled }),
      });
      refresh();
    } catch (err) {
      toast({
        title: "Update failed",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (r: Recipient) => {
    setBusyId(r.id);
    try {
      await customFetch(`/api/v1/admin/daily-digest/recipients/${r.id}`, {
        method: "DELETE",
      });
      toast({ title: "Recipient removed" });
      refresh();
    } catch (err) {
      toast({
        title: "Remove failed",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setBusyId(null);
      setToDelete(null);
    }
  };

  const sendPreview = async () => {
    if (!previewTo.trim()) {
      toast({
        title: "Recipient required",
        description: "Enter an email address to send the preview to.",
      });
      return;
    }
    setSendingPreview(true);
    try {
      const res = await customFetch<{ totalEvents: number; sentTo: string }>(
        `/api/v1/admin/daily-digest/send-preview`,
        {
          method: "POST",
          body: JSON.stringify({ to: previewTo.trim() }),
        },
      );
      toast({
        title: "Preview sent",
        description: `Yesterday had ${res.totalEvents} event${
          res.totalEvents === 1 ? "" : "s"
        }. Check ${res.sentTo}.`,
      });
    } catch (err) {
      toast({
        title: "Preview failed",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSendingPreview(false);
    }
  };

  return (
    <AdminLayout>
      <div className="mb-4">
        <h1 className="text-2xl font-black">Daily digest</h1>
        <p className="text-sm text-muted-foreground">
          Every morning, these recipients get an email summarizing the previous
          day's activity across Kinectem — new members, teams, recaps,
          highlights, comments, reports, and more. A summary is sent even on
          quiet days. Minors' names are masked. Emails send via the current email
          configuration.
        </p>
      </div>

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Power className="h-5 w-5" /> Scheduled digest
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="font-medium">
                {digestEnabled ? "On" : "Off"}
              </p>
              <p className="text-sm text-muted-foreground">
                {digestEnabled
                  ? "The digest emails go out automatically every morning."
                  : "The scheduled email is paused. Previews below still work."}
              </p>
            </div>
            <Switch
              checked={digestEnabled}
              disabled={savingEnabled}
              onCheckedChange={toggleDigest}
              aria-label="Daily digest enabled"
              data-testid="switch-digest-enabled"
            />
          </div>
        </CardContent>
      </Card>

      <Card className="max-w-2xl mt-4">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <UserPlus className="h-5 w-5" /> Add a recipient
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <Label
                htmlFor="digest-email"
                className="text-xs font-bold uppercase tracking-wide text-muted-foreground"
              >
                Email
              </Label>
              <Input
                id="digest-email"
                type="email"
                autoComplete="off"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="ops@kinectem.com"
                className="mt-1.5"
                data-testid="input-digest-email"
              />
            </div>
            <div className="flex-1">
              <Label
                htmlFor="digest-label"
                className="text-xs font-bold uppercase tracking-wide text-muted-foreground"
              >
                Label (optional)
              </Label>
              <Input
                id="digest-label"
                type="text"
                autoComplete="off"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Ops team"
                className="mt-1.5"
                data-testid="input-digest-label"
              />
            </div>
            <Button
              type="button"
              onClick={add}
              disabled={adding}
              data-testid="button-add-recipient"
            >
              {adding ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              Add
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="max-w-2xl mt-4">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <CalendarClock className="h-5 w-5" /> Recipients
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : recipients.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="text-no-recipients">
              No recipients yet. Add one above to start receiving the daily
              digest.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {recipients.map((r) => (
                <li
                  key={r.id}
                  className="flex items-center gap-3 py-3"
                  data-testid={`recipient-${r.id}`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{r.email}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {r.label ? `${r.label} · ` : ""}
                      {r.lastSentAt
                        ? `Last sent ${new Date(r.lastSentAt).toLocaleDateString()}`
                        : "Never sent"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={r.enabled}
                      disabled={busyId === r.id}
                      onCheckedChange={(v) => toggle(r, v)}
                      aria-label="Enabled"
                      data-testid={`switch-enabled-${r.id}`}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={busyId === r.id}
                      onClick={() => setToDelete(r)}
                      data-testid={`button-delete-${r.id}`}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card className="max-w-2xl mt-4">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Send className="h-5 w-5" /> Send preview now
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Builds yesterday's digest right now and emails it to a single
            address so you can see exactly what recipients receive. This does not
            email the whole list.
          </p>
          <div>
            <Label
              htmlFor="preview-to"
              className="text-xs font-bold uppercase tracking-wide text-muted-foreground"
            >
              Send to
            </Label>
            <Input
              id="preview-to"
              type="email"
              autoComplete="off"
              value={previewTo}
              onChange={(e) => setPreviewTo(e.target.value)}
              placeholder="you@example.com"
              className="mt-1.5"
              data-testid="input-preview-to"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={sendPreview}
            disabled={sendingPreview}
            data-testid="button-send-preview"
          >
            {sendingPreview ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            Send preview
          </Button>
        </CardContent>
      </Card>

      <AlertDialog
        open={!!toDelete}
        onOpenChange={(open) => !open && setToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove recipient?</AlertDialogTitle>
            <AlertDialogDescription>
              {toDelete?.email} will no longer receive the daily digest. You can
              re-add them later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => toDelete && remove(toDelete)}
              data-testid="button-confirm-delete"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminLayout>
  );
}
