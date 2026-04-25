import { ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

type AvatarLightboxProps = {
  avatarUrl: string | null | undefined;
  displayName: string;
  ariaLabel?: string;
  triggerClassName?: string;
  triggerTestId?: string;
  dialogTestId?: string;
  imageTestId?: string;
  children: ReactNode;
};

export function AvatarLightbox({
  avatarUrl,
  displayName,
  ariaLabel,
  triggerClassName,
  triggerTestId,
  dialogTestId,
  imageTestId,
  children,
}: AvatarLightboxProps) {
  if (!avatarUrl) {
    return <>{children}</>;
  }
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          className={
            triggerClassName ??
            "rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          }
          aria-label={ariaLabel ?? `View ${displayName}'s profile photo`}
          data-testid={triggerTestId}
          onClick={(e) => {
            // Stop the click from bubbling so any wrapping link/row
            // doesn't navigate, but do NOT preventDefault — Radix's
            // DialogTrigger skips opening the dialog when the event's
            // default has already been prevented.
            e.stopPropagation();
          }}
        >
          {children}
        </button>
      </DialogTrigger>
      <DialogContent
        className="max-w-2xl p-0 bg-transparent border-none shadow-none"
        data-testid={dialogTestId}
        aria-describedby={undefined}
      >
        <DialogTitle className="sr-only">
          {displayName}'s profile photo
        </DialogTitle>
        <img
          src={avatarUrl}
          alt={`${displayName}'s profile photo`}
          className="w-full h-auto max-h-[80vh] object-contain rounded-lg"
          data-testid={imageTestId}
        />
      </DialogContent>
    </Dialog>
  );
}
