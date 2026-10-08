import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
const mocks = vi.hoisted(() => ({ lookup: vi.fn(), request: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup: mocks.lookup }));
vi.mock("node:http", () => ({ request: mocks.request }));
vi.mock("node:https", () => ({ request: mocks.request }));
import { fetchPublicResultsHtml, resultsFetchBudget } from "../src/lib/public-results-fetch";
import { ingestResultsUrl } from "../src/lib/competition-results-intake";

function response(status: number, html: string, headers: Record<string, string> = {}) {
  const stream = Readable.from([Buffer.from(html)]) as Readable & { statusCode: number; headers: Record<string, string> };
  stream.statusCode = status;
  stream.headers = { "content-type": "text/html", ...headers };
  return stream;
}
describe("DNS-pinned bounded public results navigation", () => {
  beforeEach(() => {
    mocks.lookup.mockReset().mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    mocks.request.mockReset();
  });
  function reply(...responses: ReturnType<typeof response>[]) {
    for (const r of responses) mocks.request.mockImplementationOnce((_url, _options, callback) => {
      const req = new EventEmitter() as EventEmitter & { end: () => void };
      req.end = () => callback(r);
      return req;
    });
  }
  it("pins the validated public address to the actual HTTP connection", async () => {
    reply(response(200, "<table>public results</table>"));
    const result = await fetchPublicResultsHtml("https://public.example/results", resultsFetchBudget());
    expect(result.html).toContain("public results");
    const options = mocks.request.mock.calls[0][1];
    const cb = vi.fn();
    options.lookup("public.example", {}, cb);
    expect(cb).toHaveBeenCalledWith(null, "93.184.216.34", 4);
    expect(options.agent).toBe(false);
    expect(options.family).toBe(4);
  });
  it("rechecks redirected hosts and refuses private redirects before a second request", async () => {
    reply(response(302, "", { location: "http://169.254.169.254/latest/meta-data" }));
    await expect(fetchPublicResultsHtml("https://public.example/results", resultsFetchBudget())).rejects.toThrow("Private");
    expect(mocks.request).toHaveBeenCalledTimes(1);
  });
  it("rejects mixed public/private DNS answers and DNS-rebinding targets", async () => {
    mocks.lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }, { address: "10.0.0.1", family: 4 }]);
    await expect(fetchPublicResultsHtml("https://public.example", resultsFetchBudget())).rejects.toThrow("private");
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it("caps redirects/requests, bytes and total elapsed time", async () => {
    reply(...Array.from({length: 5}, () => response(302, "", { location: "/again" })));
    await expect(fetchPublicResultsHtml("https://public.example", resultsFetchBudget())).rejects.toThrow("limit");
    expect(mocks.request).toHaveBeenCalledTimes(5);
    reply(response(200, "x".repeat(2_000_001)));
    await expect(fetchPublicResultsHtml("https://public.example", resultsFetchBudget())).rejects.toThrow("byte limit");
    await expect(fetchPublicResultsHtml("https://public.example", {deadline: Date.now() - 1, requests: 0, bytes: 0})).rejects.toThrow("limit");
  });
  it("truthfully returns login/verification status and rejects non-HTML layouts", async () => {
    reply(response(403, "secret"), response(200, "%PDF", {"content-type": "application/pdf"}));
    expect((await fetchPublicResultsHtml("https://public.example", resultsFetchBudget())).html).toContain("verification");
    await expect(fetchPublicResultsHtml("https://public.example", resultsFetchBudget())).rejects.toThrow("not an HTML");
  });
  it("discovers bounded same-origin bracket pages, never follows off-site links and reports partial discovery", async () => {
    const table = (label: string) => `<h2>${label}</h2><table><tr><th>Home</th><th>Away</th><th>Home Score</th><th>Away Score</th></tr><tr><td>Rovers</td><td>United</td><td>2</td><td>1</td></tr></table>`;
    reply(response(200, table("Gold") + '<a href="/results/silver">Silver results</a><a href="https://offsite.example/bracket">Other bracket</a>'),
      response(200, table("Silver")));
    const imported = await ingestResultsUrl("https://public.example/results");
    expect(imported.groups.map(g => g.label)).toEqual(["Gold", "Silver"]);
    expect(imported.status).toBe("partial");
    expect(mocks.request).toHaveBeenCalledTimes(2);
    expect(mocks.request.mock.calls.every(([url]) => url.hostname === "public.example")).toBe(true);
  });
});
