import { Storage } from "@google-cloud/storage";
import type { Response } from "express";
import { pipeline } from "node:stream/promises";

const SIDECAR = "http://127.0.0.1:1106";
const storage = new Storage({
  credentials: {
    audience: "replit", subject_token_type: "access_token",
    token_url: `${SIDECAR}/token`, type: "external_account",
    credential_source: { url: `${SIDECAR}/credential`, format: { type: "json", subject_token_field_name: "access_token" } },
    universe_domain: "googleapis.com",
  }, projectId: "",
});
function clippingFile(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Invalid clipping id.");
  const root = process.env.PRIVATE_OBJECT_DIR?.replace(/^\/+|\/+$/g, "");
  if (!root) throw new Error("App Storage is not configured.");
  const [bucket, ...path] = root.split("/");
  return storage.bucket(bucket).file(`${path.join("/")}/historical-clippings/${id}`);
}
export async function saveHistoricalClipping(id: string, bytes: Buffer, contentType: string) {
  await clippingFile(id).save(bytes, { resumable: false, metadata: { contentType } });
}
export async function serveHistoricalClipping(id: string, contentType: string, res: Response) {
  res.setHeader("Content-Type", contentType);
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  await pipeline(clippingFile(id).createReadStream(), res);
}