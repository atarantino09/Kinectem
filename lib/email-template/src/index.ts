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

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function emailLinkFallback(href: string): string {
  const safeHref = escapeHtml(href);
  return `<div class="email-link-fallback" style="margin:12px 0 0;color:#718096;font-size:12px;line-height:1.55;word-break:break-all;">Button not working? Copy and paste this link:<br /><a href="${safeHref}" style="color:#53627a;text-decoration:underline;">${safeHref}</a></div>`;
}

export function emailButton(input: {
  href: string;
  label: string;
  includeFallback?: boolean;
}): string {
  const href = escapeHtml(input.href);
  const label = escapeHtml(input.label);
  return `<table role="presentation" class="email-cta" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:24px 0;">
  <tr>
    <td>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;">
        <tr>
          <td class="email-cta-cell" align="center" bgcolor="#1479ff" style="border-radius:10px;background:#1479ff;">
            <a href="${href}" style="display:inline-block;min-width:180px;padding:14px 22px;color:#ffffff;font-size:15px;line-height:20px;font-weight:700;text-align:center;text-decoration:none;border-radius:10px;">${label}</a>
          </td>
        </tr>
      </table>
      ${input.includeFallback === false ? "" : emailLinkFallback(input.href)}
    </td>
  </tr>
</table>`;
}

export function emailCallout(bodyHtml: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;margin:22px 0;">
  <tr><td style="padding:18px 20px;border:1px solid #d8e7fb;border-radius:12px;background:#f4f8ff;color:#33445f;">${bodyHtml}</td></tr>
</table>`;
}

export function emailChecklist(items: readonly string[]): string {
  const rows = items
    .map(
      (item, index) =>
        `<tr>
          <td width="36" valign="top" style="padding:${index === 0 ? "0" : "14px"} 12px 0 0;">
            <div style="width:28px;height:28px;border-radius:14px;background:#e6f1ff;color:#1479ff;font-size:13px;line-height:28px;font-weight:700;text-align:center;">${index + 1}</div>
          </td>
          <td valign="top" style="padding:${index === 0 ? "3px" : "17px"} 0 0;color:#33445f;font-size:15px;line-height:1.5;">${escapeHtml(item)}</td>
        </tr>`,
    )
    .join("");
  return emailCallout(
    `<div style="margin:0 0 14px;color:#172033;font-size:15px;font-weight:700;">Recommended launch order</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">${rows}</table>`,
  );
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
  return text
    .split(/\n{2,}/)
    .map((paragraph) => {
      const lines = paragraph.split("\n");
      return lines
        .map((line) => {
          if (/^https?:\/\/\S+$/.test(line)) {
            return emailButton({ href: line, label: "Open in Kinectem" });
          }
          const linked = escapeHtml(line).replace(
            /(https?:\/\/[^\s<]+)/g,
            (url) =>
              `<a href="${url}" style="color:#1479ff;font-weight:700;text-decoration:underline;">${url}</a>`,
          );
          return `<p>${linked}</p>`;
        })
        .join("");
    })
    .join("\n");
}

function upgradeLegacyCtas(bodyHtml: string): string {
  return bodyHtml.replace(
    /<p>\s*<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/p>/gi,
    (_match, href: string, label: string) => {
      const rawUrlLabel = /^https?:\/\//i.test(label.replace(/<[^>]+>/g, ""));
      if (!rawUrlLabel) return _match;
      const buttonLabel = "Open in Kinectem";
      return `<table role="presentation" class="email-cta" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:24px 0;">
  <tr><td>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;">
      <tr><td class="email-cta-cell" align="center" bgcolor="#1479ff" style="border-radius:10px;background:#1479ff;">
        <a href="${href}" style="display:inline-block;min-width:180px;padding:14px 22px;color:#ffffff;font-size:15px;line-height:20px;font-weight:700;text-align:center;text-decoration:none;border-radius:10px;">${buttonLabel}</a>
      </td></tr>
    </table>
    <div class="email-link-fallback" style="margin:12px 0 0;color:#718096;font-size:12px;line-height:1.55;word-break:break-all;">Button not working? Copy and paste this link:<br /><a href="${href}" style="color:#53627a;text-decoration:underline;">${label}</a></div>
  </td></tr>
</table>`;
    },
  );
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
  const bodyHtml = upgradeLegacyCtas(options.bodyHtml);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="x-apple-disable-message-reformatting" />
<meta name="color-scheme" content="light dark" />
<meta name="supported-color-schemes" content="light dark" />
<title>${subject}</title>
<style>
  @media only screen and (max-width: 620px) {
    .email-shell { width: 100% !important; }
    .email-card { border-radius: 0 !important; }
    .email-content { padding: 28px 22px 26px !important; }
    .email-header { padding: 20px 22px !important; }
    .email-headline { font-size: 24px !important; }
    .email-cta > tbody > tr > td > table { width: 100% !important; }
    .email-cta-cell, .email-cta-cell a { width: 100% !important; box-sizing: border-box !important; }
    .email-body-copy p > a { display:block !important;text-align:center !important;box-sizing:border-box !important; }
  }
  .email-body-copy p { margin:0 0 16px; }
  .email-body-copy ul, .email-body-copy ol { margin:0 0 20px;padding-left:22px; }
  .email-body-copy li { margin:0 0 8px; }
  .email-body-copy blockquote { margin:18px 0;padding:14px 16px;border-left:4px solid #1479ff;background:#f4f8ff;color:#53627a; }
  .email-body-copy a { color:#1479ff;font-weight:700; }
  .email-body-copy p > a {
    display:inline-block;
    min-width:180px;
    padding:14px 22px;
    border-radius:10px;
    background:#1479ff;
    color:#ffffff !important;
    line-height:20px;
    text-align:center;
    text-decoration:none;
  }
  @media (prefers-color-scheme: dark) {
    body, .email-canvas { background:#101722 !important;color:#f5f7fb !important; }
    .email-card, .email-header { background:#192332 !important;border-color:#314055 !important; }
    .email-content, .email-headline { color:#f5f7fb !important; }
    .email-body-copy { color:#cbd5e1 !important; }
    .email-footer-bar { background:#192332 !important;border-color:#314055 !important;color:#9fb0c6 !important; }
    .email-footer-bar div:first-child { color:#d9e2ef !important; }
  }
</style>
</head>
<body class="email-canvas" style="margin:0;padding:0;background:#f4f7fb;color:#172033;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${preheader}</div>
<table role="presentation" class="email-canvas" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;background:#f4f7fb;">
  <tr>
    <td align="center" style="padding:28px 14px;">
      <table role="presentation" class="email-shell" width="600" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;width:100%;max-width:600px;">
        <tr>
          <td class="email-card" style="background:#ffffff;border:1px solid #dfe6f0;border-radius:18px;overflow:hidden;box-shadow:0 6px 24px rgba(23,32,51,.08);">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
              <tr>
                 <td class="email-header" style="padding:24px 30px;border-top:5px solid #1479ff;background:#ffffff;">
                   <img src="${escapeHtml(logoUrl)}" width="156" height="40" alt="Kinectem" style="display:block;width:156px;max-width:100%;height:auto;border:0;outline:none;text-decoration:none;" />
                </td>
              </tr>
            </table>
            <div class="email-content" style="padding:34px 42px 30px;">
              ${
                contextLabel
                  ? `<div style="margin:0 0 10px;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#1479ff;">${escapeHtml(contextLabel)}</div>`
                  : ""
              }
               <h1 class="email-headline" style="margin:0 0 22px;color:#172033;font-size:28px;line-height:1.2;font-weight:700;letter-spacing:-.02em;">${subject}</h1>
              <div class="email-body-copy" style="font-size:16px;line-height:1.65;color:#3c4a61;">
                 ${bodyHtml}
              </div>
              <div class="email-footer">${footer}</div>
            </div>
             <div class="email-footer-bar" style="padding:18px 30px 22px;border-top:1px solid #e8edf4;background:#fbfcfe;color:#718096;font-size:12px;line-height:1.55;text-align:center;">
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
