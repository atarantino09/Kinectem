/**
 * Shared, email-client-safe presentation primitives.
 *
 * The renderer deliberately owns only presentation. Callers continue to own
 * the approved copy and the plaintext MIME alternative. This keeps the
 * plaintext contract byte-for-byte stable while ensuring every HTML message,
 * including legacy text-only sends, has the same Kinectem frame.
 */

export interface BrandedEmailOptions {
  /** The existing HTML body fragment. It must already escape dynamic values. */
  bodyHtml: string;
  /** Used as the visible headline and escaped before interpolation. */
  subject: string;
  /** Absolute app/marketing origin used for the hosted transparent lockup. */
  baseUrl: string;
  /** Optional small label shown above the headline, such as a team name. */
  contextLabel?: string;
  /** Optional preheader text for inbox previews. */
  preheader?: string;
  /** Optional operator/compliance footer content owned by the caller. */
  footerHtml?: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

/**
 * Convert a plaintext-only message to a safe HTML fragment. Newlines are
 * preserved as paragraphs/line breaks, and the source is escaped first so
 * legacy text-only call sites cannot introduce markup.
 */
export function plainTextToHtml(text: string): string {
  const escaped = escapeHtml(text);
  const linked = escaped.replace(
    /(https?:\/\/[^\s<]+)/g,
    (url) =>
      `<a href="${url}" style="color:#1479ff;font-weight:700;">${url}</a>`,
  );
  return linked
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${paragraph.replace(/\n/g, "<br />")}</p>`)
    .join("\n");
}

/**
 * Wrap any HTML fragment in the Kinectem email presentation system.
 *
 * The logo intentionally uses the transparent public lockup rather than a
 * colored image panel. Its alt text and adjacent fallback wordmark remain
 * useful when an email client blocks remote images.
 */
export function renderBrandedEmailHtml(options: BrandedEmailOptions): string {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const logoUrl = `${baseUrl}/logo-horizontal.png`;
  const subject = escapeHtml(options.subject);
  const contextLabel = options.contextLabel?.trim();
  const preheader = escapeHtml(options.preheader?.trim() || options.subject);
  const footer = options.footerHtml ?? "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="x-apple-disable-message-reformatting" />
<title>${subject}</title>
<style>
  @media only screen and (max-width: 620px) {
    .email-shell { width: 100% !important; }
    .email-card { border-radius: 0 !important; }
    .email-content { padding: 28px 22px !important; }
    .email-header { padding: 22px !important; }
    .email-headline { font-size: 24px !important; }
  }
  .email-body-copy a { color: #1479ff; font-weight: 700; }
  .email-body-copy p > a {
    display: inline-block;
    padding: 12px 18px;
    border-radius: 9px;
    background: #1479ff;
    color: #ffffff !important;
    text-decoration: none;
  }
</style>
</head>
<body style="margin:0;padding:0;background:#f4f7fb;color:#172033;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;background:#f4f7fb;">
  <tr>
    <td align="center" style="padding:28px 14px;">
      <table role="presentation" class="email-shell" width="600" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;width:100%;max-width:600px;">
        <tr>
          <td class="email-card" style="background:#ffffff;border:1px solid #dfe6f0;border-radius:18px;overflow:hidden;box-shadow:0 6px 24px rgba(23,32,51,.08);">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
              <tr>
                <td class="email-header" style="padding:24px 30px;border-top:5px solid #1479ff;background:#ffffff;">
                  <img src="${escapeHtml(logoUrl)}" width="156" alt="Kinectem" style="display:block;width:156px;max-width:100%;height:auto;border:0;outline:none;text-decoration:none;" />
                  <div style="margin-top:5px;font-size:13px;font-weight:700;letter-spacing:.08em;color:#1479ff;">KINECTEM</div>
                </td>
              </tr>
            </table>
            <div class="email-content" style="padding:34px 42px 30px;">
              ${
                contextLabel
                  ? `<div style="margin:0 0 10px;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#1479ff;">${escapeHtml(contextLabel)}</div>`
                  : ""
              }
              <h1 class="email-headline" style="margin:0 0 24px;color:#172033;font-size:28px;line-height:1.18;font-weight:750;letter-spacing:-.02em;">${subject}</h1>
              <div class="email-body-copy" style="font-size:16px;line-height:1.65;color:#3c4a61;">
                ${options.bodyHtml}
              </div>
              <div class="email-footer">${footer}</div>
            </div>
            <div style="padding:18px 30px 22px;border-top:1px solid #e8edf4;color:#718096;font-size:12px;line-height:1.55;text-align:center;">
              <div style="font-weight:700;color:#53627a;">Kinectem</div>
              <div>Where the story of the season comes to life.</div>
            </div>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

export { escapeHtml };
