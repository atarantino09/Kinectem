import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

export class ResultsFetchError extends Error {}
export const RESULTS_FETCH_LIMITS = { bytes: 2_000_000, requests: 5, timeoutMs: 15_000 };

// Conservative public-unicast allowlist. Reject reserved/documentation,
// multicast, mapped private IPv4, metadata and local ranges as well as RFC1918.
export function isPublicResultsAddress(address: string): boolean {
  const ip = address.toLowerCase().replace(/^\[|\]$/g, "");
  if (ip.startsWith("::ffff:")) {
    const tail = ip.slice(7);
    if (isIP(tail) === 4) return isPublicResultsAddress(tail);
    const parts = tail.split(":");
    if (parts.length !== 2) return false;
    const n = parseInt(parts[0], 16) * 65536 + parseInt(parts[1], 16);
    return isPublicResultsAddress([n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join("."));
  }
  if (isIP(ip) === 4) {
    const [a, b, c] = ip.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113));
  }
  // Only native global IPv6. Exclude Teredo, 6to4 and documentation prefixes.
  return isIP(ip) === 6 && /^[23]/.test(ip) &&
    !/^2001:(?:0:|db8:|2:|10:|20:)/.test(ip) && !/^2002:/.test(ip);
}

export function publicResultsUrl(raw: string): URL {
  let url: URL;
  try { url = new URL(raw); } catch { throw new ResultsFetchError("Enter a valid public http(s) results URL."); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password ||
    (url.port && !["80", "443"].includes(url.port))) {
    throw new ResultsFetchError("Only public http(s) URLs without credentials or custom ports are supported.");
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || /\.(?:local|internal|localhost)$/.test(host) ||
    (isIP(host) && !isPublicResultsAddress(host))) {
    throw new ResultsFetchError("Private and reserved network addresses cannot be fetched.");
  }
  url.hash = "";
  return url;
}

export interface ResultsFetchBudget { deadline: number; requests: number; bytes: number }
export function resultsFetchBudget(): ResultsFetchBudget {
  return { deadline: Date.now() + RESULTS_FETCH_LIMITS.timeoutMs, requests: 0, bytes: 0 };
}

export async function fetchPublicResultsHtml(raw: string, budget: ResultsFetchBudget): Promise<{html: string; finalUrl: string}> {
  let current = publicResultsUrl(raw);
  for (;;) {
    const remaining = budget.deadline - Date.now();
    if (remaining <= 0 || ++budget.requests > RESULTS_FETCH_LIMITS.requests) {
      throw new ResultsFetchError("Results discovery reached its time/request limit. Import CSV or paste results to cover missing brackets.");
    }
    const signal = AbortSignal.timeout(remaining);
    const host = current.hostname.replace(/^\[|\]$/g, "");
    const addresses = await Promise.race([
      isIP(host) ? Promise.resolve([{ address: host, family: isIP(host) }]) : lookup(host, { all: true }),
      new Promise<never>((_, reject) => signal.addEventListener("abort", () => reject(new ResultsFetchError("Results website timed out.")), { once: true })),
    ]);
    if (!addresses.length || addresses.some(a => !isPublicResultsAddress(a.address))) {
      throw new ResultsFetchError("The website resolves to a private or reserved network address.");
    }
    const pinned = addresses[0];
    // Pin the validated DNS address to the actual connection. TLS still uses
    // the original hostname; no second DNS lookup/rebinding window.
    const result = await new Promise<{ status: number; location?: string; html: string }>((resolve, reject) => {
      const request = (current.protocol === "https:" ? httpsRequest : httpRequest)(current, {
        signal, agent: false, family: pinned.family,
        lookup: (_hostname, _options, callback) => callback(null, pinned.address, pinned.family),
        headers: { Accept: "text/html,application/xhtml+xml", "User-Agent": "KinectemResults/1.0", "Accept-Encoding": "identity" },
      }, response => {
        const status = response.statusCode ?? 500;
        if (status >= 300 && status < 400) {
          response.resume();
          resolve({ status, location: response.headers.location, html: "" });
          return;
        }
        if (![200, 401, 403].includes(status)) {
          response.destroy();
          reject(new ResultsFetchError(`Website returned HTTP ${status}. Use CSV or pasted results.`));
          return;
        }
        if (!/text\/html|application\/xhtml/i.test(response.headers["content-type"] ?? "")) {
          response.destroy();
          reject(new ResultsFetchError("This is not an HTML results page. Use CSV or pasted results."));
          return;
        }
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => {
          budget.bytes += chunk.length;
          if (budget.bytes > RESULTS_FETCH_LIMITS.bytes) {
            response.destroy(new ResultsFetchError("Results pages exceeded the byte limit. Use CSV or pasted results."));
          } else chunks.push(chunk);
        });
        response.on("error", reject);
        response.on("end", () => resolve({ status, html: Buffer.concat(chunks).toString("utf8") }));
      });
      request.on("error", reject);
      request.end();
    });
    if (result.status >= 300 && result.status < 400) {
      if (!result.location) throw new ResultsFetchError("The website returned an invalid redirect.");
      current = publicResultsUrl(new URL(result.location, current).toString());
      continue;
    }
    if (result.status === 401 || result.status === 403) {
      return { html: '<form type="password">Login or verification required</form>', finalUrl: current.toString() };
    }
    return { html: result.html, finalUrl: current.toString() };
  }
}
