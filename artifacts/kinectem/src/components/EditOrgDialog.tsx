import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  customFetch,
  getGetOrganizationByIdQueryKey,
} from "@workspace/api-client-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

type OrgLike = {
  id: string;
  name: string;
  description?: string | null;
  website?: string | null;
  city?: string | null;
  state?: string | null;
};

export function EditOrgDialog({
  organization,
  open,
  onOpenChange,
}: {
  organization: OrgLike;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [name, setName] = useState(organization.name);
  const [description, setDescription] = useState(organization.description ?? "");
  const [website, setWebsite] = useState(organization.website ?? "");
  const [city, setCity] = useState(organization.city ?? "");
  const [state, setState] = useState(organization.state ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName(organization.name);
      setDescription(organization.description ?? "");
      setWebsite(organization.website ?? "");
      setCity(organization.city ?? "");
      setState(organization.state ?? "");
    }
  }, [open, organization]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast({ title: "Name is required", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await customFetch(`/api/v1/organizations/${organization.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description,
          website,
          city,
          state,
        }),
      });
      await qc.invalidateQueries({
        queryKey: getGetOrganizationByIdQueryKey(organization.id),
      });
      toast({ title: "Organization updated" });
      onOpenChange(false);
    } catch {
      toast({ title: "Failed to update organization", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={onSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle className="font-black tracking-tight">
              Edit organization
            </DialogTitle>
            <DialogDescription>
              Update your organization's details.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="edit-org-name" className="font-bold">
                Name
              </Label>
              <Input
                id="edit-org-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
                data-testid="input-edit-org-name"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-org-desc" className="font-bold">
                Description
              </Label>
              <Textarea
                id="edit-org-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                data-testid="input-edit-org-description"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-org-website" className="font-bold">
                Website
              </Label>
              <Input
                id="edit-org-website"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                placeholder="https://example.com"
                data-testid="input-edit-org-website"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="edit-org-city" className="font-bold">
                  City
                </Label>
                <Input
                  id="edit-org-city"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  data-testid="input-edit-org-city"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-org-state" className="font-bold">
                  State
                </Label>
                <Input
                  id="edit-org-state"
                  value={state}
                  onChange={(e) => setState(e.target.value)}
                  data-testid="input-edit-org-state"
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={saving}
              className="font-bold"
              data-testid="btn-save-edit-org"
            >
              {saving ? "Saving..." : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
