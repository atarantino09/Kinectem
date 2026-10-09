import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { NumericBadge } from "@/components/ui/numeric-badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  CalendarCheck,
  ChevronDown,
  Gift,
  Megaphone,
  Send,
  Trophy,
  Upload,
  Users,
} from "lucide-react";

// Organizer-only walkthrough of the competition lifecycle. Rendered on the
// public competition page (canManage only) and in the operator console —
// never shown to public visitors. Opens with the zero-disruption reassurance,
// walks the setup steps, and lands on the branding payoff as the
// emphasized climax (themed with the competition's brand colors).

const STEPS = [
  {
    icon: Trophy,
    title: "Create your competition",
    body: "Name, dates, logo, and colors — your branded public page goes live instantly.",
  },
  {
    icon: Gift,
    title: "Email your teams your promo code",
    body: "New organizations that sign up with your code get 25% off their first year on Kinectem — and your competition earns a 15% commission on what they pay. A ready-made message is waiting in the Earn with your promo code section below.",
  },
  {
    icon: Upload,
    title: "Upload your schedule",
    body: "One CSV from whatever tool you already use. We pull every team out of it automatically — no manual entry.",
  },
  {
    icon: Send,
    title: "Send the public link to your teams",
    body: "Share your competition page link with your teams — one message, one link. That's all the outreach it takes.",
  },
  {
    icon: Users,
    title: "Teams claim their spot",
    body: "Coaches claim their team into their existing Kinectem team page — or create a team page on the spot if they're new here.",
  },
  {
    icon: CalendarCheck,
    title: "Schedules land automatically",
    body: "The moment a team is claimed, their competition schedule appears on their Kinectem team page. Nobody types anything twice.",
  },
] as const;

export function CompetitionHowItWorks({
  brandColor,
  secondaryColor,
  defaultOpen = false,
  className,
}: {
  brandColor?: string | null;
  secondaryColor?: string | null;
  defaultOpen?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  // The claim-link resolve can finish after mount (e.g. for signed-in
  // managers the section renders immediately), so react when defaultOpen
  // flips to true. Never force-close — the user can still collapse it.
  useEffect(() => {
    if (defaultOpen) setOpen(true);
  }, [defaultOpen]);

  const payoffBg = brandColor
    ? secondaryColor
      ? `linear-gradient(135deg, ${brandColor} 0%, ${brandColor} 55%, ${secondaryColor} 100%)`
      : brandColor
    : "linear-gradient(135deg, #1e293b 0%, #334155 100%)";

  return (
    <Card
      className={`competition-section-surface rounded-xl border-border shadow-sm overflow-hidden bg-card ${className ?? ""}`}
      data-testid="card-how-it-works"
    >
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="competition-section-trigger w-full flex items-center justify-between gap-3 p-5 text-left hover:bg-muted/40 transition-colors"
            data-testid="btn-how-it-works-toggle"
          >
            <div className="min-w-0">
              <h2 className="text-base font-black tracking-tight">
                How your competition works on Kinectem
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                A 2-minute guide for organizers — only you can see this.
              </p>
            </div>
            <ChevronDown
              className={`w-5 h-5 shrink-0 text-muted-foreground transition-transform duration-200 ${
                open ? "rotate-180" : ""
              }`}
            />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="pt-0 p-5 space-y-5 border-t border-border/50 mt-1">
            {/* Zero-disruption reassurance — the ice-breaker, always first. */}
            <div
              className="rounded-xl border border-border bg-muted/40 p-5 shadow-sm"
              data-testid="text-how-it-works-reassurance"
            >
              <p className="text-sm font-black tracking-tight text-foreground">
                Nothing changes about the way you run your competition.
              </p>
              <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
                Keep your registration, seeding, scheduling tools, and day-of
                operations exactly as they are. You just come to Kinectem once
                your schedule is created — and upload it.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {STEPS.map((s, i) => (
                <div
                  key={s.title}
                  className="flex gap-4 rounded-xl border border-border bg-card p-4 shadow-sm hover:shadow-md transition-shadow"
                  data-testid={`step-how-it-works-${i + 1}`}
                >
                  <div className="shrink-0 flex flex-col items-center gap-2 mt-0.5">
                    <NumericBadge size={28} className="bg-primary/10 text-primary text-xs font-black shadow-sm">
                      {i + 1}
                    </NumericBadge>
                    <s.icon className="w-4 h-4 text-muted-foreground/60" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-bold tracking-tight text-foreground">{s.title}</p>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{s.body}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* The payoff — step 5, deliberately louder than the rest. */}
            <div
              className="rounded-xl p-6 text-white relative overflow-hidden shadow-md"
              style={{ background: payoffBg }}
              data-testid="step-how-it-works-payoff"
            >
              <div className="absolute -right-4 -bottom-4 opacity-10 rotate-12 pointer-events-none">
                <Megaphone className="w-32 h-32" />
              </div>
              <div className="relative z-10">
                <div className="flex items-center gap-2 mb-2">
                  <Megaphone className="w-4 h-4 shrink-0 drop-shadow-sm" />
                  <p className="text-[11px] font-black uppercase tracking-widest opacity-90 drop-shadow-sm">
                    Step {STEPS.length + 1} · The payoff
                  </p>
                </div>
                <p className="text-lg sm:text-xl font-black tracking-tight drop-shadow-sm">
                  Your brand on every game recap.
                </p>
                <p className="mt-1.5 text-sm opacity-95 drop-shadow-sm max-w-2xl leading-relaxed">
                  After the games are played, teams write game recaps — and every
                  recap from your competition carries your branding. You pick the
                  best ones to feature front-and-center on this page. Every story
                  a team tells becomes exposure for your competition: free, and
                  it compounds with every game.
                </p>
              </div>
            </div>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
