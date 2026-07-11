import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  CalendarCheck,
  ChevronDown,
  Megaphone,
  Send,
  Trophy,
  Upload,
  Users,
} from "lucide-react";

// Organizer-only walkthrough of the competition lifecycle. Rendered on the
// public competition page (canManage only) and in the operator console —
// never shown to public visitors. Opens with the zero-disruption reassurance,
// walks the five setup steps, and lands on the branding payoff as the
// emphasized climax (themed with the competition's brand colors).

const STEPS = [
  {
    icon: Trophy,
    title: "Create your competition",
    body: "Name, dates, logo, and colors — your branded public page goes live instantly.",
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
    body: "The moment a team claims, their competition schedule appears on their Kinectem team page. Nobody types anything twice.",
  },
] as const;

export function CompetitionHowItWorks({
  brandColor,
  secondaryColor,
  defaultOpen = false,
}: {
  brandColor?: string | null;
  secondaryColor?: string | null;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  const payoffBg = brandColor
    ? secondaryColor
      ? `linear-gradient(135deg, ${brandColor} 0%, ${brandColor} 55%, ${secondaryColor} 100%)`
      : brandColor
    : "linear-gradient(135deg, #1e293b 0%, #334155 100%)";

  return (
    <Card
      className="rounded-xl border-border overflow-hidden"
      data-testid="card-how-it-works"
    >
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="w-full flex items-center justify-between gap-3 p-5 text-left"
            data-testid="btn-how-it-works-toggle"
          >
            <div className="min-w-0">
              <h2 className="text-base font-black tracking-tight">
                How your competition works on Kinectem
              </h2>
              <p className="text-xs text-muted-foreground">
                A 2-minute guide for organizers — only you can see this.
              </p>
            </div>
            <ChevronDown
              className={`w-4 h-4 shrink-0 text-muted-foreground transition-transform ${
                open ? "rotate-180" : ""
              }`}
            />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="pt-0 p-5 space-y-4">
            {/* Zero-disruption reassurance — the ice-breaker, always first. */}
            <div
              className="rounded-lg border border-border bg-muted/50 p-4"
              data-testid="text-how-it-works-reassurance"
            >
              <p className="text-sm font-black tracking-tight">
                Nothing changes about the way you run your competition.
              </p>
              <p className="text-sm text-muted-foreground">
                Keep your registration, seeding, scheduling tools, and day-of
                operations exactly as they are. You just come to Kinectem once
                your schedule is created — and upload it.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {STEPS.map((s, i) => (
                <div
                  key={s.title}
                  className="flex gap-3 rounded-lg border border-border p-3.5"
                  data-testid={`step-how-it-works-${i + 1}`}
                >
                  <div className="shrink-0 flex flex-col items-center gap-1.5">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-xs font-black">
                      {i + 1}
                    </span>
                    <s.icon className="w-4 h-4 text-muted-foreground" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-bold">{s.title}</p>
                    <p className="text-xs text-muted-foreground">{s.body}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* The payoff — step 5, deliberately louder than the rest. */}
            <div
              className="rounded-lg p-5 text-white"
              style={{ background: payoffBg }}
              data-testid="step-how-it-works-payoff"
            >
              <div className="flex items-center gap-2">
                <Megaphone className="w-4 h-4 shrink-0 drop-shadow-sm" />
                <p className="text-[11px] font-black uppercase tracking-widest opacity-90 drop-shadow-sm">
                  Step 6 · The payoff
                </p>
              </div>
              <p className="mt-1.5 text-base font-black tracking-tight drop-shadow-sm">
                Your brand on every game story.
              </p>
              <p className="mt-1 text-sm opacity-95 drop-shadow-sm">
                After the games are played, teams write game recaps — and every
                recap from your competition carries your branding. You pick the
                best ones to feature front-and-center on this page. Every story
                a team tells becomes exposure for your competition: free, and
                it compounds with every game.
              </p>
            </div>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
