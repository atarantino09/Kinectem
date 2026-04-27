import { Link } from "wouter";
import { PageHeader } from "@/components/PageHeader";
import { Callout } from "@/components/Callout";

type Change = { type: "added" | "changed" | "deprecated" | "fixed"; text: React.ReactNode };
type Entry = { version: string; date: string; status?: "current"; changes: Change[] };

const ENTRIES: Entry[] = [
  {
    version: "v0.1.1",
    date: "2026-04-26",
    status: "current",
    changes: [
      { type: "changed", text: <>Internal: API server route handlers split from a single 7k-line module into per-domain files under <code>artifacts/api-server/src/routes/</code> (auth, users, organizations, teams, posts, drafts, messages, guardians, …). No URL or response shape changes — every endpoint is byte-identical.</> },
      { type: "changed", text: <>Cross-cutting helpers extracted to <code>src/lib/</code> (<code>post-stats.ts</code>, <code>article-tagging.ts</code>, <code>team-follow.ts</code>, <code>guardian-confirmations.ts</code>) and auth middlewares moved to <code>src/middlewares/auth.ts</code>.</> },
      { type: "fixed", text: <>Removed leftover <code>Bearer stub-clerk-session-token</code> fallback from the React client; the cookie session is now the only credential.</> },
      { type: "added", text: <>New <code>queryOpts()</code> helper exported from <code>@workspace/api-client-react</code>: a typed wrapper for passing partial <code>UseQueryOptions</code> to generated <code>useXxx</code> hooks without an <code>as never</code> escape hatch.</> },
    ],
  },
  {
    version: "v0.1.0",
    date: "2026-04-25",
    changes: [
      { type: "added", text: <>Public developer portal at <code>/dev-portal</code> with overview, getting started, authentication, conventions, interactive reference, and code samples.</> },
      { type: "added", text: <>OpenAPI 3.0.3 source of truth at <code>lib/api-spec/openapi.yaml</code>; React-Query and Zod clients are generated from it.</> },
      { type: "added", text: <>Cookie-session authentication on <code>/api/v1/auth/login</code>, <code>/auth/signup</code>, <code>/auth/logout</code>.</> },
      { type: "added", text: <>Standard error envelope with stable <code>code</code> values; cursor-based pagination on every list endpoint.</> },
      { type: "deprecated", text: <><code>GET /auth/users</code> (development helper); <code>POST</code> aliases for <code>/posts/&#123;postId&#125;/reactions</code>, <code>/notifications/&#123;id&#125;/read</code>, and <code>/notifications/email-preference</code>.</> },
    ],
  },
];

const TYPE_LABEL: Record<Change["type"], { label: string; color: string; bg: string }> = {
  added: { label: "Added", color: "var(--color-tip)", bg: "var(--color-tip-soft)" },
  changed: { label: "Changed", color: "var(--color-info)", bg: "var(--color-info-soft)" },
  deprecated: { label: "Deprecated", color: "var(--color-warn)", bg: "var(--color-warn-soft)" },
  fixed: { label: "Fixed", color: "var(--color-accent-strong)", bg: "var(--color-accent-soft)" },
};

export default function ChangelogPage() {
  return (
    <article className="prose-doc">
      <PageHeader
        eyebrow="Releases"
        title="Changelog"
        lede="What's new, what's changed, and what's been deprecated. Backwards-incompatible changes never land in /api/v1 — they ship to /api/v2."
      />

      <Callout variant="info">
        The current public base path is <code>/api/v1</code>. See{" "}
        <Link href="/conventions">Conventions → Versioning</Link> for the
        rules that govern what counts as breaking.
      </Callout>

      <div className="not-prose">
        {ENTRIES.map((entry) => (
          <section
            key={entry.version}
            className="mt-8 border-t border-[var(--color-border)] pt-8 first:mt-0 first:border-t-0 first:pt-0"
          >
            <header className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 className="m-0 font-mono text-xl font-semibold tracking-tight">
                {entry.version}
              </h2>
              {entry.status === "current" && (
                <span className="rounded-full bg-[var(--color-tip-soft)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-tip)]">
                  Current
                </span>
              )}
              <time className="text-sm text-[var(--color-fg-subtle)]">
                {entry.date}
              </time>
            </header>
            <ul className="space-y-3">
              {entry.changes.map((change, i) => {
                const t = TYPE_LABEL[change.type];
                return (
                  <li key={i} className="flex gap-3">
                    <span
                      className="mt-0.5 inline-flex h-5 shrink-0 items-center rounded px-1.5 text-[10px] font-semibold uppercase tracking-wider"
                      style={{ color: t.color, background: t.bg }}
                    >
                      {t.label}
                    </span>
                    <span className="text-[var(--color-fg)]">{change.text}</span>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>

      <h2>What's next</h2>
      <ul>
        <li>
          <strong>API keys</strong> — long-lived <code>X-API-Key</code> for
          server-to-server callers. Reserved in the spec; not yet active.
        </li>
        <li>
          <strong>OAuth 2.0 + PKCE</strong> — third-party apps acting on
          behalf of a user.
        </li>
        <li>
          <strong>Webhooks</strong> — push notifications for asset processing
          and post events.
        </li>
      </ul>
    </article>
  );
}
