import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface Benefit {
  emoji: string;
  role: string;
  body: string;
}

const ATHLETE: Benefit = {
  emoji: "🌟",
  role: "Athlete",
  body:
    "Kinectem builds your athletic story automatically, tracking your journey season by season as every game recap your coach writes becomes part of a permanent digital storybook that's yours forever.",
};

const REST: Benefit[] = [
  {
    emoji: "❤️",
    role: "Parent",
    body:
      "Kinectem gives your kid the recognition they deserve from the people who matter while protecting them from everyone else, so you can finally be the proud parent in the stands without worrying about who's watching.",
  },
  {
    emoji: "📋",
    role: "Coach",
    body:
      "Kinectem ends player discovery roulette with a searchable database of motivated athletes — built into the same platform your org runs on — so you can finally find the athletes you'd never have crossed paths with otherwise.",
  },
  {
    emoji: "🏆",
    role: "Org Admin",
    body:
      "Kinectem gives your coaches the right platform to write game recaps that turn into a permanent digital home for your program — one that helps new families discover your organization, archives every championship, and finally makes your work online match your work in person.",
  },
];

function BenefitRow({ benefit }: { benefit: Benefit }) {
  return (
    <li className="flex gap-3">
      <span aria-hidden className="text-lg leading-6 shrink-0">
        {benefit.emoji}
      </span>
      <p className="text-sm leading-6">
        <span className="font-bold">{benefit.role}</span>
        <span className="text-muted-foreground"> — {benefit.body}</span>
      </p>
    </li>
  );
}

export function InviteBenefitsCard() {
  const [expanded, setExpanded] = useState(false);
  const restId = "invite-benefits-rest";

  return (
    <Card className="rounded-xl border-border">
      <CardContent className="p-6 space-y-4">
        <div className="space-y-1">
          <h2 className="font-black tracking-tight text-lg">
            What is Kinectem?
          </h2>
          <p className="text-sm text-muted-foreground leading-6">
            Kinectem is the youth-sports social platform where the next
            generation of athletes gets seen.
          </p>
        </div>

        <ul className="space-y-3">
          <BenefitRow benefit={ATHLETE} />
        </ul>

        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-controls={restId}
          className="flex items-center gap-1 text-sm font-bold text-primary hover:underline"
          data-testid="btn-invite-benefits-toggle"
        >
          {expanded ? "Show less" : "See more"}
          <ChevronDown
            className={cn(
              "w-4 h-4 transition-transform",
              expanded && "rotate-180",
            )}
            aria-hidden
          />
        </button>

        {expanded && (
          <ul id={restId} className="space-y-3 pt-1">
            {REST.map((b) => (
              <BenefitRow key={b.role} benefit={b} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
