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

function unescapeHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export function emailLinkFallback(href: string): string {
  const safeHref = escapeHtml(href);
  return `<div class="email-link-fallback" style="margin:16px 0 0;color:#64748b;font-size:13px;line-height:1.5;word-break:break-all;">Button not working? Copy and paste this link:<br /><a href="${safeHref}" style="color:#2553ed;text-decoration:none;">${safeHref}</a></div>`;
}

export function emailButton(input: {
  href: string;
  label: string;
  includeFallback?: boolean;
}): string {
  const href = escapeHtml(input.href);
  const label = escapeHtml(input.label);
  return `<table role="presentation" class="email-cta" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:32px 0;">
  <tr>
    <td>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;">
        <tr>
          <td class="email-cta-cell" align="center" bgcolor="#2553ed" style="border-radius:8px;background:#2553ed;box-shadow:0 5px 14px rgba(37,83,237,.24);">
            <a href="${href}" style="display:inline-block;min-width:180px;padding:14px 28px;color:#ffffff;font-size:16px;line-height:22px;font-weight:700;text-align:center;text-decoration:none;border-radius:8px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">${label}</a>
          </td>
        </tr>
      </table>
      ${input.includeFallback === false ? "" : emailLinkFallback(input.href)}
    </td>
  </tr>
</table>`;
}

export function emailSummary(text: string): string {
  return `<div class="email-summary" style="margin:0 0 24px;padding:0 0 0 16px;border-left:4px solid #8b2cf5;font-size:18px;line-height:1.5;color:#111936;font-weight:700;">${escapeHtml(text)}</div>`;
}

export function emailDivider(): string {
  return `<table role="presentation" class="email-divider" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin: 32px 0;">
  <tr>
    <td style="border-top:2px solid #e6e9f4;font-size:0;line-height:0;">&nbsp;</td>
  </tr>
</table>`;
}

export function emailKeyValue(
  facts: { label: string; value: string }[],
): string {
  const rows = facts
    .map(
      (fact) => `<tr class="email-kv-row">
  <td class="email-kv-label" width="35%" valign="top" style="padding:12px 16px;color:#4e5680;font-size:12px;line-height:1.4;font-weight:800;letter-spacing:.05em;text-transform:uppercase;border-bottom:1px solid #e6e9f4;">${escapeHtml(fact.label)}</td>
  <td class="email-kv-value" width="65%" valign="top" style="padding:12px 16px;color:#111936;font-size:15px;line-height:1.4;font-weight:600;border-bottom:1px solid #e6e9f4;">${escapeHtml(fact.value)}</td>
</tr>`,
    )
    .join("");

  return `<table role="presentation" class="email-facts" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;border:1px solid #e6e9f4;border-radius:12px;border-collapse:separate;border-spacing:0;background:#f7f8fc;">${rows}</table>`;
}

export function emailCallout(bodyHtml: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;margin:24px 0;">
  <tr><td class="email-callout-box" style="padding:20px;border:1px solid #ddd5ff;border-left:5px solid #8b2cf5;border-radius:10px;background:#f7f4ff;color:#30385f;font-size:15px;line-height:1.6;">${bodyHtml}</td></tr>
</table>`;
}

export function emailStatusCallout(
  status: "success" | "warning" | "error" | "info",
  bodyHtml: string,
): string {
  let bg = "#f8fafc";
  let border = "#e2e8f0";
  let color = "#334155";
  let statusClass = "email-status-info";

  if (status === "success") {
    bg = "#f0fdf4";
    border = "#bbf7d0";
    color = "#166534";
    statusClass = "email-status-success";
  } else if (status === "warning") {
    bg = "#fffbeb";
    border = "#fef08a";
    color = "#854d0e";
    statusClass = "email-status-warning";
  } else if (status === "error") {
    bg = "#fef2f2";
    border = "#fecaca";
    color = "#991b1b";
    statusClass = "email-status-error";
  } else if (status === "info") {
    bg = "#eef3ff";
    border = "#b9c9ff";
    color = "#1739a6";
  }

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;margin:24px 0;">
  <tr><td class="${statusClass}" style="padding:16px 20px;border:1px solid ${border};border-radius:12px;background:${bg};color:${color};font-size:15px;line-height:1.5;font-weight:500;">${bodyHtml}</td></tr>
</table>`;
}

export function emailChecklist(
  items: readonly string[],
  title?: string,
): string {
  const rows = items
    .map(
      (item, index) =>
        `<tr>
          <td width="32" valign="top" style="padding:${index === 0 ? "0" : "12px"} 12px 0 0;">
             <div class="email-checklist-num" style="width:24px;height:24px;border-radius:12px;background:#2553ed;color:#ffffff;font-size:12px;line-height:24px;font-weight:800;text-align:center;">${index + 1}</div>
          </td>
          <td class="email-checklist-text" valign="top" style="padding:${index === 0 ? "2px" : "14px"} 0 0;color:#334155;font-size:15px;line-height:1.5;">${escapeHtml(item)}</td>
        </tr>`,
    )
    .join("");

  const titleHtml = title
    ? `<div class="email-checklist-title" style="margin:0 0 16px;color:#111936;font-size:15px;font-weight:800;">${escapeHtml(title)}</div>`
    : "";

  return emailCallout(
    `${titleHtml}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">${rows}</table>`,
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
      const facts = lines.map((line) => {
        const match = line.match(/^([^:]{1,48}):\s+(.+)$/);
        return match
          ? { label: match[1].trim(), value: match[2].trim() }
          : null;
      });
      if (lines.length >= 3 && facts.every(Boolean)) {
        const typedFacts = facts.filter(
          (fact): fact is { label: string; value: string } => fact !== null,
        );
        const action = typedFacts.find(
          (fact) =>
            /^https?:\/\/\S+$/.test(fact.value) &&
            /^(review|open|view|manage|see|continue)$/i.test(fact.label),
        );
        const displayFacts = typedFacts.filter((fact) => fact !== action);
        return [
          displayFacts.length > 0 ? emailKeyValue(displayFacts) : "",
          action
            ? emailButton({
                href: action.value,
                label:
                  action.label.toLowerCase() === "review"
                    ? "Review request"
                    : `${action.label} in Kinectem`,
              })
            : "",
        ].join("");
      }
      return lines
        .map((line) => {
          if (/^https?:\/\/\S+$/.test(line)) {
            return emailButton({ href: line, label: "Open in Kinectem" });
          }
          const linked = escapeHtml(line).replace(
            /(https?:\/\/[^\s<]+)/g,
            (url) =>
              `<a href="${url}" style="color:#2553ed;font-weight:600;text-decoration:none;">${url}</a>`,
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
      return emailButton({
        href: unescapeHtml(href),
        label: "Open in Kinectem",
      });
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
  const logoDarkUrl = `${baseUrl}${baseUrl.endsWith("/app") ? "" : "/app"}/logo-horizontal-mono-white-transparent.png`;
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
    .email-card { border-radius: 0 !important; border: none !important; }
    .email-content { padding: 32px 24px 36px !important; }
    .email-header, .email-hero, .email-footer-bar { padding-left:24px !important;padding-right:24px !important; }
    .email-headline { font-size: 26px !important; }
    .email-cta > tbody > tr > td > table { width: 100% !important; }
    .email-cta-cell, .email-cta-cell a { width: 100% !important; box-sizing: border-box !important; }
    .email-body-copy p > a { display:block !important;text-align:center !important;box-sizing:border-box !important; }
    .email-kv-row td { display: block !important; width: 100% !important; border: none !important; }
    .email-kv-row td:first-child { padding: 16px 0 4px !important; }
    .email-kv-row td:last-child { padding: 0 0 16px !important; border-bottom: 1px solid #f1f5f9 !important; }
    .email-kv-row:last-child td:last-child { border-bottom: none !important; }
  }

  .email-body-copy p { margin:0 0 16px; }
  .email-body-copy ul, .email-body-copy ol { margin:0 0 20px;padding-left:22px; }
  .email-body-copy li { margin:0 0 8px; }
  .email-body-copy blockquote { margin:20px 0;padding:16px 20px;border-left:4px solid #8b2cf5;background:#f7f4ff;color:#4e5680;border-radius:0 8px 8px 0; }
  .email-body-copy a { color:#2553ed;font-weight:600;text-decoration:none; }

  @media (prefers-color-scheme: dark) {
    body, .email-canvas { background:#0f172a !important;color:#f8fafc !important; }
    .email-card, .email-content { background:#111936 !important;border-color:#30385f !important; }
    .email-header, .email-hero, .email-footer-bar { background:#080e29 !important;border-color:#30385f !important; }
    .email-content { color:#f8fafc !important; }
    .email-headline { color:#ffffff !important; }
    .email-body-copy { color:#cbd5e1 !important; }
    .email-body-copy blockquote { background: #172554 !important; color: #bfdbfe !important; border-left-color: #3b82f6 !important; }

    .email-footer-bar { color:#aeb6d8 !important; }
    .email-footer-bar div:first-child { color:#e2e8f0 !important; }
    .email-footer { color: #94a3b8 !important; border-top-color: #334155 !important; }

    .email-summary { color:#f8fafc !important;border-left-color:#b54cff !important; }
    .email-divider td { border-top-color: #334155 !important; }

    .email-kv-label { color: #94a3b8 !important; }
    .email-kv-value { color: #f1f5f9 !important; }
    .email-kv-row td { border-bottom-color:#30385f !important; }
    .email-facts { background:#171f43 !important;border-color:#30385f !important; }

    .email-callout-box { background: #0f172a !important; border-color: #334155 !important; color: #cbd5e1 !important; }

    .email-status-success { background: #022c22 !important; border-color: #064e3b !important; color: #6ee7b7 !important; }
    .email-status-warning { background: #422006 !important; border-color: #713f12 !important; color: #fde047 !important; }
    .email-status-error { background: #450a0a !important; border-color: #7f1d1d !important; color: #fca5a5 !important; }
    .email-status-info { background: #172554 !important; border-color: #1e3a8a !important; color: #93c5fd !important; }

    .email-checklist-title { color: #f8fafc !important; }
    .email-checklist-num { background: #334155 !important; color: #f8fafc !important; }
    .email-checklist-text { color: #e2e8f0 !important; }

    .email-link-fallback { color: #94a3b8 !important; }
  }
</style>
</head>
<body class="email-canvas" style="margin:0;padding:0;background:#f2f4fa;color:#111936;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${preheader}</div>
<table role="presentation" class="email-canvas" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;background:#f2f4fa;">
  <tr>
    <td align="center" style="padding:40px 16px;">
      <table role="presentation" class="email-shell" width="600" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;width:100%;max-width:600px;">
        <tr>
          <td class="email-card" style="background:#ffffff;border:1px solid #dfe3ef;border-radius:20px;overflow:hidden;box-shadow:0 10px 36px rgba(8,14,41,.08);">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
              <tr>
                  <td class="email-header" bgcolor="#080e29" style="padding:28px 48px;background:#080e29;border-bottom:4px solid #8b2cf5;">
                    <img src="${escapeHtml(logoDarkUrl)}" width="156" height="40" alt="Kinectem" style="display:block;width:156px;max-width:100%;height:auto;border:0;outline:none;text-decoration:none;font-family:-apple-system,sans-serif;font-size:22px;font-weight:bold;color:#ffffff;" />
                </td>
              </tr>
            </table>
            <div class="email-hero" style="padding:34px 48px 36px;background:#080e29;background-image:linear-gradient(120deg,#080e29 0%,#182b8d 58%,#6d28d9 100%);">
              ${
                contextLabel
                   ? `<div style="margin:0 0 12px;font-size:12px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:#c9b8ff;">${escapeHtml(contextLabel)}</div>`
                  : ""
              }
                <h1 class="email-headline" style="margin:0;color:#ffffff;font-size:32px;line-height:1.2;font-weight:800;letter-spacing:-.02em;">${subject}</h1>
            </div>
            <div class="email-content" style="padding:36px 48px 44px;background:#ffffff;">
              <div class="email-body-copy" style="font-size:16px;line-height:1.65;color:#334155;">
                 ${bodyHtml}
              </div>
              ${footer ? `<div class="email-footer" style="margin:40px 0 0;padding:24px 0 0;border-top:1px solid #e2e8f0;font-size:13px;color:#64748b;line-height:1.6;">${footer}</div>` : ""}
            </div>
              <div class="email-footer-bar" style="padding:26px 48px 30px;background:#080e29;border-top:4px solid #ff2d9a;color:#aeb6d8;font-size:13px;line-height:1.6;text-align:center;">
               <div style="font-weight:800;color:#ffffff;font-size:14px;margin-bottom:4px;">Kinectem</div>
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
