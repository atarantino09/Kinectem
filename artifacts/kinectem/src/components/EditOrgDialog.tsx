import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  customFetch,
  getGetOrganizationByIdQueryKey,
  type UpdateOrganizationRequestState,
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
import { getInitials } from "@/lib/format";
import {
  shrinkImageToDataUrl,
  IMAGE_UPLOAD_MAX_BYTES,
} from "@/lib/shrinkImage";
import { US_STATES, US_ZIP_PATTERN } from "@/lib/usStates";

type OrgLike = {
  id: string;
  name: string;
  description?: string | null;
  website?: string | null;
  city?: string | null;
  state?: string | null;
  zipCode?: string | null;
  logoUrl?: string | null;
  role?: string | null;
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
  const [zipCode, setZipCode] = useState(organization.zipCode ?? "");
  const [errors, setErrors] = useState<{
    name?: string;
    city?: string;
    state?: string;
    zipCode?: string;
  }>({});
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const canManageLogo =
    organization.role === "admin" || organization.role === "owner";

  useEffect(() => {
    if (open) {
      setName(organization.name);
      setDescription(organization.description ?? "");
      setWebsite(organization.website ?? "");
      setCity(organization.city ?? "");
      setState(organization.state ?? "");
      setZipCode(organization.zipCode ?? "");
      setErrors({});
    }
    // Only re-seed the form when the dialog transitions to open, or when
    // a different org is being edited. Refetches caused by in-dialog logo
    // changes must not wipe the user's unsaved text edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, organization.id]);

  const onPickPhoto = () => fileInputRef.current?.click();

  const onRemovePhoto = async () => {
    setUploading(true);
    try {
      await customFetch(`/api/v1/organizations/${organization.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ logoUrl: null }),
      });
      await qc.invalidateQueries({
        queryKey: getGetOrganizationByIdQueryKey(organization.id),
      });
      toast({ title: "Logo removed" });
    } catch {
      toast({ title: "Failed to remove logo", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const onPhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
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
    setUploading(true);
    try {
      const dataUrl = await shrinkImageToDataUrl(file);
      await customFetch(`/api/v1/organizations/${organization.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ logoUrl: dataUrl }),
      });
      await qc.invalidateQueries({
        queryKey: getGetOrganizationByIdQueryKey(organization.id),
      });
      toast({ title: "Logo updated" });
    } catch {
      toast({ title: "Failed to upload logo", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    const trimmedCity = city.trim();
    const trimmedZip = zipCode.trim();
    // Task #237 — keep parity with CreateOrgDialog: city/state/zip are
    // required and zip must look like 12345 or 12345-6789. The server
    // enforces the same rules, so any drift between the two is a bug.
    const nextErrors: typeof errors = {};
    if (!trimmedName) nextErrors.name = "Name is required";
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
    setSaving(true);
    try {
      const trimmedWebsite = website.trim();
      const payload: Record<string, string> = {
        name: trimmedName,
        description,
        city: trimmedCity,
        state: state as UpdateOrganizationRequestState,
        zipCode: trimmedZip,
      };
      if (trimmedWebsite) payload.website = trimmedWebsite;
      await customFetch(`/api/v1/organizations/${organization.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
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
            {canManageLogo && (
              <div className="space-y-1.5">
                <Label className="font-bold">Logo</Label>
                <div className="flex items-center gap-3">
                  <div className="w-16 h-16 bg-muted rounded-xl border border-border flex items-center justify-center overflow-hidden shrink-0">
                    {organization.logoUrl ? (
                      <img
                        src={organization.logoUrl}
                        alt={`${organization.name} logo`}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="text-xl font-black text-primary tracking-tighter">
                        {getInitials(organization.name)}
                      </div>
                    )}
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={onPhotoChange}
                    data-testid="input-org-logo"
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="font-bold rounded-full"
                      onClick={onPickPhoto}
                      disabled={uploading}
                      data-testid="btn-upload-org-logo"
                    >
                      {uploading
                        ? "Working..."
                        : organization.logoUrl
                          ? "Change logo"
                          : "Upload logo"}
                    </Button>
                    {organization.logoUrl && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="font-bold rounded-full"
                        onClick={onRemovePhoto}
                        disabled={uploading}
                        data-testid="btn-remove-org-logo"
                      >
                        Remove logo
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            )}
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
              {errors.name && (
                <p
                  className="text-xs font-medium text-destructive"
                  data-testid="error-edit-org-name"
                >
                  {errors.name}
                </p>
              )}
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
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="edit-org-city" className="font-bold">
                  City
                  <span className="text-destructive ml-0.5" aria-hidden>
                    *
                  </span>
                </Label>
                <Input
                  id="edit-org-city"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  data-testid="input-edit-org-city"
                />
                {errors.city && (
                  <p
                    className="text-xs font-medium text-destructive"
                    data-testid="error-edit-org-city"
                  >
                    {errors.city}
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-org-state" className="font-bold">
                  State
                  <span className="text-destructive ml-0.5" aria-hidden>
                    *
                  </span>
                </Label>
                <Select value={state} onValueChange={setState}>
                  <SelectTrigger
                    id="edit-org-state"
                    data-testid="input-edit-org-state"
                    aria-label="State"
                  >
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    {US_STATES.map((s) => (
                      <SelectItem
                        key={s.code}
                        value={s.code}
                        data-testid={`option-edit-org-state-${s.code}`}
                      >
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.state && (
                  <p
                    className="text-xs font-medium text-destructive"
                    data-testid="error-edit-org-state"
                  >
                    {errors.state}
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-org-zip" className="font-bold">
                  Zip
                  <span className="text-destructive ml-0.5" aria-hidden>
                    *
                  </span>
                </Label>
                <Input
                  id="edit-org-zip"
                  value={zipCode}
                  onChange={(e) => setZipCode(e.target.value)}
                  placeholder="07090"
                  inputMode="numeric"
                  maxLength={10}
                  data-testid="input-edit-org-zip"
                />
                {errors.zipCode && (
                  <p
                    className="text-xs font-medium text-destructive"
                    data-testid="error-edit-org-zip"
                  >
                    {errors.zipCode}
                  </p>
                )}
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
              variant="brand"
              disabled={saving || uploading}
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
