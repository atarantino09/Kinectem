import { db, articles, orgPosts, assets } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { asyncHandler } from "../lib/async-handler";
import { apiError, parsePostId } from "../lib/spec-helpers";
import { isHistoricalClippingUrl } from "../lib/historical-clipping-urls";

/**
 * Private clipping assets are not ordinary reusable media. Only the historical
 * workflow may attach their URLs, after its own destination/ownership checks.
 * Mount before all domain routers, including organization Updates and albums.
 */
export const guardHistoricalClippingAttachments = asyncHandler(async (req, res, next): Promise<void> => {
  if (!req.sessionUser || !["POST", "PATCH", "PUT"].includes(req.method)) { next(); return; }
  let hasUrl = false;
  const assetIds = new Set<string>();
  const pending: unknown[] = [req.body];
  while (pending.length) {
    const item = pending.pop();
    if (!item || typeof item !== "object") continue;
    for (const [key, value] of Object.entries(item)) {
      const values = Array.isArray(value) ? value : [value];
      if (/urls?$/i.test(key)) hasUrl ||= values.some(isHistoricalClippingUrl);
      if (/assetIds?$/i.test(key)) {
        for (const id of values) {
          if (typeof id === "string" && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id)) assetIds.add(id);
        }
      }
      if (typeof value === "object" && value !== null) pending.push(value);
    }
  }
  if (assetIds.size > 500) { apiError(res, 400, "Too many media attachments."); return; }
  if (assetIds.size) {
    const referenced = await db.select({ url: assets.url }).from(assets).where(inArray(assets.id, [...assetIds]));
    if (referenced.some((a) => isHistoricalClippingUrl(a.url))) {
      apiError(res, 400, "Use the Historical Recap composer for newspaper clippings."); return;
    }
  }
  if (!hasUrl) { next(); return; }
  if (req.method === "POST" && req.path === "/historical-recaps") { next(); return; }
  const edit = req.method === "PATCH" && /^\/(?:historical-recaps|posts)\/([^/]+)$/.exec(req.path);
  if (edit) {
    const parsed = parsePostId(edit[1]);
    if (parsed && (parsed.kind === "article" || parsed.kind === "org_post")) {
      const table = parsed.kind === "article" ? articles : orgPosts;
      const [row] = await db.select({ kind: table.recapKind }).from(table).where(eq(table.id, parsed.id)).limit(1);
      if (row?.kind === "historical") { next(); return; }
    }
  }
  apiError(res, 400, "Use the Historical Recap composer for newspaper clippings.");
});