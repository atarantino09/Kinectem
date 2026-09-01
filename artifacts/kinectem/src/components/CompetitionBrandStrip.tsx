import { Trophy } from "lucide-react";

// Compact competition brand strip for small cards (featured-recap rails).
// Same visual language as the PostCard competition banner, just smaller.
// Render inside a Link/card — it is intentionally NOT a link itself so the
// whole card stays the click target.
export function CompetitionBrandStrip({
  name,
  logoUrl,
  brandColor,
  secondaryColor,
}: {
  name: string;
  logoUrl: string | null;
  brandColor: string | null;
  secondaryColor?: string | null;
}) {
  return (
    <div
      className="flex min-h-8 items-center gap-1.5 px-3 py-1"
      style={{
        background: brandColor
          ? secondaryColor
            ? `linear-gradient(135deg, ${brandColor} 0%, ${brandColor} 60%, ${secondaryColor} 100%)`
            : brandColor
          : "hsl(var(--primary))",
      }}
      data-testid="strip-competition-brand"
    >
      {logoUrl ? (
        <img
          src={logoUrl}
          alt=""
          className="h-4 w-4 rounded-sm bg-white/90 object-contain p-px shrink-0 shadow-sm"
        />
      ) : (
        <Trophy className="h-3 w-3 shrink-0 text-white/90 drop-shadow-sm" />
      )}
      <span className="min-w-0 truncate text-[11px] font-black uppercase tracking-widest text-white drop-shadow-sm pt-[1px]">
        {name}
      </span>
    </div>
  );
}
