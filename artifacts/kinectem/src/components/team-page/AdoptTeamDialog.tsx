import { useMemo, useState } from "react";
import {
  customFetch,
  useGetLoggedInUser,
  useListUserOrganizations,
  queryOpts,
} from "@workspace/api-client-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

// Task #628 — lets an org owner/admin adopt a solo (org-less) team into one of
// their organizations, reparenting it so it keeps its roster + recap history
// and unlocks full features. Hand-written customFetch — no openapi.yaml entry.
export function AdoptTeamDialog({
  teamId,
  open,
  onOpenChange,
  onAdopted,
}: {
  teamId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdopted: () => void;
}) {
  const { toast } = useToast();
  const { data: me } = useGetLoggedInUser();
  const { data: orgsResp } = useListUserOrganizations(me?.id ?? "", undefined, {
    query: queryOpts({ enabled: !!me?.id && open }),
  });
  const manageableOrgs = useMemo(
    () =>
      (orgsResp?.data ?? []).filter(
        (o) => o.role === "owner" || o.role === "admin",
      ),
    [orgsResp],
  );
  const [orgId, setOrgId] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleAdopt() {
    if (!orgId) return;
    setSubmitting(true);
    try {
      await customFetch<{ ok: boolean; teamId: string }>(
        `/api/v1/teams/${teamId}/adopt`,
        {
          method: "POST",
          body: JSON.stringify({ organizationId: orgId }),
        },
      );
      toast({
        title: "Team adopted",
        description:
          "This team is now part of your organization with full features.",
      });
      onOpenChange(false);
      onAdopted();
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Couldn't adopt team",
        description:
          err instanceof Error
            ? err.message
            : "Something went wrong. Please try again.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="dialog-adopt-team">
        <DialogHeader>
          <DialogTitle>Adopt this team into your organization</DialogTitle>
          <DialogDescription>
            Reparent this independent team into one of your organizations. It
            keeps its roster and recap history, and recap authoring is no longer
            limited to the tournament window.
          </DialogDescription>
        </DialogHeader>
        {manageableOrgs.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="text-no-orgs">
            You need to be an owner or admin of an organization to adopt a team.
          </p>
        ) : (
          <Select value={orgId} onValueChange={setOrgId}>
            <SelectTrigger data-testid="select-adopt-org">
              <SelectValue placeholder="Choose an organization" />
            </SelectTrigger>
            <SelectContent>
              {manageableOrgs.map((o) => (
                <SelectItem
                  key={o.id}
                  value={o.id}
                  data-testid={`option-adopt-org-${o.id}`}
                >
                  {o.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            data-testid="button-adopt-cancel"
          >
            Cancel
          </Button>
          <Button
            onClick={handleAdopt}
            disabled={!orgId || submitting || manageableOrgs.length === 0}
            data-testid="button-adopt-confirm"
          >
            {submitting ? "Adopting…" : "Adopt team"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
