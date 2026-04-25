import { Link } from "wouter";
import { ArrowRight, Code2, KeyRound, BookOpen, Terminal, FileText, Sparkles } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { CodeBlock } from "@/components/CodeBlock";

const cards = [
  {
    icon: Sparkles,
    title: "Getting started",
    body: "Sign in, get a session cookie, and call your first endpoint in under five minutes.",
    href: "/getting-started",
  },
  {
    icon: KeyRound,
    title: "Authentication",
    body: "Cookie sessions today; API keys and OAuth on the roadmap.",
    href: "/authentication",
  },
  {
    icon: BookOpen,
    title: "Conventions",
    body: "Naming, errors, pagination, deprecation — how the API behaves consistently.",
    href: "/conventions",
  },
  {
    icon: FileText,
    title: "API reference",
    body: "Every endpoint, every schema. Generated from the OpenAPI source of truth.",
    href: "/reference",
  },
  {
    icon: Code2,
    title: "Code samples",
    body: "Copy-paste curl and TypeScript snippets for the most common flows.",
    href: "/code-samples",
  },
  {
    icon: Terminal,
    title: "Changelog",
    body: "What changed and what's coming. Versioning is /api/v1; breaking changes go to v2.",
    href: "/changelog",
  },
];

export default function OverviewPage() {
  return (
    <article className="prose-doc">
      <PageHeader
        eyebrow="Kinectem API"
        title="Build on Kinectem"
        lede={
          <>
            A versioned JSON API for the youth-sports recruiting platform. Stable
            conventions, an OpenAPI source of truth, and generated clients for
            web and mobile.
          </>
        }
      />

      <div className="not-prose mb-10 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <Link
              key={card.href}
              href={card.href}
              className="group block rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-4 no-underline transition-all hover:border-[var(--color-border-strong)] hover:!no-underline hover:shadow-sm"
            >
              <div className="mb-2 flex items-center gap-2">
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-[var(--color-accent-soft)] text-[var(--color-accent-strong)]">
                  <Icon size={14} />
                </span>
                <span className="font-semibold text-[var(--color-fg)]">
                  {card.title}
                </span>
                <ArrowRight
                  size={14}
                  className="ml-auto text-[var(--color-fg-subtle)] transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--color-fg-muted)]"
                />
              </div>
              <p className="text-sm text-[var(--color-fg-muted)]">{card.body}</p>
            </Link>
          );
        })}
      </div>

      <h2>What this API does</h2>
      <p>
        Kinectem powers profiles, teams, organizations, posts, messages, and
        media for youth athletes, families, and coaches. The same API serves
        the web client at <code>artifacts/kinectem</code>, any future mobile
        client, and approved third-party integrators.
      </p>

      <h2>Source of truth</h2>
      <p>
        The OpenAPI 3.0 document at{" "}
        <code>lib/api-spec/openapi.yaml</code> is the single source of truth.
        The Express server validates every incoming request against it; the
        TypeScript client and Zod schemas are generated from it. This portal
        loads that same file at runtime — what you see here is what the server
        enforces.
      </p>

      <h2>Quick taste</h2>
      <CodeBlock
        tabs={[
          {
            label: "curl",
            language: "bash",
            code: `curl -i 'https://api.kinectem.example/api/v1/users/me' \\
  --cookie 'kinectem_session=…'`,
          },
          {
            label: "typescript",
            language: "typescript",
            code: `import { useGetLoggedInUser } from "@workspace/api-client-react";

function Header() {
  const { data, isLoading } = useGetLoggedInUser();
  if (isLoading) return null;
  return <span>Hello, {data?.firstName}</span>;
}`,
          },
        ]}
      />

      <p className="text-sm text-[var(--color-fg-muted)]">
        Continue with <Link href="/getting-started">Getting started</Link> →
      </p>
    </article>
  );
}
