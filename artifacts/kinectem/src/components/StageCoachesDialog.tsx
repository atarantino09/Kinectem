import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiErrorMessage } from "@/lib/api-errors";

// Task #808 — platform-admin tool on an UNCLAIMED org: pre-stage coach
// emails per team. Pure drafts — nothing is emailed, no roster entries or
// invites exist until the future owner claims the org and confirms them in
// the post-claim CoachSetupDialog. Hand-written customFetch; these
// endpoints are extra beyond the locked openapi.yaml.

export type StagedCoachRow = { id: string; teamId: string; email: string };

export function parseStagedEmails(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const piece of raw.split(/[\n,;\s]+/g)) {
    const email = piece.trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    out.push(email);
  }
  return out;
}

export const STAGED_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function useStagedCoaches(orgId: string, enabled: boolean) {
  return useQuery<{ data: StagedCoachRow[] }>({
    queryKey: ["staged-coaches", orgId],
    enabled: !!orgId && enabled,
    queryFn: () =>
      customFetch<{ data: StagedCoachRow[] }>(
        `/api/v1/organizations/${orgId}/staged-coaches`,
        { method: "GET" },
      ),
  });
}

export function StageCoachesDialog({
  orgId,
  teams,
  open,
  onOpenChange,
}: {
  orgId: string;
  teams: Array<{ id: string; name: string }>;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const staged = useStagedCoaches(orgId, open);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [hydratedFor, setHydratedFor] = useState<string | null>(null);

  // Hydrate the textareas from the saved drafts once per open.
  useEffect(() => {
    if (!open) {
      setHydratedFor(null);
      return;
    }
    if (hydratedFor === orgId || !staged.data) return;
    const byTeam: Record<string, string[]> = {};
    for (const row of staged.data.data) {
      (byTeam[row.teamId] ??= []).push(row.email);
    }
    const next: Record<string, string> = {};
    for (const t of teams) next[t.id] = (byTeam[t.id] ?? []).join("\n");
    setDrafts(next);
    setHydratedFor(orgId);
  }, [open, staged.data, hydratedFor, orgId, teams]);

  const invalidEmails = useMemo(() => {
    const bad: string[] = [];
    for (const t of teams) {
      for (const e of parseStagedEmails(drafts[t.id] ?? "")) {
        if (!STAGED_EMAIL_RE.test(e)) bad.push(e);
      }
    }
    return bad;
  }, [drafts, teams]);

  const totalCount = useMemo(
    () =>
      teams.reduce(
        (n, t) => n + parseStagedEmails(drafts[t.id] ?? "").length,
        0,
      ),
    [drafts, teams],
  );

  const onSave = async () => {
    if (saving) return;
    if (invalidEmails.length > 0) {
      toast({
        title: `Invalid email: ${invalidEmails[0]}`,
        variant: "destructive",
      });
      return;
    }
    setSaving(true);
    try {
      await customFetch(`/api/v1/organizations/${orgId}/staged-coaches`, {
        method: "PUT",
        body: JSON.stringify({
          entries: teams.map((t) => ({
            teamId: t.id,
            emails: parseStagedEmails(drafts[t.id] ?? "").filter((e) =>
              STAGED_EMAIL_RE.test(e),
            ),
          })),
        }),
      });
      await qc.invalidateQueries({ queryKey: ["staged-coaches", orgId] });
      toast({
        title:
          totalCount === 0
            ? "Staged coaches cleared"
            : `${totalCount} coach${totalCount === 1 ? "" : "es"} staged`,
        description:
          totalCount === 0
            ? undefined
            : "Nothing is sent yet — invites go out after the owner claims the org and confirms.",
      });
      onOpenChange(false);
    } catch (err) {
      toast({
        title: apiErrorMessage(err) ?? "Couldn't save staged coaches",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !saving && onOpenChange(v)}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-black tracking-tight">
            Stage coaches
          </DialogTitle>
          <DialogDescription>
            Enter coach emails for each team. These are saved as drafts only —
            no invite is sent until the organization's owner claims the page
            and confirms the list.
          </DialogDescription>
        </DialogHeader>
        {teams.length === 0 ? (
          <p
            className="text-sm text-muted-foreground"
            data-testid="text-stage-coaches-no-teams"
          >
            Add teams to this organization first, then stage coaches for them.
          </p>
        ) : (
          <div className="space-y-4">
            {teams.map((t) => (
              <div key={t.id} className="space-y-1.5">
                <Label
                  htmlFor={`stage-coaches-${t.id}`}
                  className="font-bold"
                >
                  {t.name}
                </Label>
                <Textarea
                  id={`stage-coaches-${t.id}`}
                  rows={2}
                  placeholder="coach@example.com, assistant@example.com"
                  value={drafts[t.id] ?? ""}
                  onChange={(e) =>
                    setDrafts((d) => ({ ...d, [t.id]: e.target.value }))
                  }
                  disabled={saving}
                  data-testid={`textarea-stage-coaches-${t.id}`}
                />
              </div>
            ))}
            {invalidEmails.length > 0 && (
              <p
                className="text-xs font-medium text-destructive"
                data-testid="text-stage-coaches-invalid"
              >
                Invalid email{invalidEmails.length === 1 ? "" : "s"}:{" "}
                {invalidEmails.slice(0, 3).join(", ")}
              </p>
            )}
          </div>
        )}
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="brand"
            onClick={onSave}
            disabled={saving || teams.length === 0 || invalidEmails.length > 0}
            data-testid="btn-stage-coaches-save"
          >
            {saving ? "Saving…" : "Save drafts"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
