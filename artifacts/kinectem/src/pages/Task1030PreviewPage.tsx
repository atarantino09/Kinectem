import { useState } from "react";
import { PostClaimSetupGuide } from "@/components/PostClaimSetupGuide";
import { Button } from "@/components/ui/button";
import {
  Building2,
  Compass,
  ListPlus,
  MapPin,
  Shield,
  Users,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

export default function Task1030PreviewPage() {
  const [open, setOpen] = useState(true);
  const [reminderVisible, setReminderVisible] = useState(true);
  const { toast } = useToast();

  return (
    <main className="min-h-screen bg-muted/30">
      <header className="border-b bg-background/95 px-5 py-3 shadow-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <div className="flex items-center gap-2 font-black">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-primary text-primary-foreground">
              K
            </div>
            Kinectem
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setOpen(true)}
              data-testid="btn-preview-guides"
            >
              <Compass className="h-4 w-4" />
              Guides
            </Button>
            <div className="grid h-9 w-9 place-items-center rounded-full bg-secondary text-xs font-black">
              WA
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
        {reminderVisible && (
          <div
            className="relative overflow-hidden rounded-2xl border border-blue-200 bg-gradient-to-r from-blue-50 via-white to-violet-50 p-4 shadow-sm"
            data-testid="banner-preview-org-setup"
          >
            <div className="absolute -right-10 -top-10 h-28 w-28 rounded-full bg-blue-200/40 blur-3xl" />
            <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center">
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-blue-100 text-blue-700 ring-1 ring-blue-200">
                <ListPlus className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-black tracking-tight">
                  Finish setting up Westfield Athletic Club
                </p>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  Send your pre-invite message, add coaches, and invite every
                  team. Keep this reminder here until your club is ready.
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="brand"
                  onClick={() => setOpen(true)}
                  data-testid="btn-preview-continue-setup"
                >
                  Continue setup
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setReminderVisible(false);
                    toast({
                      title: "Setup marked complete",
                      description:
                        "The reminder has been removed. You can reopen the guide from Guides.",
                    });
                  }}
                  data-testid="btn-preview-finish-setup"
                >
                  Mark setup complete
                </Button>
              </div>
            </div>
          </div>
        )}

        <section className="app-surface relative overflow-hidden bg-card">
          <div className="h-28 bg-gradient-to-r from-blue-700 via-blue-600 to-violet-600 sm:h-36" />
          <div className="px-5 pb-5">
            <div className="-mt-10 flex flex-col gap-4 sm:-mt-12 sm:flex-row sm:items-end">
              <div className="grid h-20 w-20 shrink-0 place-items-center rounded-2xl border-4 border-card bg-white text-blue-700 shadow-md sm:h-24 sm:w-24">
                <Building2 className="h-10 w-10" />
              </div>
              <div className="min-w-0 flex-1 sm:pb-1">
                <h1 className="text-2xl font-black tracking-tight sm:text-3xl">
                  Westfield Athletic Club
                </h1>
                <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
                  <MapPin className="h-4 w-4" />
                  Westfield, New Jersey
                </p>
              </div>
              <Button type="button" size="sm" variant="outline">
                <Shield className="h-4 w-4" />
                Manage
              </Button>
            </div>
            <p className="mt-4 max-w-3xl text-sm leading-relaxed text-muted-foreground">
              Home of Westfield youth athletics. Follow our teams, schedules,
              announcements, and game stories throughout the season.
            </p>
          </div>
        </section>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <section className="app-surface p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-wider text-primary">
                  Organization feed
                </p>
                <h2 className="mt-1 text-xl font-black">Latest updates</h2>
              </div>
              <Button type="button" size="sm" variant="brand">
                New post
              </Button>
            </div>
            <div className="mt-5 rounded-xl border bg-muted/30 p-5">
              <p className="font-bold">Welcome to the new season</p>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Team pages are ready. Coaches and families will begin joining
                as invitations are sent.
              </p>
            </div>
          </section>
          <aside className="app-surface p-5">
            <div className="flex items-center gap-2">
              <Users className="h-5 w-5 text-primary" />
              <h2 className="font-black">Teams</h2>
            </div>
            <div className="mt-4 space-y-3">
              {["U10 Blue", "U12 White", "U14 Premier"].map((team) => (
                <div
                  key={team}
                  className="flex items-center gap-3 rounded-xl border p-3"
                >
                  <div className="grid h-9 w-9 place-items-center rounded-full bg-blue-100 text-xs font-black text-blue-700">
                    W
                  </div>
                  <span className="text-sm font-bold">{team}</span>
                </div>
              ))}
            </div>
          </aside>
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl"
          data-testid="dialog-task-1030-preview"
        >
          <DialogHeader className="pr-7">
            <DialogTitle className="font-black tracking-tight">
              Finish setting up your organization
            </DialogTitle>
            <DialogDescription>
              Claiming is complete. Click any unfinished step to go directly
              to it.
            </DialogDescription>
          </DialogHeader>
          <PostClaimSetupGuide
            organizationName="Westfield Athletic Club"
            onAction={(action) =>
              toast({
                title: "Preview only",
                description: `This would open the ${action === "preInvite" ? "pre-invite message" : action === "coaches" ? "bulk coach invitation" : "Roster Outreach"} tool.`,
              })
            }
          />
        </DialogContent>
      </Dialog>
    </main>
  );
}