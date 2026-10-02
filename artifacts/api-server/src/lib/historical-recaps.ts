import { z } from "zod";
import sharp from "sharp";
import { db, teams, organizations, type HistoricalRecapMetadata } from "@workspace/db";
import { eq } from "drizzle-orm";
import { canAuthorRecapAnywhere, canCreateRecap, canManageOrganization } from "./permissions";
import { detectMime } from "./magic-bytes";

export const HISTORICAL_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export class HistoricalValidationError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((v) => {
  const parsed = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === v &&
    v <= new Date().toISOString().slice(0, 10) && Number(v.slice(0, 4)) >= 1000;
}, "Enter a real historical date, not a future date.");
export const HistoricalMetadata = z.object({
  gameDate: date.nullable().default(null),
  year: z.number().int().min(1000).max(new Date().getUTCFullYear()).nullable().default(null),
  newspaper: z.string().trim().max(300).nullable().default(null),
  byline: z.string().trim().max(300).nullable().default(null),
  publicationDate: date.nullable().default(null),
  rightsConfirmed: z.boolean().default(false),
  reviewed: z.boolean().default(false),
}).strict().refine((v) => !(v.gameDate && v.year), "Choose an exact date or a year, not both.");

export const HistoricalScope = z.object({
  teamId: z.string().uuid().optional(),
  organizationId: z.string().uuid().optional(),
}).refine((v) => Boolean(v.teamId) !== Boolean(v.organizationId), "Choose one team or organization.");

// Both capability and destination authorization must precede external egress.
export async function authorizeHistoricalScope(userId: string, scope: z.infer<typeof HistoricalScope>) {
  if (!(await canAuthorRecapAnywhere(userId))) return null;
  if (scope.teamId) {
    const [team] = await db.select().from(teams).where(eq(teams.id, scope.teamId)).limit(1);
    if (!team || !(await canCreateRecap(userId, team))) return null;
    const [org] = team.organizationId
      ? await db.select().from(organizations).where(eq(organizations.id, team.organizationId)).limit(1)
      : [null];
    return { team, org: org ?? null };
  }
  const [org] = await db.select().from(organizations)
    .where(eq(organizations.id, scope.organizationId!)).limit(1);
  if (!org || !(await canManageOrganization(userId, org.id))) return null;
  return { team: null, org };
}

export async function validateHistoricalImage(dataUrl: unknown) {
  if (typeof dataUrl !== "string" || dataUrl.length > Math.ceil(HISTORICAL_IMAGE_MAX_BYTES / 3) * 4 + 64) {
    throw new HistoricalValidationError("Clipping must be an image no larger than 5 MB.", 413);
  }
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!match || match[2].length % 4 !== 0) throw new HistoricalValidationError("Upload a JPEG, PNG or WebP image.");
  const buffer = Buffer.from(match[2], "base64");
  if (!buffer.length || buffer.length > HISTORICAL_IMAGE_MAX_BYTES) {
    throw new HistoricalValidationError("Clipping must be no larger than 5 MB.", 413);
  }
  if (buffer.toString("base64") !== match[2] || detectMime(buffer) !== match[1]) {
    throw new HistoricalValidationError("Image content does not match its file type.");
  }
  try {
    const image = sharp(buffer, { limitInputPixels: 32_000_000, failOn: "warning" });
    const meta = await image.metadata();
    if (!meta.width || !meta.height || meta.width > 8000 || meta.height > 8000 ||
        meta.width * meta.height > 32_000_000 || (meta.pages ?? 1) !== 1) {
      throw new Error("dimensions");
    }
    // Decode the complete image: magic bytes and a forged header alone are not
    // enough. Do not filter, crop, or replace the original stored bytes.
    await image.stats();
  } catch {
    throw new HistoricalValidationError("Image is invalid or exceeds 8000 pixels per edge / 32 megapixels.");
  }
  return { buffer, mediaType: match[1] as "image/jpeg" | "image/png" | "image/webp", base64: match[2] };
}

export function validateHistoricalPublication(row: {
  title: string; body: string; coverImageUrl: string | null; historical: HistoricalRecapMetadata | null;
}, reviewed: unknown) {
  const metadata = HistoricalMetadata.safeParse(row.historical);
  if (!metadata.success) throw new HistoricalValidationError("Invalid historical metadata.");
  if (!row.title.trim() || !row.body.trim() || !row.coverImageUrl) {
    throw new HistoricalValidationError("Add a title, clipping and transcript before publishing.");
  }
  if (!metadata.data.gameDate && !metadata.data.year) {
    throw new HistoricalValidationError("Enter the historical game date or year.");
  }
  if (!metadata.data.rightsConfirmed) throw new HistoricalValidationError("Confirm permission to share the clipping.");
  if (reviewed !== true) throw new HistoricalValidationError("Review the transcript before publishing.");
  return { ...metadata.data, reviewed: true };
}