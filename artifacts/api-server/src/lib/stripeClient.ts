import Stripe from "stripe";
import { logger } from "./logger.js";

// Resolve the Stripe secret key, preferring the Replit "stripe" connector and
// falling back to a STRIPE_SECRET_KEY env var (local dev / CI / tests). Per the
// connector docs the proxy-issued token can rotate, so we DO NOT cache — every
// call fetches fresh credentials. NOTE: this connector exposes the secret key
// as `settings.secret` (not `secret_key`); it does not provide a webhook
// secret, so webhook verification uses the STRIPE_WEBHOOK_SECRET env var.
async function resolveSecretKey(): Promise<string | null> {
  const envKey = process.env.STRIPE_SECRET_KEY;
  if (envKey) return envKey;

  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? `repl ${process.env.REPL_IDENTITY}`
    : process.env.WEB_REPL_RENEWAL
      ? `depl ${process.env.WEB_REPL_RENEWAL}`
      : null;
  if (!hostname || !xReplitToken) return null;

  try {
    const res = await fetch(
      `https://${hostname}/api/v2/connection?include_secrets=true&connector_names=stripe`,
      { headers: { Accept: "application/json", "X-Replit-Token": xReplitToken } },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      items?: Array<{ settings?: { secret?: string } }>;
    };
    return data.items?.[0]?.settings?.secret ?? null;
  } catch (err) {
    logger.warn(
      { err },
      "Failed to fetch Stripe credentials from Replit connector proxy",
    );
    return null;
  }
}

// Sync best-effort check for callers that need to branch UI/logic without doing
// async work. True if the env var is set OR the Replit connector proxy is
// reachable in this environment (actual reachability is verified at call time).
export function isStripeConfigured(): boolean {
  if (process.env.STRIPE_SECRET_KEY) return true;
  return (
    Boolean(process.env.REPLIT_CONNECTORS_HOSTNAME) &&
    Boolean(process.env.REPL_IDENTITY ?? process.env.WEB_REPL_RENEWAL)
  );
}

// Returns a fresh authenticated Stripe client, or null when Stripe is not
// configured in this environment. Not cached — credentials are fetched on every
// call so rotated keys are always picked up.
export async function getStripeClient(): Promise<Stripe | null> {
  const secretKey = await resolveSecretKey();
  if (!secretKey) return null;
  return new Stripe(secretKey);
}
