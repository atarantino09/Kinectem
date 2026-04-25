import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useUpdateUser,
  getGetUserByIdQueryKey,
  getGetLoggedInUserQueryKey,
  requestUpload,
  confirmUpload,
  type PrivateUserResponse,
} from "@workspace/api-client-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Camera, Loader2, Pencil, X } from "lucide-react";
import { getInitials } from "@/lib/format";

const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
const AVATAR_ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const AVATAR_MAX_DIMENSION = 1024;
const AVATAR_OUTPUT_QUALITY = 0.85;
const AVATAR_SHRINK_SKIP_BYTES = 200 * 1024;

type DrawableImage = ImageBitmap | HTMLImageElement;

async function loadImage(
  file: File,
): Promise<{ source: DrawableImage; width: number; height: number; cleanup: () => void }> {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file);
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      cleanup: () => bitmap.close(),
    };
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("Could not read image"));
      i.src = url;
    });
    return {
      source: img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      cleanup: () => URL.revokeObjectURL(url),
    };
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
}

async function shrinkAvatarFile(file: File): Promise<File> {
  // Animated GIFs would lose their animation through canvas; leave them alone.
  if (file.type === "image/gif") return file;
  // Tiny files don't need any work.
  if (file.size <= AVATAR_SHRINK_SKIP_BYTES) return file;

  let loaded: Awaited<ReturnType<typeof loadImage>>;
  try {
    loaded = await loadImage(file);
  } catch {
    return file;
  }

  try {
    const { source, width, height } = loaded;
    if (!width || !height) return file;
    const scale = Math.min(1, AVATAR_MAX_DIMENSION / Math.max(width, height));
    const targetW = Math.max(1, Math.round(width * scale));
    const targetH = Math.max(1, Math.round(height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(source, 0, 0, targetW, targetH);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", AVATAR_OUTPUT_QUALITY),
    );
    if (!blob || blob.size >= file.size) return file;

    const baseName = file.name.replace(/\.[^.]+$/, "") || "avatar";
    return new File([blob], `${baseName}.jpg`, {
      type: "image/jpeg",
      lastModified: Date.now(),
    });
  } catch {
    return file;
  } finally {
    loaded.cleanup();
  }
}

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
  const [firstName, setFirstName] = useState(user.firstName);
  const [lastName, setLastName] = useState(user.lastName);
  const [nickname, setNickname] = useState(user.nickname ?? "");
  const [bio, setBio] = useState(user.bio ?? "");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(user.avatarUrl ?? null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const uploadGenRef = useRef(0);

  // When opened (especially when controlled by a parent that may swap the
  // user prop between children), reset the form fields to match the
  // currently-selected user so we never show stale values from a previous
  // edit session.
  useEffect(() => {
    if (open) {
      setFirstName(user.firstName);
      setLastName(user.lastName);
      setNickname(user.nickname ?? "");
      setBio(user.bio ?? "");
      setAvatarUrl(user.avatarUrl ?? null);
      setAvatarError(null);
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
      onError: () =>
        toast({
          title: "Could not update",
          description: "Try again in a moment.",
          variant: "destructive",
        }),
    },
  });

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      uploadGenRef.current += 1;
      setAvatarUploading(false);
      setFirstName(user.firstName);
      setLastName(user.lastName);
      setNickname(user.nickname ?? "");
      setBio(user.bio ?? "");
      setAvatarUrl(user.avatarUrl ?? null);
      setAvatarError(null);
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
    const myGen = ++uploadGenRef.current;
    setAvatarUploading(true);
    try {
      const prepared = await shrinkAvatarFile(file);
      if (uploadGenRef.current !== myGen) return;
      const url = await uploadAvatarFile(prepared);
      if (uploadGenRef.current !== myGen) return;
      setAvatarUrl(url);
    } catch (err) {
      if (uploadGenRef.current !== myGen) return;
      setAvatarError(
        err instanceof Error ? err.message : "Upload failed. Try again.",
      );
    } finally {
      if (uploadGenRef.current === myGen) setAvatarUploading(false);
    }
  };

  const onRemoveAvatar = () => {
    uploadGenRef.current += 1;
    setAvatarError(null);
    setAvatarUploading(false);
    setAvatarUrl(null);
  };

  const onSave = () => {
    update.mutate({
      userId: user.id,
      data: {
        firstName,
        lastName,
        nickname: nickname.trim() ? nickname : null,
        bio: bio.trim() ? bio : null,
        avatarUrl,
      },
    });
  };

  const initials = getInitials(`${firstName} ${lastName}`.trim() || user.firstName);

  return (
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
              <Avatar
                className="w-20 h-20 border-2 border-border"
                data-testid="avatar-edit-preview"
              >
                {avatarUrl && <AvatarImage src={avatarUrl} alt="Profile" />}
                <AvatarFallback className="text-lg font-bold">
                  {initials}
                </AvatarFallback>
              </Avatar>
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
          <div className="space-y-1.5">
            <Label htmlFor="nickname" className="text-xs font-bold">
              Nickname
            </Label>
            <Input
              id="nickname"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="Optional"
              data-testid="input-nickname"
            />
          </div>
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
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            className="font-bold"
          >
            Cancel
          </Button>
          <Button
            onClick={onSave}
            disabled={
              update.isPending || avatarUploading || !firstName || !lastName
            }
            className="font-bold"
            data-testid="button-save-profile"
          >
            {update.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
