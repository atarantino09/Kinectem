import { useState } from "react";
import { Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useWhoami } from "@/hooks/useWhoami";
import type { CompetitionParticipant } from "@/pages/CompetitionPage";
import { PartnerWizard } from "./PartnerWizard";

export { MAX_PARTNER_ASSIGNMENTS, slotUnavailable } from "./model";

type Props = {
  competitionId: string;
  slug: string;
  participants: CompetitionParticipant[];
};

export function CompetitionPartnerLinks(props: Props) {
  const { data: who } = useWhoami();
  const role = who?.isMasquerading ? who.viewingAs?.role : who?.realUser?.role;
  const isAdmin = !!who?.authenticated && !who.isMasquerading && role === "admin";
  const sessionKey = `${props.competitionId}:${
    who?.isMasquerading ? who.viewingAs?.id : who?.realUser?.id
  }`;
  if (!isAdmin) return null;
  return <Tool key={sessionKey} {...props} />;
}

function Tool(props: Props) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="partner-links-tool">
      <Button
        variant="outline"
        size="sm"
        className="font-bold border-primary/40"
        onClick={() => setOpen(true)}
        data-testid="button-link-partner-teams"
      >
        <Link2 className="w-4 h-4 mr-1.5" /> Assign team schedules
      </Button>
      <Dialog
        open={open}
        onOpenChange={(v) => {
          if (!v && submitting) return;
          setOpen(v);
        }}
      >
        <DialogContent
          className={`sm:max-w-5xl p-0 gap-0 flex flex-col overflow-hidden h-[calc(100dvh-2rem)] sm:h-auto sm:max-h-[90dvh] ${submitting ? "[&>button]:hidden" : ""}`}
          aria-busy={submitting}
          data-testid="dialog-partner-links"
          onEscapeKeyDown={(e) => submitting && e.preventDefault()}
          onPointerDownOutside={(e) => submitting && e.preventDefault()}
          onInteractOutside={(e) => submitting && e.preventDefault()}
        >
          {open && (
            <PartnerWizard {...props} onSubmitting={setSubmitting} />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
