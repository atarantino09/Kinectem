import { useEffect, useId, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

export type AdminAddedTeam = { id: string; name: string };

/** Quick team creation without leaving the admin organization/import review. */
export function AdminAddTeam({
  organizationId,
  organizationName,
  onCreated,
}: {
  organizationId: string;
  organizationName: string;
  onCreated?: (team: AdminAddedTeam) => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const submitting = useRef(false);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastAdded, setLastAdded] = useState<string | null>(null);
  const inputId = useId();

  useEffect(() => {
    if (open && !busy) inputRef.current?.focus();
  }, [open, busy]);

  const addTeam = async (event: React.FormEvent) => {
    event.preventDefault();
    const teamName = name.trim();
    if (!teamName || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      const team = await customFetch<AdminAddedTeam>(
        `/api/v1/organizations/${organizationId}/teams`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: teamName }),
        },
      );
      setName("");
      setLastAdded(team.name);
      onCreated?.(team);
      toast({ title: "Team added", description: `${team.name} added to ${organizationName}.` });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["admin", "partner-pages"] }),
        qc.invalidateQueries({ queryKey: ["admin", "organizations"] }),
        qc.invalidateQueries({ queryKey: [`/api/v1/organizations/${organizationId}/teams`] }),
        qc.invalidateQueries({ queryKey: ["org-plan-usage", organizationId] }),
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't add the team. Please try again.");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  return (
    <div className="mt-2 space-y-2" data-testid={`admin-add-team-${organizationId}`}>
      {!open ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-label={`Add team to ${organizationName}`}
          onClick={() => setOpen(true)}
        >
          <Plus className="mr-1 h-4 w-4" /> Add team
        </Button>
      ) : (
        <form onSubmit={addTeam} aria-label={`Add team to ${organizationName}`} className="space-y-2">
          <Label htmlFor={inputId}>Team name</Label>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              ref={inputRef}
              id={inputId}
              value={name}
              maxLength={200}
              placeholder="e.g. U14 Girls"
              className="min-w-0 flex-1 basis-40"
              disabled={busy}
              aria-invalid={!!error}
              aria-describedby={error ? `${inputId}-error` : undefined}
              onChange={(event) => {
                setName(event.target.value);
                setError(null);
              }}
            />
            <Button type="submit" size="sm" disabled={busy || !name.trim()} aria-busy={busy}>
              {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              {busy ? "Adding…" : "Add"}
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => {
              setOpen(false);
              setName("");
              setError(null);
            }}>
              Done
            </Button>
          </div>
          {error && <p id={`${inputId}-error`} role="alert" className="text-sm text-destructive">{error}</p>}
        </form>
      )}
      {lastAdded && <p role="status" className="text-xs text-emerald-700">Added {lastAdded}.</p>}
    </div>
  );
}
