import { vi, type Mock } from "vitest";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type MockApiHandler = (input: {
  url: string;
  method: HttpMethod;
  init?: RequestInit;
  body: unknown;
}) => unknown | Promise<unknown>;

export type MockApiHandlers = Record<string, MockApiHandler | unknown>;

export interface MockApi {
  fetch: Mock;
  setHandler(route: string, handler: MockApiHandler | unknown): void;
  setHandlers(handlers: MockApiHandlers): void;
  reset(): void;
}

function parseRoute(route: string): { method: HttpMethod; url: string } {
  const trimmed = route.trim();
  const space = trimmed.indexOf(" ");
  if (space === -1) {
    return { method: "GET", url: trimmed };
  }
  const method = trimmed.slice(0, space).toUpperCase() as HttpMethod;
  const url = trimmed.slice(space + 1).trim();
  return { method, url };
}

function parseBody(init?: RequestInit): unknown {
  if (!init || init.body == null) return undefined;
  if (typeof init.body === "string") {
    try {
      return JSON.parse(init.body);
    } catch {
      return init.body;
    }
  }
  return init.body;
}

/**
 * Creates a fetch-style mock that dispatches to per-route handlers. Routes are
 * keyed by `"METHOD /url"` (method defaults to GET when omitted). Handler
 * values may be plain objects (returned as-is) or functions receiving
 * `{ url, method, init, body }` and returning the response payload.
 *
 * Unmatched calls throw with a descriptive message so failing tests pinpoint
 * the missing route immediately.
 */
export function createMockApi(initialHandlers: MockApiHandlers = {}): MockApi {
  const handlers = new Map<string, MockApiHandler | unknown>();

  const register = (route: string, handler: MockApiHandler | unknown) => {
    const { method, url } = parseRoute(route);
    handlers.set(`${method} ${url}`, handler);
  };

  const setHandlers = (next: MockApiHandlers) => {
    for (const [route, handler] of Object.entries(next)) {
      register(route, handler);
    }
  };

  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = ((init?.method ?? "GET").toUpperCase()) as HttpMethod;
    const key = `${method} ${url}`;
    const handler = handlers.get(key);
    if (handler === undefined) {
      throw new Error(`Unexpected fetch in test: ${method} ${url}`);
    }
    if (typeof handler === "function") {
      return await (handler as MockApiHandler)({
        url,
        method,
        init,
        body: parseBody(init),
      });
    }
    return handler;
  });

  setHandlers(initialHandlers);

  return {
    fetch: fetchMock,
    setHandler: register,
    setHandlers,
    reset() {
      handlers.clear();
      fetchMock.mockReset();
    },
  };
}
