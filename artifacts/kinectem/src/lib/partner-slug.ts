export const PARTNER_SLUG_MAX_LENGTH = 80;

const PARTNER_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const WEB_URL = /^(?:https?:\/\/|www\.)/i;
const URL_PROTOCOL = /^[a-z][a-z0-9+.-]*:\/\//i;

/**
 * Converts a partner-page name, slug, or pasted web address into the
 * canonical segment used after /partners/.
 *
 * Web URLs use their hostname and path, deliberately ignoring query strings
 * and fragments. This keeps a pasted address useful without treating it as a
 * link to an external site.
 */
export function canonicalizePartnerSlug(value: string): string {
  const input = value.trim();
  if (!input) return "";
  if (URL_PROTOCOL.test(input) && !/^https?:\/\//i.test(input)) return "";

  let source = input;
  if (WEB_URL.test(input)) {
    try {
      const url = new URL(
        input.startsWith("www.") ? `https://${input}` : input,
      );
      if (!url.hostname) return "";
      source = `${url.hostname}${url.pathname}`;
    } catch {
      return "";
    }
  }

  return source
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("en-US")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function partnerSlugError(value: string): string | null {
  const slug = canonicalizePartnerSlug(value);
  if (!value.trim()) return "Enter a partner URL segment.";
  if (!slug) return "Use letters, numbers, or paste an http(s) web address.";
  if (slug.length > PARTNER_SLUG_MAX_LENGTH) {
    return `Keep the URL segment to ${PARTNER_SLUG_MAX_LENGTH} characters or fewer.`;
  }
  if (!PARTNER_SLUG.test(slug))
    return "Use lowercase letters, numbers, and hyphens.";
  return null;
}

export function isValidPartnerSlug(value: string): boolean {
  return partnerSlugError(value) === null;
}
