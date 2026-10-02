import { randomUUID } from "node:crypto";
import { type File, Storage } from "@google-cloud/storage";
import type { Response } from "express";
import { pipeline } from "node:stream/promises";
import { ALBUM_IMAGE_MIMES, detectMime, normalizeMime } from "./magic-bytes";
import { ALLOWED_MINOR_UPLOAD_MIMES, stripMetadataForMinor } from "./exif-strip";

const SIDECAR = "http://127.0.0.1:1106";
export const COMPETITION_PHOTO_MAX_BYTES = 10 * 1024 * 1024;
const storage = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${SIDECAR}/token`,
    type: "external_account",
    credential_source: {
      url: `${SIDECAR}/credential`,
      format: { type: "json", subject_token_field_name: "access_token" },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

export class CompetitionPhotoValidationError extends Error {
  readonly status = 400;
}

function privateRoot(): string {
  const root = process.env.PRIVATE_OBJECT_DIR?.replace(/\/+$/, "");
  if (!root) throw new Error("App Storage is not configured for competition photos.");
  return root;
}

function parsePath(path: string): { bucket: string; object: string } {
  const [bucket, ...parts] = path.replace(/^\/+/, "").split("/");
  if (!bucket || parts.length === 0) throw new Error("Invalid private photo path.");
  return { bucket, object: parts.join("/") };
}

function fileAt(path: string): File {
  const { bucket, object } = parsePath(path);
  return storage.bucket(bucket).file(object);
}

function stagingPath(photoId: string): string {
  if (!/^[0-9a-f-]{36}$/i.test(photoId)) throw new Error("Invalid competition photo ID.");
  return `${privateRoot()}/competition-photos/staging/${photoId}`;
}

function assertSealedPath(path: string): void {
  const prefix = `${privateRoot()}/competition-photos/sealed/`;
  if (!path.startsWith(prefix) || !/^[0-9a-f-]{36}\/[0-9a-f-]{36}$/i.test(path.slice(prefix.length))) {
    throw new Error("Invalid sealed competition photo path.");
  }
}

/** Only quarantined originals get signed upload URLs; serving never uses this path. */
export async function createCompetitionPhotoUpload(photoId: string): Promise<{ uploadUrl: string }> {
  const { bucket, object } = parsePath(stagingPath(photoId));
  const response = await fetch(`${SIDECAR}/object-storage/signed-object-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      bucket_name: bucket,
      object_name: object,
      method: "PUT",
      expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Could not request photo upload (${response.status}).`);
  const body = (await response.json()) as { signed_url?: string };
  if (!body.signed_url) throw new Error("App Storage did not provide a photo upload URL.");
  return { uploadUrl: body.signed_url };
}

/** Bound the stream as well as metadata; a still-valid PUT URL may overwrite staging. */
async function readBounded(file: File): Promise<Buffer> {
  const [metadata] = await file.getMetadata();
  const declaredSize = Number(metadata.size);
  if (!Number.isFinite(declaredSize) || declaredSize < 1 || declaredSize > COMPETITION_PHOTO_MAX_BYTES) {
    throw new CompetitionPhotoValidationError("Photos must be nonempty and no larger than 10 MB after processing.");
  }
  const chunks: Buffer[] = [];
  let total = 0;
  const stream = file.createReadStream();
  try {
    for await (const chunk of stream) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += bytes.length;
      if (total > COMPETITION_PHOTO_MAX_BYTES) {
        throw new CompetitionPhotoValidationError("Photo exceeds the 10 MB upload limit.");
      }
      chunks.push(bytes);
    }
  } finally {
    stream.destroy();
  }
  if (!total) throw new CompetitionPhotoValidationError("Photo upload is empty.");
  return Buffer.concat(chunks, total);
}

export function validateCompetitionPhotoBytes(bytes: Buffer, fileType: string, isMinor: boolean): Buffer {
  const mime = normalizeMime(fileType);
  if (!bytes.length || bytes.length > COMPETITION_PHOTO_MAX_BYTES) {
    throw new CompetitionPhotoValidationError("Photo must be nonempty and no larger than 10 MB.");
  }
  if (!ALBUM_IMAGE_MIMES.has(mime) || detectMime(bytes) !== mime) {
    throw new CompetitionPhotoValidationError("Upload a valid JPEG, PNG, WebP, or GIF photo matching its declared type.");
  }
  if (isMinor && !ALLOWED_MINOR_UPLOAD_MIMES.has(mime)) {
    throw new CompetitionPhotoValidationError("Under-13 accounts may only upload JPEG or PNG photos.");
  }
  return isMinor ? stripMetadataForMinor(bytes, mime).buffer : bytes;
}

/**
 * Sealing prevents a presigned staging URL from replacing a moderated image
 * after approval. Final objects are private and never have signed PUT URLs.
 */
export async function sealCompetitionPhotoUpload(
  photoId: string,
  fileType: string,
  isMinor: boolean,
): Promise<{ objectPath: string; fileSize: number }> {
  const staging = fileAt(stagingPath(photoId));
  const bytes = validateCompetitionPhotoBytes(await readBounded(staging), fileType, isMinor);
  const objectPath = `${privateRoot()}/competition-photos/sealed/${photoId}/${randomUUID()}`;
  await fileAt(objectPath).save(bytes, {
    resumable: false,
    preconditionOpts: { ifGenerationMatch: 0 },
    metadata: {
      contentType: normalizeMime(fileType),
      cacheControl: "private, no-store",
    },
  });
  // Cleanup is best effort; staging has no read route and is never published.
  await staging.delete({ ignoreNotFound: true }).catch(() => undefined);
  return { objectPath, fileSize: bytes.length };
}

/** The caller MUST authorize against current moderation state before streaming. */
export async function streamCompetitionPhoto(
  res: Response,
  objectPath: string,
  fileType: string,
): Promise<void> {
  assertSealedPath(objectPath);
  const mime = normalizeMime(fileType);
  if (!ALBUM_IMAGE_MIMES.has(mime)) throw new Error("Unsupported stored photo type.");
  const file = fileAt(objectPath);
  const [metadata] = await file.getMetadata();
  res.set({
    "Content-Type": mime,
    "Content-Length": String(metadata.size),
    "Cache-Control": "private, no-store, max-age=0",
    "X-Content-Type-Options": "nosniff",
    "Content-Disposition": "inline",
  });
  await pipeline(file.createReadStream(), res);
}

export async function deleteCompetitionPhotoObject(objectPath: string): Promise<void> {
  assertSealedPath(objectPath);
  await fileAt(objectPath).delete({ ignoreNotFound: true });
}