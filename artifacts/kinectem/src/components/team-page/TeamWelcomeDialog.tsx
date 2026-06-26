import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Users, Newspaper, Sparkles, ArrowRight } from "lucide-react";
import type { LucideIcon } from "lucide-react";

// Shown once, right after a coach claims their team, to orient a brand-new
// visitor: what Kinectem is and the two moves that make it sing — build the
// roster, then recap games so the team's story grows over the season.

const STEPS: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: Users,
    title: "Build your roster",
    body: "Add your players (and their parents). Everyone's in the loop from day one.",
  },
  {
    icon: Newspaper,
    title: "Recap your games",
    body: "After each game, post a quick recap. A minute of writing captures the moments that matter.",
  },
  {
    icon: Sparkles,
    title: "Watch the story grow",
    body: "Every recap becomes part of your team's — and each player's — permanent highlight reel that families follow all season.",
  },
];

export function TeamWelcomeDialog({
  teamName,
  open,
  onOpenChange,
  onAddPlayers,
}: {
  teamName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAddPlayers: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="dialog-team-welcome">
        <DialogHeader>
          <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-bold uppercase tracking-wider text-primary">
            <Sparkles className="h-3.5 w-3.5" />
            Welcome to Kinectem
          </span>
          <DialogTitle className="text-2xl font-black tracking-tight">
            {teamName} now has a home.
          </DialogTitle>
          <DialogDescription className="text-sm">
            Kinectem turns your games into a living story your players and their
            families follow all season long. Here's how to make it shine — in
            three quick steps.
          </DialogDescription>
        </DialogHeader>

        <ol className="space-y-3">
          {STEPS.map((s, i) => {
            const Icon = s.icon;
            return (
              <li
                key={s.title}
                className="flex items-start gap-3 rounded-xl border border-border bg-muted/40 p-3"
                data-testid={`welcome-step-${i + 1}`}
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Icon className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-black tracking-tight">
                    {i + 1}. {s.title}
                  </p>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {s.body}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>

        <DialogFooter>
          <Button
            variant="outline"
            className="font-bold"
            onClick={() => onOpenChange(false)}
            data-testid="button-welcome-explore"
          >
            Look around first
          </Button>
          <Button
            className="font-bold"
            onClick={() => {
              onOpenChange(false);
              onAddPlayers();
            }}
            data-testid="button-welcome-add-players"
          >
            Add your players
            <ArrowRight className="ml-1.5 h-4 w-4" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
