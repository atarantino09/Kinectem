import { type ReactNode, useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { Menu, X } from "lucide-react";

const NAV_SECTIONS: { title: string; items: { label: string; href: string }[] }[] = [
  {
    title: "Start here",
    items: [
      { label: "Overview", href: "/" },
      { label: "Getting started", href: "/getting-started" },
    ],
  },
  {
    title: "Concepts",
    items: [
      { label: "Authentication", href: "/authentication" },
      { label: "Conventions", href: "/conventions" },
    ],
  },
  {
    title: "Build",
    items: [
      { label: "API reference", href: "/reference" },
      { label: "Code samples", href: "/code-samples" },
      { label: "API keys", href: "/api-keys" },
    ],
  },
  {
    title: "Releases",
    items: [{ label: "Changelog", href: "/changelog" }],
  },
];

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const [location] = useLocation();
  return (
    <nav className="px-6 py-8 text-sm">
      <div className="space-y-7">
        {NAV_SECTIONS.map((section) => (
          <div key={section.title}>
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-fg-subtle)]">
              {section.title}
            </div>
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const isActive =
                  item.href === "/"
                    ? location === "/" || location === ""
                    : location === item.href || location.startsWith(item.href + "/");
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      className={[
                        "block rounded-md px-2 py-1.5 transition-colors",
                        "no-underline hover:!no-underline",
                        isActive
                          ? "bg-[var(--color-accent-soft)] text-[var(--color-accent-strong)] font-medium"
                          : "text-[var(--color-fg)] hover:bg-[var(--color-surface)]",
                      ].join(" ")}
                    >
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      <div className="mt-10 border-t border-[var(--color-border)] pt-6 text-[11px] text-[var(--color-fg-subtle)]">
        <div className="mb-1 font-mono uppercase tracking-wider">Spec</div>
        <div>OpenAPI 3.0.3</div>
        <div>Kinectem API v0.1.0</div>
      </div>
    </nav>
  );
}

function Header({ onMenu }: { onMenu: () => void }) {
  return (
    <header className="sticky top-0 z-30 border-b border-[var(--color-border)] bg-[var(--color-bg)]/90 backdrop-blur">
      <div className="flex h-14 items-center justify-between px-4 sm:px-6">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onMenu}
            className="-ml-1 rounded-md p-1.5 text-[var(--color-fg-muted)] hover:bg-[var(--color-surface)] lg:hidden"
            aria-label="Open navigation"
          >
            <Menu size={18} />
          </button>
          <Link
            href="/"
            className="flex items-center gap-2 text-[var(--color-fg)] no-underline hover:!no-underline"
          >
            <Logo />
            <span className="font-semibold tracking-tight">Kinectem</span>
            <span className="text-[var(--color-fg-subtle)]">/</span>
            <span className="text-sm font-medium text-[var(--color-fg-muted)]">
              developers
            </span>
          </Link>
        </div>
        <div className="flex items-center gap-1 text-sm">
          <a
            href="/api/docs"
            className="rounded-md px-3 py-1.5 text-[var(--color-fg-muted)] no-underline hover:bg-[var(--color-surface)] hover:!no-underline hover:text-[var(--color-fg)]"
          >
            Live spec
          </a>
          <Link
            href="/reference"
            className="hidden rounded-md px-3 py-1.5 text-[var(--color-fg-muted)] no-underline hover:bg-[var(--color-surface)] hover:!no-underline hover:text-[var(--color-fg)] sm:inline-block"
          >
            Reference
          </Link>
          <a
            href="https://github.com/kinectem"
            target="_blank"
            rel="noreferrer"
            className="rounded-md px-3 py-1.5 text-[var(--color-fg-muted)] no-underline hover:bg-[var(--color-surface)] hover:!no-underline hover:text-[var(--color-fg)]"
          >
            GitHub
          </a>
        </div>
      </div>
    </header>
  );
}

function Logo() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
      <rect
        x="1"
        y="1"
        width="20"
        height="20"
        rx="5"
        fill="var(--color-accent)"
      />
      <path
        d="M7 6.5v9M7 11l5-4.5M7 11l5 4.5M14 6.5l1.6 4.5L14 15.5"
        stroke="white"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

function Footer() {
  return (
    <footer className="mt-24 border-t border-[var(--color-border)] py-8 text-xs text-[var(--color-fg-subtle)]">
      <div className="mx-auto flex max-w-3xl flex-col gap-2 px-6 sm:flex-row sm:items-center sm:justify-between">
        <div>Kinectem API · {new Date().getFullYear()}</div>
        <div className="flex items-center gap-4">
          <Link href="/changelog" className="text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)]">
            Changelog
          </Link>
          <a
            href="https://github.com/kinectem"
            target="_blank"
            rel="noreferrer"
            className="text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)]"
          >
            GitHub
          </a>
          <a
            href="/api/docs"
            className="text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)]"
          >
            Live spec
          </a>
        </div>
      </div>
    </footer>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [location] = useLocation();

  useEffect(() => {
    setMobileOpen(false);
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
    }
  }, [location]);

  return (
    <div className="min-h-screen">
      <Header onMenu={() => setMobileOpen((v) => !v)} />

      <div className="mx-auto flex w-full max-w-7xl">
        {/* Desktop sidebar */}
        <aside className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-64 flex-shrink-0 overflow-y-auto border-r border-[var(--color-border)] lg:block">
          <Sidebar />
        </aside>

        {/* Mobile drawer */}
        {mobileOpen && (
          <div
            className="fixed inset-0 z-40 lg:hidden"
            role="dialog"
            aria-modal="true"
          >
            <div
              className="absolute inset-0 bg-black/30"
              onClick={() => setMobileOpen(false)}
            />
            <aside className="absolute inset-y-0 left-0 w-72 max-w-[80%] overflow-y-auto bg-[var(--color-bg)] shadow-xl">
              <div className="flex h-14 items-center justify-between border-b border-[var(--color-border)] px-4">
                <span className="font-semibold tracking-tight">Menu</span>
                <button
                  type="button"
                  onClick={() => setMobileOpen(false)}
                  className="rounded-md p-1.5 text-[var(--color-fg-muted)] hover:bg-[var(--color-surface)]"
                  aria-label="Close navigation"
                >
                  <X size={18} />
                </button>
              </div>
              <Sidebar onNavigate={() => setMobileOpen(false)} />
            </aside>
          </div>
        )}

        <main className="min-w-0 flex-1">
          <div className="mx-auto w-full max-w-3xl px-6 py-12 sm:px-10">
            {children}
            <Footer />
          </div>
        </main>
      </div>
    </div>
  );
}
