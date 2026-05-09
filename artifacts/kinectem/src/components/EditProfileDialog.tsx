import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useUpdateUser,
  getGetUserByIdQueryKey,
  getGetLoggedInUserQueryKey,
  requestUpload,
  confirmUpload,
  type PrivateUserResponse,
  type UpdateUserRequestState,
  UpdateUserRequestDateOfBirthVisibility,
  type UpdateUserRequestDateOfBirthVisibility as DobVisibility,
} from "@workspace/api-client-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { UserAvatar } from "@/components/UserAvatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Camera, Loader2, Pencil, X } from "lucide-react";
import { shrinkImage, IMAGE_UPLOAD_MAX_BYTES } from "@/lib/shrinkImage";
import { US_STATES } from "@/lib/usStates";
import { ImageCropDialog } from "@/components/ImageCropDialog";

const AVATAR_MAX_BYTES = IMAGE_UPLOAD_MAX_BYTES;
const AVATAR_ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

async function uploadAvatarFile(file: File): Promise<string> {
  const upload = await requestUpload({
    fileName: file.name,
    fileType: file.type || "application/octet-stream",
    fileSize: file.size,
  });
  const putResp = await fetch(upload.uploadUrl, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
  if (!putResp.ok) {
    throw new Error(`Upload failed (${putResp.status})`);
  }
  const confirmed = await confirmUpload(upload.assetId);
  if (!confirmed?.url) {
    throw new Error("Upload could not be confirmed");
  }
  return confirmed.url;
}

interface EditProfileDialogProps {
  user: PrivateUserResponse;
  /**
   * When provided, the dialog is fully controlled by the parent component
   * and renders no trigger button of its own. When omitted, the dialog
   * manages its own open state and renders the default "Edit Profile"
   * trigger button.
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /**
   * Optional callback invoked after a successful save. Useful when the
   * dialog edits a user other than the logged-in caller (e.g. a parent
   * editing a child) and the parent screen needs to refresh its list.
   */
  onSaved?: () => void;
}

export function EditProfileDialog({
  user,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  onSaved,
}: EditProfileDialogProps) {
  const isControlled = controlledOpen !== undefined;
  const qc = useQueryClient();
  const { toast } = useToast();
  const [internalOpen, setInternalOpen] = useState(false);
  const open = isControlled ? controlledOpen : internalOpen;
  // Task #423 — under-13 accounts can't set bio/city/state
  // (server enforces via MINOR_BLOCKED). Hide those inputs entirely
  // so saving the allowed fields (name, avatar) doesn't get rejected.
  const isMinor = Boolean((user as { isMinor?: boolean }).isMinor);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [firstName, setFirstName] = useState(user.firstName);
  const [lastName, setLastName] = useState(user.lastName);
  const [bio, setBio] = useState(user.bio ?? "");
  // Task #349 — Optional city + 2-letter US state postal code surfaced
  // on the profile hero. Both default to empty when the user has none.
  const [city, setCity] = useState(user.city ?? "");
  const [state, setState] = useState(user.state ?? "");
  // Task #422 — Birthday is editable from the profile UI. The server
  // returns dateOfBirth as a YYYY-MM-DD string; native <input type="date">
  // expects the same shape.
  const dobToString = (v: PrivateUserResponse["dateOfBirth"]): string => {
    if (!v) return "";
    return String(v).slice(0, 10);
  };
  const [dateOfBirth, setDateOfBirth] = useState(dobToString(user.dateOfBirth));
  const [dateOfBirthError, setDateOfBirthError] = useState<string | undefined>(
    undefined,
  );
  // Task #426 — Per-field birthday visibility. Default to the value
  // already on the row (server defaults to "private"). Minor accounts
  // are pinned to "private" server-side, so the picker is hidden.
  const initialDobVisibility: DobVisibility =
    ((user as { dateOfBirthVisibility?: DobVisibility }).dateOfBirthVisibility ??
      UpdateUserRequestDateOfBirthVisibility.private) as DobVisibility;
  const [dateOfBirthVisibility, setDateOfBirthVisibility] = useState<DobVisibility>(
    initialDobVisibility,
  );
  // Task #431 — Birthday visibility only makes sense if there's a date to
  // share. Auto-pin the dropdown back to "private" whenever the date input
  // is empty so the row can never end up with a non-private tier and a
  // null DOB (which previously saved silently and made it look like the
  // birthday was never updated).
  useEffect(() => {
    if (!dateOfBirth.trim() && dateOfBirthVisibility !== "private") {
      setDateOfBirthVisibility(
        UpdateUserRequestDateOfBirthVisibility.private as DobVisibility,
      );
    }
  }, [dateOfBirth, dateOfBirthVisibility]);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(user.avatarUrl ?? null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const uploadGenRef = useRef(0);
  // Task #387 — Stage the picked file in the crop dialog before running
  // shrink + upload so users control framing on tall phone photos
  // instead of getting an awkward center-crop into the round avatar.
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [cropFileName, setCropFileName] = useState<string>("avatar");
  const [cropOpen, setCropOpen] = useState(false);

  // When opened (especially when controlled by a parent that may swap the
  // user prop between children), reset the form fields to match the
  // currently-selected user so we never show stale values from a previous
  // edit session.
  useEffect(() => {
    if (open) {
      setFirstName(user.firstName);
      setLastName(user.lastName);
      setBio(user.bio ?? "");
      setCity(user.city ?? "");
      setState(user.state ?? "");
      setDateOfBirth(dobToString(user.dateOfBirth));
      setDateOfBirthError(undefined);
      setDateOfBirthVisibility(
        ((user as { dateOfBirthVisibility?: DobVisibility })
          .dateOfBirthVisibility ??
          UpdateUserRequestDateOfBirthVisibility.private) as DobVisibility,
      );
      setAvatarUrl(user.avatarUrl ?? null);
      setAvatarError(null);
      setSaveError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, user.id]);

  const update = useUpdateUser({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetUserByIdQueryKey(user.id) });
        // Only the logged-in user's own /users/me cache needs busting when
        // they edit themselves. When a parent edits a child, leave the
        // parent's own cached profile alone.
        if (user.isOwnProfile) {
          qc.invalidateQueries({ queryKey: getGetLoggedInUserQueryKey() });
        }
        toast({ title: "Profile updated" });
        handleOpenChange(false);
        onSaved?.();
      },
      onError: (e: unknown) => {
        // Task #423 — surface the server's error message inline (e.g.
        // MINOR_BLOCKED) so the Save button never silently no-ops.
        const err = e as { body?: { error?: string }; message?: string };
        const msg =
          err?.body?.error ?? err?.message ?? "Try again in a moment.";
        setSaveError(msg);
        toast({
          title: "Could not update",
          description: msg,
          variant: "destructive",
        });
      },
    },
  });

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      uploadGenRef.current += 1;
      setAvatarUploading(false);
      setFirstName(user.firstName);
      setLastName(user.lastName);
      setBio(user.bio ?? "");
      setCity(user.city ?? "");
      setState(user.state ?? "");
      setDateOfBirth(dobToString(user.dateOfBirth));
      setDateOfBirthError(undefined);
      setAvatarUrl(user.avatarUrl ?? null);
      setAvatarError(null);
      setSaveError(null);
      setCropSrc(null);
      setCropOpen(false);
    }
    if (isControlled) {
      controlledOnOpenChange?.(next);
    } else {
      setInternalOpen(next);
    }
  };

  const onPickFile = () => fileInputRef.current?.click();

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (e.target) e.target.value = "";
    if (!file) return;
    setAvatarError(null);
    if (!AVATAR_ACCEPTED_TYPES.includes(file.type)) {
      setAvatarError("Use a JPG, PNG, WebP, or GIF image.");
      return;
    }
    if (file.size > AVATAR_MAX_BYTES) {
      setAvatarError("Image must be under 5 MB.");
      return;
    }
    // Read the file as a data URL and hand it to the crop dialog. The
    // actual upload runs in onCroppedConfirm once the user confirms a
    // square crop.
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () =>
          reject(reader.error ?? new Error("Could not read file"));
        reader.readAsDataURL(file);
      });
      setCropSrc(dataUrl);
      setCropFileName(file.name);
      setCropOpen(true);
    } catch {
      setAvatarError("Couldn't read that image. Try another file.");
    }
  };

  const onCroppedConfirm = async (cropped: File) => {
    const myGen = ++uploadGenRef.current;
    setAvatarUploading(true);
    setAvatarError(null);
    try {
      // The cropper already constrains output size, but we still run it
      // through shrinkImage for consistent JPEG encoding and the global
      // 1024px longest-edge cap before pushing to object storage.
      const prepared = await shrinkImage(cropped);
      if (uploadGenRef.current !== myGen) return;
      const url = await uploadAvatarFile(prepared);
      if (uploadGenRef.current !== myGen) return;
      setAvatarUrl(url);
      setCropSrc(null);
    } catch (err) {
      if (uploadGenRef.current !== myGen) return;
      setAvatarError(
        err instanceof Error ? err.message : "Upload failed. Try again.",
      );
      // Re-throw so the crop dialog stays open and the user can retry
      // without re-picking the file.
      throw err;
    } finally {
      if (uploadGenRef.current === myGen) setAvatarUploading(false);
    }
  };

  const onRemoveAvatar = () => {
    uploadGenRef.current += 1;
    setAvatarError(null);
    setAvatarUploading(false);
    setAvatarUrl(null);
    setCropSrc(null);
    setCropOpen(false);
  };

  const onSave = () => {
    setSaveError(null);
    // Task #422 — Validate birthday client-side regardless of minor
    // status: DOB is editable on every account (the server-side minor
    // block only covers bio/city/state). Empty input clears the value
    // (sent as null).
    const trimmedDob = dateOfBirth.trim();
    let dobPayload: string | null = null;
    if (trimmedDob) {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmedDob);
      if (!m) {
        setDateOfBirthError("Enter a valid date.");
        return;
      }
      const y = Number(m[1]);
      const mo = Number(m[2]);
      const d = Number(m[3]);
      // Round-trip through UTC components so impossible calendar dates
      // like 2026-02-31 (which `new Date(...)` silently rolls forward)
      // are rejected here instead of saving a shifted value.
      const parsed = new Date(Date.UTC(y, mo - 1, d));
      if (
        Number.isNaN(parsed.getTime()) ||
        parsed.getUTCFullYear() !== y ||
        parsed.getUTCMonth() !== mo - 1 ||
        parsed.getUTCDate() !== d
      ) {
        setDateOfBirthError("Enter a valid date.");
        return;
      }
      if (parsed.getTime() > Date.now()) {
        setDateOfBirthError("Birthday can't be in the future.");
        return;
      }
      dobPayload = trimmedDob;
    }
    // Task #431 — Defense in depth: even though the dropdown is disabled
    // when the date is empty, refuse to send a non-private visibility
    // alongside a null DOB. Keeps the row consistent if anything ever
    // bypasses the disabled state.
    if (!isMinor && !dobPayload && dateOfBirthVisibility !== "private") {
      setDateOfBirthError("Add a birthday before sharing it.");
      return;
    }
    setDateOfBirthError(undefined);
    // Task #423 — minors aren't allowed to set bio/city/state on the
    // server. Omit those fields entirely so the PATCH only carries
    // fields a minor account can set.
    if (isMinor) {
      update.mutate({
        userId: user.id,
        data: {
          firstName,
          lastName,
          dateOfBirth: dobPayload,
          avatarUrl,
        },
      });
      return;
    }
    // Task #426 — Adults can pick a per-field birthday tier; the server
    // also enforces this. Always include so flipping back to private
    // persists.
    // Task #349 — Always include city/state so emptying either field on the
    // form clears the persisted value. City is trimmed and sent as null when
    // empty; state is sent as null when no option is selected.
    const trimmedCity = city.trim();
    update.mutate({
      userId: user.id,
      data: {
        firstName,
        lastName,
        bio: bio.trim() ? bio : null,
        city: trimmedCity ? trimmedCity : null,
        state: state ? (state as UpdateUserRequestState) : null,
        dateOfBirth: dobPayload,
        dateOfBirthVisibility,
        avatarUrl,
      },
    });
  };


  return (
    <>
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {!isControlled && (
        <DialogTrigger asChild>
          <Button
            variant="outline"
            className="font-bold rounded-full px-6 gap-2"
            data-testid="button-edit-profile"
          >
            <Pencil className="w-3.5 h-3.5" />
            Edit Profile
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-black tracking-tight">
            {user.isOwnProfile
              ? "Edit Profile"
              : `Edit ${user.firstName}'s profile`}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="flex items-center gap-4">
            <div className="relative">
              <UserAvatar
                avatarUrl={avatarUrl}
                displayName={`${firstName} ${lastName}`.trim() || user.firstName}
                alt="Profile"
                size="3xl"
                className="border-2 border-border"
                data-testid="avatar-edit-preview"
              />
              {avatarUploading && (
                <div
                  className="absolute inset-0 rounded-full bg-background/70 flex items-center justify-center"
                  data-testid="avatar-uploading"
                >
                  <Loader2 className="w-5 h-5 animate-spin" />
                </div>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept={AVATAR_ACCEPTED_TYPES.join(",")}
                className="hidden"
                onChange={onFileChange}
                data-testid="input-avatar-file"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onPickFile}
                disabled={avatarUploading}
                className="font-bold rounded-full gap-2"
                data-testid="button-change-avatar"
              >
                <Camera className="w-3.5 h-3.5" />
                {avatarUrl ? "Change photo" : "Upload photo"}
              </Button>
              {avatarUrl && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={onRemoveAvatar}
                  disabled={avatarUploading}
                  className="font-bold rounded-full gap-2 text-muted-foreground"
                  data-testid="button-remove-avatar"
                >
                  <X className="w-3.5 h-3.5" />
                  Remove photo
                </Button>
              )}
            </div>
          </div>
          {avatarError && (
            <p
              className="text-xs text-destructive font-medium"
              data-testid="text-avatar-error"
            >
              {avatarError}
            </p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="firstName" className="text-xs font-bold">
                First name
              </Label>
              <Input
                id="firstName"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                data-testid="input-first-name"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lastName" className="text-xs font-bold">
                Last name
              </Label>
              <Input
                id="lastName"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                data-testid="input-last-name"
              />
            </div>
          </div>
          {/* Task #422 — Birthday is editable on every account
              (under-13 included). Empty input clears the value.
              Task #426 — Adults additionally pick who can see it
              via `dateOfBirthVisibility`; minor accounts are pinned
              to private server-side, so the picker is hidden. */}
          <div className="space-y-1.5">
            <Label htmlFor="profile-dob" className="text-xs font-bold">
              Birthday
            </Label>
            <div className={isMinor ? "" : "grid grid-cols-2 gap-3"}>
              <Input
                id="profile-dob"
                type="date"
                value={dateOfBirth}
                max={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setDateOfBirth(e.target.value)}
                data-testid="input-profile-dob"
              />
              {!isMinor && (
                <Select
                  value={dateOfBirthVisibility}
                  onValueChange={(v) =>
                    setDateOfBirthVisibility(v as DobVisibility)
                  }
                  disabled={!dateOfBirth.trim()}
                >
                  <SelectTrigger
                    id="profile-dob-visibility"
                    data-testid="input-profile-dob-visibility"
                    aria-label="Who can see your birthday"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem
                      value={UpdateUserRequestDateOfBirthVisibility.private}
                      data-testid="option-profile-dob-visibility-private"
                    >
                      Only me
                    </SelectItem>
                    <SelectItem
                      value={UpdateUserRequestDateOfBirthVisibility.followers}
                      data-testid="option-profile-dob-visibility-followers"
                    >
                      Followers
                    </SelectItem>
                    <SelectItem
                      value={UpdateUserRequestDateOfBirthVisibility.public}
                      data-testid="option-profile-dob-visibility-public"
                    >
                      Everyone
                    </SelectItem>
                  </SelectContent>
                </Select>
              )}
            </div>
            {dateOfBirthError && (
              <p
                className="text-xs font-medium text-destructive"
                data-testid="error-profile-dob"
              >
                {dateOfBirthError}
              </p>
            )}
            {!isMinor && !dateOfBirth.trim() && !dateOfBirthError && (
              <p
                className="text-xs text-muted-foreground"
                data-testid="hint-profile-dob-visibility"
              >
                Add a birthday to choose who can see it.
              </p>
            )}
          </div>
          {isMinor ? (
            <p
              className="text-xs font-medium text-muted-foreground"
              data-testid="text-minor-fields-notice"
            >
              Bio and location aren't available on under-13 accounts.
            </p>
          ) : (
          <>
          <div className="space-y-1.5">
            <Label htmlFor="bio" className="text-xs font-bold">
              Bio
            </Label>
            <Textarea
              id="bio"
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              rows={4}
              placeholder="Tell people about yourself"
              className="resize-none"
              data-testid="input-bio"
            />
          </div>
          {/* Task #349 — Optional city + US state. Both clear when emptied. */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="profile-city" className="text-xs font-bold">
                City
              </Label>
              <Input
                id="profile-city"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="Austin"
                maxLength={100}
                data-testid="input-profile-city"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="profile-state" className="text-xs font-bold">
                State
              </Label>
              <Select
                value={state || "__clear__"}
                onValueChange={(v) => setState(v === "__clear__" ? "" : v)}
              >
                <SelectTrigger
                  id="profile-state"
                  data-testid="input-profile-state"
                  aria-label="State"
                >
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectItem
                    value="__clear__"
                    data-testid="option-profile-state-clear"
                  >
                    None
                  </SelectItem>
                  {US_STATES.map((s) => (
                    <SelectItem
                      key={s.code}
                      value={s.code}
                      data-testid={`option-profile-state-${s.code}`}
                    >
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          </>
          )}
        </div>
        {saveError && (
          <p
            className="text-xs font-medium text-destructive px-1"
            data-testid="text-save-profile-error"
          >
            {saveError}
          </p>
        )}
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            className="font-bold"
          >
            Cancel
          </Button>
          <Button
            variant="brand"
            onClick={onSave}
            disabled={
              update.isPending || avatarUploading || !firstName || !lastName
            }
            data-testid="button-save-profile"
          >
            {update.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <ImageCropDialog
      src={cropSrc}
      fileName={cropFileName}
      aspect={1}
      cropShape="round"
      title="Position your profile photo"
      description="Drag to move, pinch or use the slider to zoom. The frame matches how your avatar will appear."
      confirmLabel="Save photo"
      fallbackBaseName="avatar"
      open={cropOpen && !!cropSrc}
      onOpenChange={(v) => {
        setCropOpen(v);
        if (!v) setCropSrc(null);
      }}
      onConfirm={onCroppedConfirm}
    />
    </>
  );
}
