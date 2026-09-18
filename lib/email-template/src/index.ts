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
  /** Absolute app/marketing origin used for the hosted banner lockup. */
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
  return `<div class="email-link-fallback" style="margin:16px 0 0;color:#64748b;font-size:13px;line-height:1.5;word-break:break-all;text-align:center;">Button not working? <a href="${safeHref}" style="color:#8b2cf5;text-decoration:underline;">Click here</a></div>`;
}

export function emailButton(input: {
  href: string;
  label: string;
  includeFallback?: boolean;
}): string {
  const href = escapeHtml(input.href);
  const label = escapeHtml(input.label);
  return `<table role="presentation" class="email-cta" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:28px 0 12px;">
  <tr>
    <td align="center">
      <table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;margin:0 auto;">
        <tr>
          <td class="email-cta-cell" align="center" bgcolor="#8b2cf5" style="border-radius:12px;background:#8b2cf5;background-image:linear-gradient(135deg,#7c3aed 0%,#a21caf 55%,#ec4899 100%);box-shadow:0 10px 24px rgba(139,44,245,.28);">
            <a href="${href}" style="display:inline-block;min-width:190px;padding:16px 30px;color:#ffffff;font-size:16px;line-height:1.2;font-weight:800;text-align:center;text-decoration:none;border-radius:12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;letter-spacing:.01em;">${label}</a>
          </td>
        </tr>
      </table>
      ${input.includeFallback === false ? "" : emailLinkFallback(input.href)}
    </td>
  </tr>
</table>`;
}

export function emailSummary(text: string): string {
  return `<div class="email-summary" style="margin:0 0 24px;font-size:18px;line-height:1.5;color:#0f172a;font-weight:600;">${escapeHtml(text)}</div>`;
}

/**
 * A compact, table-backed card for grouping related email content. The title
 * is plain text so callers cannot accidentally introduce markup; bodyHtml is
 * intentionally trusted because it is assembled from the other primitives.
 */
export interface EmailSectionOptions {
  title: string;
  bodyHtml: string;
  /** Optional short category label above the section title. */
  eyebrow?: string;
}

export function emailSection(options: EmailSectionOptions): string;
export function emailSection(title: string, bodyHtml: string): string;
export function emailSection(
  optionsOrTitle: EmailSectionOptions | string,
  positionalBodyHtml?: string,
): string {
  const options =
    typeof optionsOrTitle === "string"
      ? { title: optionsOrTitle, bodyHtml: positionalBodyHtml ?? "" }
      : optionsOrTitle;
  const eyebrow = options.eyebrow?.trim();
  return `<table role="presentation" class="email-section" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;margin:28px 0;border:1px solid #cbd5e1;border-radius:14px;background:#ffffff;box-shadow:0 4px 14px rgba(15,23,42,.06);">
  <tr><td class="email-section-heading" style="padding:16px 22px;border-bottom:2px solid #8b2cf5;border-radius:13px 13px 0 0;background:#f1f5f9;">
    ${eyebrow ? `<div class="email-section-eyebrow" style="margin:0 0 5px;color:#7c3aed;font-size:11px;line-height:1.4;font-weight:800;letter-spacing:.08em;text-transform:uppercase;">${escapeHtml(eyebrow)}</div>` : ""}
    <div class="email-section-title" style="margin:0;color:#0f172a;font-size:18px;line-height:1.3;font-weight:800;">${escapeHtml(options.title)}</div>
  </td></tr>
  <tr><td class="email-section-box" style="padding:22px;background:#ffffff;border-radius:0 0 13px 13px;">
    <div class="email-section-body" style="color:#334155;font-size:15px;line-height:1.6;">${options.bodyHtml}</div>
  </td></tr>
</table>`;
}

export function emailDivider(): string {
  return `<table role="presentation" class="email-divider" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin: 32px 0;">
  <tr>
    <td style="border-top:1px solid #e2e8f0;font-size:0;line-height:0;">&nbsp;</td>
  </tr>
</table>`;
}

export function emailKeyValue(
  facts: { label: string; value: string }[],
): string {
  const rows = facts
    .map(
      (fact, index) => `<tr class="email-kv-row">
  <td class="email-kv-label" width="40%" valign="top" style="padding:16px;color:#64748b;font-size:13px;line-height:1.4;font-weight:700;border-bottom:${index === facts.length - 1 ? "none" : "1px solid #e2e8f0"};">${escapeHtml(fact.label)}</td>
  <td class="email-kv-value" width="60%" valign="top" style="padding:16px;color:#0f172a;font-size:15px;line-height:1.4;font-weight:600;border-bottom:${index === facts.length - 1 ? "none" : "1px solid #e2e8f0"};">${escapeHtml(fact.value)}</td>
</tr>`,
    )
    .join("");

  return `<table role="presentation" class="email-facts" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;border:1px solid #e2e8f0;border-radius:12px;border-collapse:separate;border-spacing:0;background:#f8fafc;">${rows}</table>`;
}

export function emailCallout(bodyHtml: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;margin:24px 0;">
  <tr><td class="email-callout-box" style="padding:24px;border:1px solid #e2e8f0;border-left:4px solid #8b2cf5;border-radius:12px;background:#fafaf9;color:#334155;font-size:15px;line-height:1.6;">${bodyHtml}</td></tr>
</table>`;
}

export function emailStatusCallout(
  status: "success" | "warning" | "error" | "info",
  bodyHtml: string,
): string {
  let bg = "#f8fafc";
  let border = "#e2e8f0";
  let borderLeft = "#64748b";
  let color = "#334155";
  let statusClass = "email-status-info";

  if (status === "success") {
    bg = "#f0fdf4";
    border = "#dcfce7";
    borderLeft = "#22c55e";
    color = "#166534";
    statusClass = "email-status-success";
  } else if (status === "warning") {
    bg = "#fffbeb";
    border = "#fef3c7";
    borderLeft = "#f59e0b";
    color = "#92400e";
    statusClass = "email-status-warning";
  } else if (status === "error") {
    bg = "#fef2f2";
    border = "#fee2e2";
    borderLeft = "#ef4444";
    color = "#991b1b";
    statusClass = "email-status-error";
  } else if (status === "info") {
    bg = "#eff6ff";
    border = "#dbeafe";
    borderLeft = "#3b82f6";
    color = "#1e40af";
    statusClass = "email-status-info";
  }

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;margin:24px 0;">
  <tr><td class="${statusClass}" style="padding:20px 24px;border:1px solid ${border};border-left:4px solid ${borderLeft};border-radius:12px;background:${bg};color:${color};font-size:15px;line-height:1.6;font-weight:500;">${bodyHtml}</td></tr>
</table>`;
}

export function emailChecklist(
  items: readonly string[],
  title?: string,
  options?: { embedded?: boolean },
): string {
  const rows = items
    .map(
      (item, index) =>
        `<tr class="email-checklist-row">
          <td width="42" valign="top" style="padding:${index === 0 ? "0" : "14px"} 14px ${index === items.length - 1 ? "0" : "14px"} 0;border-bottom:${index === items.length - 1 ? "none" : "1px solid #e2e8f0"};">
             <div class="email-checklist-num" style="width:28px;height:28px;border-radius:14px;background:#f1f5f9;color:#475569;font-size:13px;line-height:28px;font-weight:700;text-align:center;">${index + 1}</div>
          </td>
          <td class="email-checklist-text" valign="top" style="padding:${index === 0 ? "2px" : "16px"} 0 ${index === items.length - 1 ? "0" : "14px"};border-bottom:${index === items.length - 1 ? "none" : "1px solid #e2e8f0"};color:#334155;font-size:15px;line-height:1.55;">${escapeHtml(item)}</td>
        </tr>`,
    )
    .join("");

  const titleHtml = title
    ? `<div class="email-checklist-title" style="margin:0 0 20px;color:#0f172a;font-size:16px;font-weight:700;">${escapeHtml(title)}</div>`
    : "";

  const embedded = options?.embedded === true;
  return `<table role="presentation" class="email-checklist${embedded ? " email-checklist-embedded" : ""}" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;margin:${embedded ? "20px 0 0" : "24px 0"};">
  <tr><td class="email-checklist-box" style="padding:${embedded ? "0" : "22px"};border:${embedded ? "none" : "1px solid #e2e8f0"};border-radius:${embedded ? "0" : "12px"};background:${embedded ? "transparent" : "#ffffff"};">
    ${titleHtml}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">${rows}</table>
  </td></tr>
</table>`;
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
              `<a href="${url}" style="color:#8b2cf5;font-weight:600;text-decoration:none;">${url}</a>`,
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
 * The wordmark is rendered as email-safe HTML instead of a remote image so
 * clients that block images still show a centered, balanced brand header.
 */
export function renderBrandedEmailHtml(options: BrandedEmailOptions): string {
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
    .email-hero, .email-content, .email-footer-bar { padding-left:24px !important;padding-right:24px !important; }
    .email-headline { font-size: 26px !important; }
    .email-cta > tbody > tr > td > table { width: 100% !important; }
    .email-cta-cell, .email-cta-cell a { width: 100% !important; box-sizing: border-box !important; }
    .email-kv-row td { display: block !important; width: 100% !important; border: none !important; }
    .email-kv-row td:first-child { padding: 16px 16px 4px !important; }
    .email-kv-row td:last-child { padding: 0 16px 16px !important; border-bottom: 1px solid #e2e8f0 !important; }
    .email-kv-row:last-child td:last-child { border-bottom: none !important; }
     .email-section { margin:22px 0 !important; }
     .email-section-heading { padding:14px 18px !important; }
     .email-section-box { padding:18px !important; }
     .email-section-title { font-size:17px !important; }
     .email-checklist-row td:first-child { width:38px !important;padding-right:10px !important; }
     .email-checklist-text { font-size:15px !important;line-height:1.5 !important; }
  }

  .email-body-copy p { margin:0 0 16px; }
  .email-body-copy ul, .email-body-copy ol { margin:0 0 20px;padding-left:24px; }
  .email-body-copy li { margin:0 0 8px; }
  .email-body-copy blockquote { margin:24px 0;padding:16px 20px;border-left:4px solid #8b2cf5;background:#fafaf9;color:#334155;border-radius:0 12px 12px 0; }
  .email-body-copy a { color:#8b2cf5;font-weight:600;text-decoration:none; }

  @media (prefers-color-scheme: dark) {
    body, .email-canvas { background:#0b1021 !important;color:#f8fafc !important; }
    .email-card { background:#111936 !important;border-color:#1e293b !important; }
    .email-hero, .email-content { background:#111936 !important; color:#f8fafc !important; }
    .email-hero { background-image:linear-gradient(180deg,#1a1f4d 0%,#111936 100%) !important; }
    .email-content { background-image:linear-gradient(180deg,#111936 0%,#10162f 100%) !important; }
    .email-headline { color:#ffffff !important; }
    .email-body-copy { color:#cbd5e1 !important; }
    .email-body-copy blockquote { background: #1e293b !important; color: #cbd5e1 !important; border-left-color: #a855f7 !important; }
    .email-body-copy a { color:#a855f7 !important; }
    .email-cta-cell a { color:#ffffff !important; }

    .email-footer-bar { background:#0f172a !important; border-top-color:#1e293b !important; color:#94a3b8 !important; }
    .email-footer-bar div:first-child { color:#e2e8f0 !important; }
    .email-footer { color: #64748b !important; border-top-color: #1e293b !important; }

    .email-summary { color:#f8fafc !important; }
    .email-divider td { border-top-color: #1e293b !important; }

    .email-facts { background:#1e293b !important; border-color:#334155 !important; }
    .email-kv-row td { border-bottom-color:#334155 !important; }
    .email-kv-label { color:#94a3b8 !important; }
    .email-kv-value { color:#f8fafc !important; }

    @media only screen and (max-width: 620px) {
      .email-kv-row td:last-child { border-bottom-color: #334155 !important; }
    }

    .email-callout-box { background: #1e293b !important; border-color: #334155 !important; color: #cbd5e1 !important; }

    .email-status-success { background:#052e16 !important; border-color:#064e3b !important; color:#6ee7b7 !important; border-left-color:#10b981 !important; }
    .email-status-warning { background:#451a03 !important; border-color:#713f12 !important; color:#fde047 !important; border-left-color:#f59e0b !important; }
    .email-status-error { background:#450a0a !important; border-color:#7f1d1d !important; color:#fca5a5 !important; border-left-color:#ef4444 !important; }
    .email-status-info { background:#172554 !important; border-color:#1e3a8a !important; color:#93c5fd !important; border-left-color:#3b82f6 !important; }

    .email-checklist-box { background:#1e293b !important; border-color:#334155 !important; }
    .email-checklist-title { color: #f8fafc !important; }
    .email-checklist-num { background: #334155 !important; color: #e2e8f0 !important; }
    .email-checklist-text { color: #cbd5e1 !important; }
    .email-checklist-row td { border-bottom-color:#334155 !important; }
    .email-checklist-embedded .email-checklist-box { background:transparent !important;border:none !important; }
     .email-section { background:#172033 !important; border-color:#475569 !important; box-shadow:none !important; }
     .email-section-heading { background:#253149 !important; border-bottom-color:#c084fc !important; }
     .email-section-box { background:#172033 !important; }
     .email-section-eyebrow { color:#c084fc !important; }
     .email-section-title { color:#f8fafc !important; }
     .email-section-body { color:#cbd5e1 !important; }
     .email-muted { color:#94a3b8 !important; }

    .email-link-fallback { color: #94a3b8 !important; }
    .email-link-fallback a { color: #a855f7 !important; }
  }
</style>
</head>
<body class="email-canvas" style="margin:0;padding:0;background:#f1f5f9;color:#0f172a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${preheader}</div>
<table role="presentation" class="email-canvas" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;background:#f1f5f9;">
  <tr>
    <td align="center" style="padding:40px 16px;">
      <table role="presentation" class="email-shell" width="600" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;width:100%;max-width:600px;">
        <tr>
          <td class="email-card" style="background:#ffffff;border:1px solid #e2e8f0;border-radius:24px;overflow:hidden;box-shadow:0 10px 40px -10px rgba(0,0,0,0.08);">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
              <tr>
                <td class="email-header" align="center" valign="middle" height="92" bgcolor="#0b0f19" style="height:92px;padding:0 24px;background:#0b0f19;text-align:center;">
                  <div class="email-wordmark" style="margin:0;color:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:31px;line-height:1;font-weight:800;letter-spacing:-.04em;text-align:center;"><span style="color:#a855f7;font-size:38px;font-style:italic;">K</span>inectem</div>
                </td>
              </tr>
              <tr>
                <td height="6" style="height:6px;font-size:0;line-height:0;background:#8b2cf5;background-image:linear-gradient(90deg,#6d28d9 0%,#8b2cf5 38%,#ec4899 72%,#f97316 100%);">&nbsp;</td>
              </tr>
            </table>
            <div class="email-hero" style="padding:40px 48px 20px;background:#ffffff;background-image:linear-gradient(180deg,#faf5ff 0%,#ffffff 85%);">
              ${
                contextLabel
                  ? `<div style="margin:0 0 12px;font-size:13px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:#8b2cf5;">${escapeHtml(contextLabel)}</div>`
                  : ""
              }
              <h1 class="email-headline" style="margin:0;color:#0f172a;font-size:30px;line-height:1.25;font-weight:800;letter-spacing:-.02em;">${subject}</h1>
            </div>
            <div class="email-content" style="padding:16px 48px 48px;background:#ffffff;">
              <div class="email-body-copy" style="font-size:16px;line-height:1.6;color:#334155;">
                 ${bodyHtml}
              </div>
              ${footer ? `<div class="email-footer" style="margin:48px 0 0;padding:24px 0 0;border-top:1px solid #e2e8f0;font-size:13px;color:#64748b;line-height:1.6;">${footer}</div>` : ""}
            </div>
            <div class="email-footer-bar" style="padding:32px 48px;background:#f8fafc;border-top:1px solid #e2e8f0;color:#64748b;font-size:13px;line-height:1.6;text-align:center;">
              <div style="font-weight:700;color:#475569;font-size:14px;margin-bottom:4px;">Kinectem</div>
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
