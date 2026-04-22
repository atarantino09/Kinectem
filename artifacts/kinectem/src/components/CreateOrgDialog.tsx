import { useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateOrganization,
  getListOrganizationsQueryKey,
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

function slugify(s: string) {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

export function CreateOrgDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [website, setWebsite] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [slugDirty, setSlugDirty] = useState(false);

  const createOrg = useCreateOrganization();

  const reset = () => {
    setName("");
    setSlug("");
    setDescription("");
    setWebsite("");
    setCity("");
    setState("");
    setSlugDirty(false);
  };

  const onNameChange = (v: string) => {
    setName(v);
    if (!slugDirty) setSlug(slugify(v));
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const finalSlug = slug || slugify(name);
    if (!name.trim() || !finalSlug) {
      toast({ title: "Name is required", variant: "destructive" });
      return;
    }
    try {
      const org = await createOrg.mutateAsync({
        data: {
          name: name.trim(),
          slug: finalSlug,
          description: description.trim() || undefined,
          website: website.trim() || undefined,
          city: city.trim() || undefined,
          state: state.trim() || undefined,
        } as never,
      });
      toast({ title: "Organization created!" });
      await qc.invalidateQueries({ queryKey: getListOrganizationsQueryKey() });
      reset();
      onOpenChange(false);
      setLocation(`/organizations/${org.id}`);
    } catch {
      toast({ title: "Failed to create organization", variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={onSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle className="font-black tracking-tight">
              New organization
            </DialogTitle>
            <DialogDescription>
              Create a club, school, or program page. You'll be its owner.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="org-name" className="font-bold">
                Name
              </Label>
              <Input
                id="org-name"
                value={name}
                onChange={(e) => onNameChange(e.target.value)}
                placeholder="Westfield Athletic Club"
                autoFocus
                data-testid="input-org-name"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="org-slug" className="font-bold">
                URL handle
              </Label>
              <Input
                id="org-slug"
                value={slug}
                onChange={(e) => {
                  setSlug(slugify(e.target.value));
                  setSlugDirty(true);
                }}
                placeholder="westfield-athletic-club"
                data-testid="input-org-slug"
              />
              <p className="text-xs text-muted-foreground">
                kinectem.com/<span className="font-mono">{slug || "your-org"}</span>
              </p>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5 col-span-2">
                <Label htmlFor="org-city" className="font-bold">
                  City
                </Label>
                <Input
                  id="org-city"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="Westfield"
                  data-testid="input-org-city"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="org-state" className="font-bold">
                  State
                </Label>
                <Input
                  id="org-state"
                  value={state}
                  onChange={(e) =>
                    setState(e.target.value.toUpperCase().slice(0, 2))
                  }
                  placeholder="NJ"
                  maxLength={2}
                  data-testid="input-org-state"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="org-desc" className="font-bold">
                Description
              </Label>
              <Textarea
                id="org-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What does your organization do?"
                rows={3}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="org-web" className="font-bold">
                Website
              </Label>
              <Input
                id="org-web"
                type="url"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                placeholder="https://example.com"
              />
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
              disabled={createOrg.isPending}
              className="font-bold"
              data-testid="btn-create-org"
            >
              {createOrg.isPending ? "Creating..." : "Create organization"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
