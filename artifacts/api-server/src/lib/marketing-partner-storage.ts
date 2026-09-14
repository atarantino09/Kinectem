import { randomUUID } from "node:crypto";
import { type File, Storage } from "@google-cloud/storage";

const SIDECAR = "http://127.0.0.1:1106";
const LOGO_PREFIX = "/api/v1/marketing-partner-logos/";

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

function publicRoot(): string {
  const root = (process.env.PUBLIC_OBJECT_SEARCH_PATHS ?? "")
    .split(",")
    .map((value) => value.trim())
    .find(Boolean);
  if (!root) throw new Error("App Storage is not configured.");
  return root.replace(/\/+$/, "");
}

function parseObjectPath(path: string): { bucketName: string; objectName: string } {
  const parts = path.replace(/^\/+/, "").split("/");
  if (parts.length < 2) throw new Error("Invalid App Storage path.");
  return { bucketName: parts[0], objectName: parts.slice(1).join("/") };
}

function fileForKey(key: string): File {
  if (!/^[0-9a-f-]{36}$/.test(key)) throw new Error("Invalid partner logo key.");
  const { bucketName, objectName } = parseObjectPath(`${publicRoot()}/marketing-partners/${key}`);
  return storage.bucket(bucketName).file(objectName);
}

export async function createPartnerLogoUpload(): Promise<{ uploadUrl: string; logoUrl: string }> {
  const key = randomUUID();
  const { bucketName, objectName } = parseObjectPath(`${publicRoot()}/marketing-partners/${key}`);
  const response = await fetch(`${SIDECAR}/object-storage/signed-object-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      bucket_name: bucketName,
      object_name: objectName,
      method: "PUT",
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Could not create upload URL (${response.status}).`);
  const body = (await response.json()) as { signed_url?: string };
  if (!body.signed_url) throw new Error("App Storage did not return an upload URL.");
  return { uploadUrl: body.signed_url, logoUrl: `${LOGO_PREFIX}${key}` };
}

export function partnerLogoFileFromUrl(logoUrl: string): File {
  if (!logoUrl.startsWith(LOGO_PREFIX)) throw new Error("Invalid partner logo URL.");
  return fileForKey(logoUrl.slice(LOGO_PREFIX.length));
}

export function partnerLogoFileFromKey(key: string): File {
  return fileForKey(key);
}