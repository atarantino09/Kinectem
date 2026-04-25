import { type ReactNode, useEffect } from "react";

type PageHeaderProps = {
  eyebrow?: string;
  title: string;
  lede?: ReactNode;
};

export function PageHeader({ eyebrow, title, lede }: PageHeaderProps) {
  useEffect(() => {
    document.title = `${title} · Kinectem Developers`;
  }, [title]);
  return (
    <header className="mb-10 border-b border-[var(--color-border)] pb-8">
      {eyebrow && (
        <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--color-accent)]">
          {eyebrow}
        </div>
      )}
      <h1 className="text-[2.25rem] font-semibold leading-[1.1] tracking-tight">
        {title}
      </h1>
      {lede && (
        <p className="mt-3 max-w-[58ch] text-[1.05rem] text-[var(--color-fg-muted)]">
          {lede}
        </p>
      )}
    </header>
  );
}
