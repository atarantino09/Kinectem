import { type FormEvent, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Loader2, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Callout } from "@/components/Callout";
import { CodeBlock } from "@/components/CodeBlock";
import {
  useGetLoggedInUser,
  useListApiKeys,
  useCreateApiKey,
  useRevokeApiKey,
  useAuthLogin,
  getListApiKeysQueryKey,
  getGetLoggedInUserQueryKey,
  ApiError,
} from "@workspace/api-client-react";

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    const data = err.data as { error?: string } | null;
    if (data?.error) return data.error;
    return err.message;
  }
  if (err instanceof Error) return err.message;
  return fallback;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

// ---------------------------------------------------------------------------
// Inline login. The dev portal is a static doc site that never carries a
// session of its own, so the API-keys page is the one place we need to ask
// the visitor to sign in. We keep it intentionally minimal: email + password
// against the existing cookie-session endpoint, no signup flow.
// ---------------------------------------------------------------------------
function LoginGate({ onSuccess }: { onSuccess: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const login = useAuthLogin();

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    login.mutate(
      { data: { email, password } },
      {
        onSuccess: () => onSuccess(),
        onError: (err) =>
          setSubmitError(errorMessage(err, "Could not sign in.")),
      },
    );
  }

  return (
    <div className="my-6 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
      <h3 className="mb-1 text-base font-semibold">Sign in to manage API keys</h3>
      <p className="mb-4 text-sm text-[var(--color-fg-muted)]">
        Use the same Kinectem email and password you use on the main app. Your
        session stays in this browser only.
      </p>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--color-fg-muted)]">
            Email
          </label>
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm focus:border-[var(--color-accent)] focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--color-fg-muted)]">
            Password
          </label>
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm focus:border-[var(--color-accent)] focus:outline-none"
          />
        </div>
        {submitError && (
          <div className="text-sm text-[var(--color-warn,#b91c1c)]">
            {submitError}
          </div>
        )}
        <button
          type="submit"
          disabled={login.isPending}
          className="inline-flex items-center gap-2 rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {login.isPending && <Loader2 size={14} className="animate-spin" />}
          Sign in
        </button>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// One-shot plaintext display. Shown immediately after creation and then
// dismissed forever once the user clicks "I've copied it".
// ---------------------------------------------------------------------------
function NewKeyBanner({
  token,
  onDismiss,
}: {
  token: string;
  onDismiss: () => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="my-5 rounded-lg border-l-2 border-[var(--color-accent)] bg-[var(--color-accent-soft)] p-4">
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-accent-strong)]">
        Copy this key now
      </div>
      <p className="mb-3 text-sm text-[var(--color-fg)]">
        This is the only time the full key will be shown. Store it in a
        password manager or your service's secret store before closing this
        page — Kinectem only stores its hash.
      </p>
      <div className="mb-3 flex items-stretch gap-2">
        <code className="flex-1 break-all rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 font-mono text-[12px]">
          {token}
        </code>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard.writeText(token).then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1400);
            });
          }}
          className="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-xs font-medium hover:bg-[var(--color-surface)]"
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="text-xs font-medium text-[var(--color-accent-strong)] hover:underline"
      >
        I've saved it — dismiss
      </button>
    </div>
  );
}

function CreateKeyForm({ onCreated }: { onCreated: (token: string) => void }) {
  const [name, setName] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const create = useCreateApiKey();

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    const trimmed = name.trim();
    if (!trimmed) {
      setSubmitError("Give the key a name so you can recognize it later.");
      return;
    }
    create.mutate(
      { data: { name: trimmed } },
      {
        onSuccess: (created) => {
          setName("");
          queryClient.invalidateQueries({ queryKey: getListApiKeysQueryKey() });
          onCreated(created.token);
        },
        onError: (err) =>
          setSubmitError(errorMessage(err, "Could not create the key.")),
      },
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="my-5 flex flex-col gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 sm:flex-row sm:items-end"
    >
      <div className="flex-1">
        <label className="mb-1 block text-xs font-medium text-[var(--color-fg-muted)]">
          Key name
        </label>
        <input
          type="text"
          maxLength={80}
          placeholder="e.g. Production scheduler"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm focus:border-[var(--color-accent)] focus:outline-none"
        />
      </div>
      <button
        type="submit"
        disabled={create.isPending}
        className="inline-flex items-center justify-center gap-2 rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        {create.isPending && <Loader2 size={14} className="animate-spin" />}
        Create key
      </button>
      {submitError && (
        <div className="text-sm text-[var(--color-warn,#b91c1c)] sm:basis-full">
          {submitError}
        </div>
      )}
    </form>
  );
}

function KeysList() {
  const queryClient = useQueryClient();
  const list = useListApiKeys();
  const revoke = useRevokeApiKey();
  const [revokingId, setRevokingId] = useState<string | null>(null);

  if (list.isLoading) {
    return (
      <div className="py-6 text-sm text-[var(--color-fg-muted)]">
        Loading your keys…
      </div>
    );
  }
  if (list.error) {
    return (
      <Callout variant="warn" title="Could not load your keys">
        {errorMessage(list.error, "Try refreshing the page.")}
      </Callout>
    );
  }
  const keys = list.data?.data ?? [];
  if (keys.length === 0) {
    return (
      <p className="my-5 text-sm text-[var(--color-fg-muted)]">
        You don't have any API keys yet. Create one above.
      </p>
    );
  }

  return (
    <div className="my-5 overflow-hidden rounded-lg border border-[var(--color-border)]">
      <table className="w-full text-sm">
        <thead className="bg-[var(--color-surface)] text-left text-[11px] uppercase tracking-wider text-[var(--color-fg-subtle)]">
          <tr>
            <th className="px-3 py-2">Name</th>
            <th className="px-3 py-2">Prefix</th>
            <th className="px-3 py-2">Created</th>
            <th className="px-3 py-2">Last used</th>
            <th className="px-3 py-2">Status</th>
            <th className="px-3 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {keys.map((k) => {
            const isRevoked = !!k.revokedAt;
            return (
              <tr
                key={k.id}
                className="border-t border-[var(--color-border)] align-top"
              >
                <td className="px-3 py-2 font-medium">{k.name}</td>
                <td className="px-3 py-2 font-mono text-[12px] text-[var(--color-fg-muted)]">
                  {k.prefix}…
                </td>
                <td className="px-3 py-2 text-[var(--color-fg-muted)]">
                  {fmtDate(k.createdAt)}
                </td>
                <td className="px-3 py-2 text-[var(--color-fg-muted)]">
                  {fmtDate(k.lastUsedAt)}
                </td>
                <td className="px-3 py-2">
                  {isRevoked ? (
                    <span className="rounded bg-[var(--color-surface)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-fg-subtle)]">
                      Revoked
                    </span>
                  ) : (
                    <span className="rounded bg-[var(--color-accent-soft)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-accent-strong)]">
                      Active
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  {!isRevoked && (
                    <button
                      type="button"
                      disabled={revoke.isPending && revokingId === k.id}
                      onClick={() => {
                        if (
                          !window.confirm(
                            `Revoke "${k.name}"? Any service using this key will stop working immediately.`,
                          )
                        ) {
                          return;
                        }
                        setRevokingId(k.id);
                        revoke.mutate(
                          { id: k.id },
                          {
                            onSettled: () => {
                              setRevokingId(null);
                              queryClient.invalidateQueries({
                                queryKey: getListApiKeysQueryKey(),
                              });
                            },
                          },
                        );
                      }}
                      className="inline-flex items-center gap-1 rounded-md border border-[var(--color-border)] px-2 py-1 text-[12px] text-[var(--color-fg-muted)] hover:bg-[var(--color-surface)] disabled:opacity-50"
                      aria-label={`Revoke ${k.name}`}
                    >
                      {revoke.isPending && revokingId === k.id ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <Trash2 size={12} />
                      )}
                      Revoke
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function ApiKeysPage() {
  const queryClient = useQueryClient();
  const me = useGetLoggedInUser();
  const [freshToken, setFreshToken] = useState<string | null>(null);

  // The "logged in" probe returns 401 with code `AUTH_REQUIRED` when there
  // is no session cookie. We treat any 401 as "show the login form" rather
  // than as a hard error — every other status is a real failure.
  const isUnauthed =
    me.error instanceof ApiError && me.error.status === 401;

  return (
    <article className="prose-doc">
      <PageHeader
        eyebrow="Build"
        title="API keys"
        lede="Mint long-lived credentials so a server-side script or third-party integration can call the Kinectem API on your behalf."
      />

      <p>
        API keys begin with the literal prefix <code>kk_</code> and are sent
        as <code>Authorization: Bearer kk_…</code>. They never expire, but
        you can revoke any key from this page at any time. The plaintext
        token is shown <strong>only once</strong> at creation time — the
        server keeps just its sha256 hash.
      </p>

      {me.isLoading && (
        <div className="py-6 text-sm text-[var(--color-fg-muted)]">
          Checking your session…
        </div>
      )}

      {!me.isLoading && isUnauthed && (
        <LoginGate
          onSuccess={() => {
            queryClient.invalidateQueries({
              queryKey: getGetLoggedInUserQueryKey(),
            });
            queryClient.invalidateQueries({
              queryKey: getListApiKeysQueryKey(),
            });
          }}
        />
      )}

      {!me.isLoading && !isUnauthed && me.error && (
        <Callout variant="warn" title="Couldn't load your account">
          {errorMessage(me.error, "Try refreshing the page.")}
        </Callout>
      )}

      {!me.isLoading && !isUnauthed && !me.error && (
        <>
          <h2>Your keys</h2>
          <CreateKeyForm onCreated={(t) => setFreshToken(t)} />
          {freshToken && (
            <NewKeyBanner
              token={freshToken}
              onDismiss={() => setFreshToken(null)}
            />
          )}
          <KeysList />
        </>
      )}

      <h2>Using a key</h2>
      <CodeBlock
        tabs={[
          {
            label: "curl",
            language: "bash",
            code: `curl 'https://api.kinectem.example/api/v1/users/me' \\
  -H "Authorization: Bearer kk_a1b2c3d4e5f6…"`,
          },
          {
            label: "fetch",
            language: "typescript",
            code: `await fetch("https://api.kinectem.example/api/v1/users/me", {
  headers: { Authorization: \`Bearer \${process.env.KINECTEM_API_KEY}\` },
});`,
          },
        ]}
      />

      <Callout variant="warn" title="Treat keys like passwords">
        Anyone holding a non-revoked API key can act as you against the API.
        Store it in a secret manager, scope per integration so a single leak
        is easy to contain, and revoke immediately if you suspect exposure.
      </Callout>
    </article>
  );
}
