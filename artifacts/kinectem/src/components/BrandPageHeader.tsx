import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type BrandPageHeaderProps = {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
};

/**
 * Shared editorial header for discovery and organizer surfaces.
 * The competition page's stronger hierarchy is intentionally expressed here
 * without changing the surrounding page information architecture.
 */
export function BrandPageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: BrandPageHeaderProps) {
  return (
    <header className={cn("app-page-header", className)}>
      <div className="app-page-header-content">
        {eyebrow ? <div className="app-kicker">{eyebrow}</div> : null}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-3xl font-black tracking-tight sm:text-4xl">
              {title}
            </h1>
            {description ? (
              <p className="mt-2 max-w-2xl text-sm font-medium leading-relaxed text-muted-foreground">
                {description}
              </p>
            ) : null}
          </div>
          {actions ? (
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {actions}
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}