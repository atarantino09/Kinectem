import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type EmptyStateProps = {
  icon: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
};

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div className={cn("app-empty-state", className)}>
      <div className="app-empty-state-icon" aria-hidden="true">
        {icon}
      </div>
      <p className="font-black tracking-tight">{title}</p>
      {description ? (
        <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
          {description}
        </p>
      ) : null}
      {action ? <div className="pt-1">{action}</div> : null}
    </div>
  );
}