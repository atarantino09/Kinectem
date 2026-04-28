import { useRef, useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateOrganization,
  useGetLoggedInUser,
  getListOrganizationsQueryKey,
  getListUserOrganizationsQueryKey,
  type CreateOrganizationRequestState,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  shrinkImageToDataUrl,
  IMAGE_UPLOAD_MAX_BYTES,
} from "@/lib/shrinkImage";
import { US_STATES, US_ZIP_PATTERN } from "@/lib/usStates";

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
  const [zipCode, setZipCode] = useState("");
  const [slugDirty, setSlugDirty] = useState(false);
  const [logoUrl, setLogoUrl] = useState<string>("");
  const [errors, setErrors] = useState<{
    name?: string;
    city?: string;
    state?: string;
    zipCode?: string;
  }>({});
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const createOrg = useCreateOrganization();
  const { data: me } = useGetLoggedInUser();

  const reset = () => {
    setName("");
    setSlug("");
    setDescription("");
    setWebsite("");
    setCity("");
    setState("");
    setZipCode("");
    setSlugDirty(false);
    setLogoUrl("");
    setErrors({});
  };

  const onPickLogo = () => fileInputRef.current?.click();
  const onLogoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast({ title: "Please pick an image file", variant: "destructive" });
      return;
    }
    if (file.size > IMAGE_UPLOAD_MAX_BYTES) {
      toast({ title: "Image must be under 5 MB", variant: "destructive" });
      return;
    }
    try {
      const dataUrl = await shrinkImageToDataUrl(file);
      setLogoUrl(dataUrl);
    } catch {
      toast({ title: "Couldn't read that image", variant: "destructive" });
    }
  };

  const onNameChange = (v: string) => {
    setName(v);
    if (!slugDirty) setSlug(slugify(v));
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const finalSlug = slug || slugify(name);
    const trimmedName = name.trim();
    const trimmedCity = city.trim();
    const trimmedZip = zipCode.trim();
    const nextErrors: typeof errors = {};
    if (!trimmedName || !finalSlug) nextErrors.name = "Name is required";
    if (!trimmedCity) nextErrors.city = "City is required";
    if (!state) nextErrors.state = "State is required";
    if (!trimmedZip) {
      nextErrors.zipCode = "Zip code is required";
    } else if (!US_ZIP_PATTERN.test(trimmedZip)) {
      nextErrors.zipCode = "Enter a US zip (12345 or 12345-6789)";
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      const first =
        nextErrors.name ??
        nextErrors.city ??
        nextErrors.state ??
        nextErrors.zipCode ??
        "Please fix the highlighted fields";
      toast({ title: first, variant: "destructive" });
      return;
    }
    try {
      const org = await createOrg.mutateAsync({
        data: {
          name: trimmedName,
          slug: finalSlug,
          description: description.trim() || undefined,
          website: website.trim() || undefined,
          city: trimmedCity,
          state: state as CreateOrganizationRequestState,
          zipCode: trimmedZip,
          logoUrl: logoUrl || undefined,
        },
      });
      toast({
        title: "Organization created!",
        description:
          "You're the owner. Add admins or transfer ownership any time from Manage members.",
      });
      await Promise.all([
        qc.invalidateQueries({ queryKey: getListOrganizationsQueryKey() }),
        me?.id
          ? qc.invalidateQueries({
              queryKey: getListUserOrganizationsQueryKey(me.id),
            })
          : Promise.resolve(),
      ]);
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
              <Label className="font-bold">Logo</Label>
              <div className="flex items-center gap-3">
                <div className="w-16 h-16 rounded-xl border-2 border-dashed border-border bg-muted/30 flex items-center justify-center overflow-hidden shrink-0">
                  {logoUrl ? (
                    <img
                      src={logoUrl}
                      alt="Logo preview"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                      Logo
                    </span>
                  )}
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={onLogoChange}
                  data-testid="input-org-logo"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="font-bold rounded-full"
                  onClick={onPickLogo}
                  data-testid="btn-pick-org-logo"
                >
                  {logoUrl ? "Change" : "Upload logo"}
                </Button>
                {logoUrl && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground"
                    onClick={() => setLogoUrl("")}
                  >
                    Remove
                  </Button>
                )}
              </div>
            </div>
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
              {errors.name && (
                <p
                  className="text-xs font-medium text-destructive"
                  data-testid="error-org-name"
                >
                  {errors.name}
                </p>
              )}
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
              <div className="space-y-1.5">
                <Label htmlFor="org-city" className="font-bold">
                  City
                  <span className="text-destructive ml-0.5" aria-hidden>
                    *
                  </span>
                </Label>
                <Input
                  id="org-city"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="Westfield"
                  data-testid="input-org-city"
                />
                {errors.city && (
                  <p
                    className="text-xs font-medium text-destructive"
                    data-testid="error-org-city"
                  >
                    {errors.city}
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="org-state" className="font-bold">
                  State
                  <span className="text-destructive ml-0.5" aria-hidden>
                    *
                  </span>
                </Label>
                <Select value={state} onValueChange={setState}>
                  <SelectTrigger
                    id="org-state"
                    data-testid="input-org-state"
                    aria-label="State"
                  >
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    {US_STATES.map((s) => (
                      <SelectItem
                        key={s.code}
                        value={s.code}
                        data-testid={`option-org-state-${s.code}`}
                      >
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.state && (
                  <p
                    className="text-xs font-medium text-destructive"
                    data-testid="error-org-state"
                  >
                    {errors.state}
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="org-zip" className="font-bold">
                  Zip
                  <span className="text-destructive ml-0.5" aria-hidden>
                    *
                  </span>
                </Label>
                <Input
                  id="org-zip"
                  value={zipCode}
                  onChange={(e) => setZipCode(e.target.value)}
                  placeholder="07090"
                  inputMode="numeric"
                  maxLength={10}
                  data-testid="input-org-zip"
                />
                {errors.zipCode && (
                  <p
                    className="text-xs font-medium text-destructive"
                    data-testid="error-org-zip"
                  >
                    {errors.zipCode}
                  </p>
                )}
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
              variant="brand"
              disabled={createOrg.isPending}
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
