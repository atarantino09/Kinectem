import { ImageCropDialog } from "@/components/ImageCropDialog";

// Locked to the team-page hero banner shape so what the admin sees in
// the cropper matches what shows up on the team page. The hero is
// rendered at h-44 (~176px) full width; 16:5 (= 3.2) is a good middle
// ground between desktop (~3-4:1) and the mobile card (~2-2.5:1).
export const TEAM_BANNER_ASPECT = 16 / 5;

interface TeamPhotoCropDialogProps {
  src: string | null;
  fileName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (cropped: File) => void | Promise<void>;
}

export function TeamPhotoCropDialog(props: TeamPhotoCropDialogProps) {
  return (
    <ImageCropDialog
      {...props}
      aspect={TEAM_BANNER_ASPECT}
      cropShape="rect"
      title="Position your team photo"
      description="Drag to move, pinch or use the slider to zoom. The frame matches how the photo will appear on your team page."
      confirmLabel="Save photo"
      fallbackBaseName="team-photo"
      testId="dialog-crop-team-photo"
      cropAreaHeight={240}
    />
  );
}
