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
import { Switch } from "@/components/ui/switch";
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
import { OrgLogo } from "@/components/OrgLogoFallback";
import {
  shrinkImageToDataUrl,
  IMAGE_UPLOAD_MAX_BYTES,
} from "@/lib/shrinkImage";
import { US_STATES, US_ZIP_PATTERN } from "@/lib/usStates";
import { normalizeWebsite } from "@/lib/normalizeWebsite";
import { apiErrorMessage } from "@/lib/api-errors";
import { useWhoami } from "@/hooks/useWhoami";
import { extractLogoColors } from "@/components/BrandColorField";
import { BrandColorSwapButton } from "@/components/BrandColorSwapButton";
import {
  readOrgBrandColors,
  orgHeroGradient,
  orgStripGradient,
} from "@/lib/orgBrand";

// Task #733 — starting swatches shown when an org has no branding yet and
// the admin clicks a picker for the first time. Deliberately generic; they
// are only persisted if the admin actually saves them.
const DEFAULT_BRAND_PRIMARY = "#1d4ed8";
const DEFAULT_BRAND_SECONDARY = "#9333ea";

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
  // Task #733 — extra fields beyond the locked spec (recapKind precedent).
  brandPrimaryColor?: string | null;
  brandSecondaryColor?: string | null;
  // Task #801 — admin-only org setting: when true, coach recaps go through
  // the pending-approval queue instead of publishing immediately.
  requireRecapApproval?: boolean;
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
  // Task #733 — brand colors. null = not set (default gradient, no team
  // strip). Both are sent on save so clearing works.
  const [brandPrimary, setBrandPrimary] = useState<string | null>(
    organization.brandPrimaryColor ?? null,
  );
  const [brandSecondary, setBrandSecondary] = useState<string | null>(
    organization.brandSecondaryColor ?? null,
  );
  // Task #801 — "Require recap approval" toggle. OFF by default: coach
  // recaps publish immediately; ON restores the admin review queue.
  const [requireRecapApproval, setRequireRecapApproval] = useState<boolean>(
    organization.requireRecapApproval === true,
  );
  const [errors, setErrors] = useState<{
    name?: string;
    city?: string;
    state?: string;
    zipCode?: string;
    website?: string;
  }>({});
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Task #812 — platform admins manage every org (incl. unclaimed ones with
  // no org role); mirror the server's canManageOrganization bypass with the
  // same whoami semantics used on OrganizationPage (masquerade drops powers).
  const { data: who } = useWhoami();
  const isPlatformAdmin =
    (who?.isMasquerading ? who?.viewingAs?.role : who?.realUser?.role) ===
    "admin";
  const canManageLogo =
    organization.role === "admin" ||
    organization.role === "owner" ||
    isPlatformAdmin;

  useEffect(() => {
    if (open) {
      setName(organization.name);
      setDescription(organization.description ?? "");
      setWebsite(organization.website ?? "");
      setCity(organization.city ?? "");
      setState(organization.state ?? "");
      setZipCode(organization.zipCode ?? "");
      setBrandPrimary(organization.brandPrimaryColor ?? null);
      setBrandSecondary(organization.brandSecondaryColor ?? null);
      setRequireRecapApproval(organization.requireRecapApproval === true);
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
    // Logos upload as-is (no forced square crop) so the whole mark is kept.
    // shrinkImageToDataUrl downscales big photos at high quality but leaves
    // already-small logos untouched, and the org logo is displayed with
    // object-contain so non-square marks aren't cropped.
    setUploading(true);
    try {
      const dataUrl = await shrinkImageToDataUrl(file);
      // Task #812 — auto-pick brand colors from the new logo. Extraction is
      // best-effort: we need at least two distinct usable colors (transparent
      // / near-white / near-gray pixels are already skipped) or we leave the
      // existing brand colors untouched. The pickers stay fully editable —
      // this only pre-fills a suggestion.
      let extracted: string[] = [];
      try {
        extracted = await extractLogoColors(dataUrl);
      } catch {
        // tainted canvas / decode failure — skip color suggestion
      }
      const autoColors = extracted.length >= 2 ? extracted.slice(0, 2) : null;
      const patch: Record<string, string> = { logoUrl: dataUrl };
      if (autoColors) {
        patch.brandPrimaryColor = autoColors[0];
        patch.brandSecondaryColor = autoColors[1];
      }
      await customFetch(`/api/v1/organizations/${organization.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (autoColors) {
        // Keep the open dialog's pickers in sync with what was just saved
        // so "Save changes" doesn't write stale colors back.
        setBrandPrimary(autoColors[0]);
        setBrandSecondary(autoColors[1]);
      }
      await qc.invalidateQueries({
        queryKey: getGetOrganizationByIdQueryKey(organization.id),
      });
      toast(
        autoColors
          ? {
              title: "Logo updated",
              description:
                "Brand colors updated from the logo — you can change them below.",
            }
          : { title: "Logo updated" },
      );
    } catch (err) {
      toast({
        title: apiErrorMessage(err) ?? "Failed to upload logo",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    const trimmedCity = city.trim();
    const trimmedZip = zipCode.trim();
    const websiteResult = normalizeWebsite(website);
    const normalizedWebsite = websiteResult.ok ? websiteResult.value : "";
    // Task #237 — keep parity with CreateOrgDialog: city/state/zip are
    // required and zip must look like 12345 or 12345-6789. The server
    // enforces the same rules, so any drift between the two is a bug.
    const nextErrors: typeof errors = {};
    if (!trimmedName) nextErrors.name = "Name is required";
    // Platform admins set up hand-off pages before knowing the org's real
    // location — city/state/zip are optional for them (zip format is still
    // checked when provided). Owners/admins keep the required rules.
    if (!isPlatformAdmin) {
      if (!trimmedCity) nextErrors.city = "City is required";
      if (!state) nextErrors.state = "State is required";
      if (!trimmedZip) nextErrors.zipCode = "Zip code is required";
    }
    if (trimmedZip && !US_ZIP_PATTERN.test(trimmedZip)) {
      nextErrors.zipCode = "Enter a US zip (12345 or 12345-6789)";
    }
    if (!websiteResult.ok) nextErrors.website = websiteResult.error;
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      const first =
        nextErrors.name ??
        nextErrors.city ??
        nextErrors.state ??
        nextErrors.zipCode ??
        nextErrors.website ??
        "Please fix the highlighted fields";
      toast({ title: first, variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, string | boolean | null> = {
        name: trimmedName,
        description,
      };
      // The server rejects empty-string location values (absent = unchanged),
      // so only include the ones that are filled in. Non-admins always have
      // all three (validated above).
      if (trimmedCity) payload.city = trimmedCity;
      if (state) payload.state = state as UpdateOrganizationRequestState;
      if (trimmedZip) payload.zipCode = trimmedZip;
      // Always include website so the user can clear a previously-set
      // value by emptying the field (server treats "" as "set to null").
      payload.website = normalizedWebsite;
      // Task #733 — always include both brand colors so "Reset to default"
      // (null) actually clears a previously-saved pair.
      payload.brandPrimaryColor = brandPrimary;
      payload.brandSecondaryColor = brandSecondary;
      // Task #801 — org-wide recap approval mode.
      payload.requireRecapApproval = requireRecapApproval;
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
                    <OrgLogo
                      logoUrl={organization.logoUrl}
                      name={organization.name}
                      className="w-full h-full"
                      imgClassName="w-full h-full object-contain"
                    />
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
              <Label className="font-bold">Brand colors</Label>
              <p className="text-xs text-muted-foreground">
                Two colors that blend into a gradient on your organization
                page and appear as a strip on each team page.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={brandPrimary ?? DEFAULT_BRAND_PRIMARY}
                    onChange={(e) => {
                      setBrandPrimary(e.target.value);
                      // Picking one color implicitly activates the pair so
                      // the preview + save reflect what the page will show.
                      setBrandSecondary(
                        (prev) => prev ?? DEFAULT_BRAND_SECONDARY,
                      );
                    }}
                    className="h-9 w-9 cursor-pointer rounded-md border border-border bg-transparent p-0.5"
                    aria-label="Primary brand color"
                    data-testid="input-org-brand-primary"
                  />
                  <span className="text-xs font-bold text-muted-foreground">
                    Primary
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={brandSecondary ?? DEFAULT_BRAND_SECONDARY}
                    onChange={(e) => {
                      setBrandSecondary(e.target.value);
                      setBrandPrimary((prev) => prev ?? DEFAULT_BRAND_PRIMARY);
                    }}
                    className="h-9 w-9 cursor-pointer rounded-md border border-border bg-transparent p-0.5"
                    aria-label="Secondary brand color"
                    data-testid="input-org-brand-secondary"
                  />
                  <span className="text-xs font-bold text-muted-foreground">
                    Secondary
                  </span>
                </div>
                <BrandColorSwapButton
                  testId="btn-swap-org-brand-colors"
                  onSwap={() => {
                    const currentPrimary =
                      brandPrimary ?? DEFAULT_BRAND_PRIMARY;
                    const currentSecondary =
                      brandSecondary ?? DEFAULT_BRAND_SECONDARY;
                    setBrandPrimary(currentSecondary);
                    setBrandSecondary(currentPrimary);
                  }}
                />
                {(brandPrimary || brandSecondary) && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="font-bold rounded-full"
                    onClick={() => {
                      setBrandPrimary(null);
                      setBrandSecondary(null);
                    }}
                    data-testid="btn-clear-org-brand-colors"
                  >
                    Reset to default
                  </Button>
                )}
              </div>
              {(() => {
                const colors = readOrgBrandColors({
                  brandPrimaryColor: brandPrimary,
                  brandSecondaryColor: brandSecondary,
                });
                if (!colors) return null;
                return (
                  <div
                    className="overflow-hidden rounded-lg border border-border"
                    data-testid="preview-org-brand-gradient"
                  >
                    <div
                      className="h-1.5"
                      style={{ background: orgStripGradient(colors) }}
                    />
                    <div
                      className="h-10"
                      style={{ background: orgHeroGradient(colors) }}
                    />
                  </div>
                );
              })()}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-org-website" className="font-bold">
                Website
              </Label>
              <Input
                id="edit-org-website"
                type="text"
                inputMode="url"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                placeholder="example.com"
                data-testid="input-edit-org-website"
              />
              {errors.website && (
                <p
                  className="text-xs font-medium text-destructive"
                  data-testid="error-edit-org-website"
                >
                  {errors.website}
                </p>
              )}
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="edit-org-city" className="font-bold">
                  City
                  {!isPlatformAdmin && (
                    <span className="text-destructive ml-0.5" aria-hidden>
                      *
                    </span>
                  )}
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
                  {!isPlatformAdmin && (
                    <span className="text-destructive ml-0.5" aria-hidden>
                      *
                    </span>
                  )}
                </Label>
                <Select value={state} onValueChange={setState}>
                  <SelectTrigger
                    id="edit-org-state"
                    data-testid="input-edit-org-state"
                    aria-label="State"
                  >
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent className="max-h-[min(var(--radix-select-content-available-height),18rem)]">
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
                  {!isPlatformAdmin && (
                    <span className="text-destructive ml-0.5" aria-hidden>
                      *
                    </span>
                  )}
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
            <div className="flex items-start justify-between gap-3 rounded-lg border border-border p-3">
              <div className="space-y-0.5">
                <Label
                  htmlFor="edit-org-require-recap-approval"
                  className="font-bold"
                >
                  Require recap approval
                </Label>
                <p className="text-xs text-muted-foreground">
                  {requireRecapApproval
                    ? "Coach and staff game recaps wait in the Admin Queue until an admin approves them."
                    : "Coach and staff game recaps publish immediately. Turn this on to review each recap in the Admin Queue first."}
                </p>
              </div>
              <Switch
                id="edit-org-require-recap-approval"
                checked={requireRecapApproval}
                onCheckedChange={setRequireRecapApproval}
                data-testid="switch-require-recap-approval"
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
