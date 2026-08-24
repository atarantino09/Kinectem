import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { customFetch, getListFeedQueryKey } from "@workspace/api-client-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiErrorMessage } from "@/lib/api-errors";

export function NewsGameDateDialog({
  teamId,
  newsId,
  title,
  gameDate,
  open,
  onOpenChange,
}: {
  teamId: string;
  newsId: string;
  title: string | null | undefined;
  gameDate: string | null | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setValue(gameDate?.slice(0, 10) ?? "");
  }, [gameDate, open]);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      await customFetch(`/api/v1/teams/${teamId}/news/${newsId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gameDate: value || null }),
      });
      await Promise.all([
        qc.invalidateQueries({ queryKey: getListFeedQueryKey() }),
        qc.invalidateQueries({
          predicate: (query) => {
            const key = query.queryKey
              .filter((part): part is string => typeof part === "string")
              .join("|");
            return key.includes(`/teams/${teamId}/posts`);
          },
        }),
      ]);
      toast({
        title: value ? "Game date updated" : "Game date cleared",
      });
      onOpenChange(false);
    } catch (error) {
      toast({
        title: "Couldn't update the game date",
        description: apiErrorMessage(error) ?? "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md" data-testid={`dialog-news-game-date-${newsId}`}>
        <form onSubmit={save} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Set game date</DialogTitle>
            <DialogDescription>
              Add the date this game was played so “{title ?? "this article"}”
              can appear in the matching Combined Recap window.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor={`news-game-date-${newsId}`}>Game played on</Label>
            <Input
              id={`news-game-date-${newsId}`}
              type="date"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              disabled={saving}
              data-testid={`input-news-game-date-${newsId}`}
            />
            <p className="text-xs text-muted-foreground">
              Leave blank only for articles that are not tied to one game.
            </p>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="brand"
              disabled={saving}
              data-testid={`button-save-news-game-date-${newsId}`}
            >
              {saving ? "Saving…" : "Save game date"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}