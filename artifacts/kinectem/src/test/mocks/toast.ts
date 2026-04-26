import { vi, type Mock } from "vitest";

export const toastSpy: Mock = vi.fn();
export const dismissToastSpy: Mock = vi.fn();

export function resetToastMock(): void {
  toastSpy.mockReset();
  dismissToastSpy.mockReset();
}

/**
 * Drop-in replacement for `@/hooks/use-toast`. Pass via:
 *
 *   vi.mock("@/hooks/use-toast", () => useToastMock);
 *
 * Tests can assert against `toastSpy` to verify a toast fired.
 */
export const useToastMock = {
  useToast: () => ({ toast: toastSpy, dismiss: dismissToastSpy, toasts: [] }),
  toast: toastSpy,
};
