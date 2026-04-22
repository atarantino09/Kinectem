import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  customFetch,
  getGetTeamByIdQueryKey,
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

const SPORTS = [
  "Soccer",
  "Basketball",
  "Baseball",
  "Football",
  "Volleyball",
  "Lacrosse",
  "Hockey",
  "Track & Field",
];

type TeamLike = {
  id: string;
  name: string;
  description?: string | null;
  sport?: string | null;
  level?: string | null;
};

export function EditTeamDialog({
  team,
  open,
  onOpenChange,
}: {
  team: TeamLike;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [name, setName] = useState(team.name);
  const [description, setDescription] = useState(team.description ?? "");
  const [sport, setSport] = useState(team.sport ?? "");
  const [level, setLevel] = useState(team.level ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName(team.name);
      setDescription(team.description ?? "");
      setSport(team.sport ?? "");
      setLevel(team.level ?? "");
    }
  }, [open, team]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast({ title: "Name is required", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await customFetch(`/api/v1/teams/${team.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description,
          sport,
          level,
        }),
      });
      await qc.invalidateQueries({ queryKey: getGetTeamByIdQueryKey(team.id) });
      toast({ title: "Team updated" });
      onOpenChange(false);
    } catch {
      toast({ title: "Failed to update team", variant: "destructive" });
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
              Edit team
            </DialogTitle>
            <DialogDescription>
              Update your team's name, sport, level, and description.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="edit-team-name" className="font-bold">
                Team name
              </Label>
              <Input
                id="edit-team-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
                data-testid="input-edit-team-name"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="font-bold">Sport</Label>
                <Select value={sport} onValueChange={setSport}>
                  <SelectTrigger data-testid="select-edit-team-sport">
                    <SelectValue placeholder="Pick sport" />
                  </SelectTrigger>
                  <SelectContent>
                    {SPORTS.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-team-level" className="font-bold">
                  Level / League
                </Label>
                <Input
                  id="edit-team-level"
                  value={level}
                  onChange={(e) => setLevel(e.target.value)}
                  placeholder="e.g. NJYS Premier"
                  data-testid="input-edit-team-level"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-team-desc" className="font-bold">
                Description
              </Label>
              <Textarea
                id="edit-team-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                data-testid="input-edit-team-description"
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
              disabled={saving}
              className="font-bold"
              data-testid="btn-save-edit-team"
            >
              {saving ? "Saving..." : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
