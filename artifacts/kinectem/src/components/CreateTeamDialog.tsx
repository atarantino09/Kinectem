import { useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateTeam,
  getListOrgTeamsQueryKey,
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

function slugify(s: string) {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

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

export function CreateTeamDialog({
  orgId,
  open,
  onOpenChange,
}: {
  orgId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugDirty, setSlugDirty] = useState(false);
  const [description, setDescription] = useState("");
  const [sport, setSport] = useState<string>("");
  const [league, setLeague] = useState<string>("");
  const [seasonName, setSeasonName] = useState("");

  const createTeam = useCreateTeam();

  const reset = () => {
    setName("");
    setSlug("");
    setSlugDirty(false);
    setDescription("");
    setSport("");
    setLeague("");
    setSeasonName("");
  };

  const onNameChange = (v: string) => {
    setName(v);
    if (!slugDirty) setSlug(slugify(v));
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const finalSlug = slug || slugify(name);
    const finalSeason = seasonName.trim() || `Season ${new Date().getFullYear()}`;
    if (!name.trim() || !finalSlug) {
      toast({ title: "Name is required", variant: "destructive" });
      return;
    }
    try {
      const team = await createTeam.mutateAsync({
        orgId,
        data: {
          name: name.trim(),
          slug: finalSlug,
          description: description.trim() || undefined,
          sport: sport || undefined,
          level: league.trim() || undefined,
          season: { name: finalSeason },
        },
      });
      toast({ title: "Team created!" });
      await qc.invalidateQueries({ queryKey: getListOrgTeamsQueryKey(orgId) });
      reset();
      onOpenChange(false);
      setLocation(`/teams/${team.id}`);
    } catch {
      toast({ title: "Failed to create team", variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={onSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle className="font-black tracking-tight">
              New team
            </DialogTitle>
            <DialogDescription>
              Add a team under this organization. You can roster players next.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="team-name" className="font-bold">
                Team name
              </Label>
              <Input
                id="team-name"
                value={name}
                onChange={(e) => onNameChange(e.target.value)}
                placeholder="Westfield U14 Boys"
                autoFocus
                data-testid="input-team-name"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="team-slug" className="font-bold">
                URL handle
              </Label>
              <Input
                id="team-slug"
                value={slug}
                onChange={(e) => {
                  setSlug(slugify(e.target.value));
                  setSlugDirty(true);
                }}
                placeholder="westfield-u14-boys"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="font-bold">Sport</Label>
                <Select value={sport} onValueChange={setSport}>
                  <SelectTrigger>
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
                <Label htmlFor="team-league" className="font-bold">
                  League
                </Label>
                <Input
                  id="team-league"
                  value={league}
                  onChange={(e) => setLeague(e.target.value)}
                  placeholder="e.g. NJYS Premier"
                  data-testid="input-team-league"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="team-season" className="font-bold">
                Season
              </Label>
              <Input
                id="team-season"
                value={seasonName}
                onChange={(e) => setSeasonName(e.target.value)}
                placeholder="Fall 2026"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="team-desc" className="font-bold">
                Description
              </Label>
              <Textarea
                id="team-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
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
              disabled={createTeam.isPending}
              data-testid="btn-create-team"
            >
              {createTeam.isPending ? "Creating..." : "Create team"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
