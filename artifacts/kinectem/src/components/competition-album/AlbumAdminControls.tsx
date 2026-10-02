import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { errText, useSetContributions } from "@/lib/competitionAlbum";

export function AlbumAdminControls({
  competitionId,
  contributionsOpen,
}: {
  competitionId: string;
  contributionsOpen: boolean;
}) {
  const { toast } = useToast();
  const m = useSetContributions(competitionId);
  return (
    <div className="flex items-start gap-3 rounded-xl border bg-muted/30 p-3">
      <Switch
        id={`album-contrib-${competitionId}`}
        checked={contributionsOpen}
        disabled={m.isPending}
        onCheckedChange={(v) =>
          m.mutate(v, {
            onError: (err) =>
              toast({ title: "Couldn’t change the setting", description: errText(err), variant: "destructive" }),
          })
        }
        data-testid="switch-album-contributions"
      />
      <Label htmlFor={`album-contrib-${competitionId}`} className="space-y-0.5">
        <span className="block text-sm font-bold">Let participating teams contribute photos</span>
        <span className="block text-xs font-normal text-muted-foreground">
          Off by default. Team submissions stay pending until you approve them. Turning this off
          blocks new uploads but keeps existing photos.
        </span>
      </Label>
    </div>
  );
}
