import { Router, type IRouter } from "express";
import { asc } from "drizzle-orm";
import { db, marketingPartners } from "@workspace/db";
import { partnerLogoFileFromKey } from "../lib/marketing-partner-storage";
import { asyncHandler } from "../lib/async-handler";

const router: IRouter = Router();

router.get(
  "/marketing-partners",
  asyncHandler(async (_req, res) => {
    const rows = await db
      .select()
      .from(marketingPartners)
      .orderBy(asc(marketingPartners.sortOrder), asc(marketingPartners.createdAt));
    res.json({ data: rows });
  }),
);

router.get(
  "/marketing-partner-logos/:key",
  asyncHandler(async (req, res) => {
    const key = String(req.params.key);
    let file;
    try {
      file = partnerLogoFileFromKey(key);
    } catch {
      res.status(404).json({ error: "Logo not found." });
      return;
    }
    const [exists] = await file.exists();
    if (!exists) {
      res.status(404).json({ error: "Logo not found." });
      return;
    }
    const [metadata] = await file.getMetadata();
    const contentType = String(metadata.contentType || "");
    if (!["image/png", "image/jpeg", "image/webp", "image/svg+xml"].includes(contentType)) {
      res.status(404).json({ error: "Logo not found." });
      return;
    }
    res.setHeader("Content-Type", contentType);
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (contentType === "image/svg+xml") {
      res.setHeader("Content-Security-Policy", "sandbox");
    }
    res.setHeader("Cache-Control", "public, max-age=3600");
    file.createReadStream().pipe(res);
  }),
);

export default router;