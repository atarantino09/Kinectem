import type { ReactNode } from "react";

let mockedSearch = "";
let mockedLocation = "/";
const navigateSpy = (path: string) => {
  mockedLocation = path;
};

export function setMockSearch(next: string): void {
  mockedSearch = next;
}

export function getMockSearch(): string {
  return mockedSearch;
}

export function setMockLocation(next: string): void {
  mockedLocation = next;
}

export function getMockLocation(): string {
  return mockedLocation;
}

export function resetWouterMock(): void {
  mockedSearch = "";
  mockedLocation = "/";
}

/**
 * Drop-in replacement for the `wouter` module. Pass to `vi.mock("wouter")` via:
 *
 *   vi.mock("wouter", () => wouterMock);
 *
 * Then drive the navigation state from a test using `setMockSearch()` /
 * `setMockLocation()`. `Link` renders its children inline (no anchor) so query
 * tests don't have to dodge anchor click handling.
 */
export const wouterMock = {
  Link: ({ children }: { children: ReactNode; href?: string; to?: string }) => <>{children}</>,
  useSearch: () => mockedSearch,
  useLocation: (): [string, (path: string) => void] => [mockedLocation, navigateSpy],
  useRoute: (): [boolean, Record<string, string>] => [true, {}],
  Route: ({ children }: { children?: ReactNode }) => <>{children}</>,
  Switch: ({ children }: { children?: ReactNode }) => <>{children}</>,
  Redirect: () => null,
};
