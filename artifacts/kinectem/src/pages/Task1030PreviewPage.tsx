import { useState } from "react";
import { PostClaimSetupGuide } from "@/components/PostClaimSetupGuide";
import { Button } from "@/components/ui/button";
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
  const { toast } = useToast();

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-violet-50 p-6">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] max-w-4xl items-center justify-center">
        <div className="text-center">
          <p className="text-sm font-bold text-muted-foreground">
            Development preview · Task #1030
          </p>
          <h1 className="mt-2 text-3xl font-black tracking-tight">
            Post-claim organization setup
          </h1>
          <Button className="mt-5" variant="brand" onClick={() => setOpen(true)}>
            Reopen setup guide
          </Button>
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