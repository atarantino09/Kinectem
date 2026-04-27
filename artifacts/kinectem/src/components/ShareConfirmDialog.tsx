import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

// Task #190 — Share confirm dialog is reused for both game-recap
// articles and highlights, so the copy needs to adapt to the kind
// being re-shared. Callers pass `kind` plus the post's title; we
// keep `recapTitle` as a back-compat alias for older call sites.
export function ShareConfirmDialog({
  open,
  onOpenChange,
  onConfirm,
  recapTitle,
  kind = "recap",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  recapTitle?: string | null;
  kind?: "recap" | "highlight";
}) {
  const noun = kind === "highlight" ? "highlight" : "recap";
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Share this {noun}?</AlertDialogTitle>
          <AlertDialogDescription>
            {recapTitle
              ? `"${recapTitle}" will appear on your profile and on the home feed of people who follow you.`
              : `This ${noun} will appear on your profile and on the home feed of people who follow you.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            data-testid="button-confirm-share"
          >
            Share
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
