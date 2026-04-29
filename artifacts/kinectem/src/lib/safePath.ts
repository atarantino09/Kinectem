export function safeInternalPath(
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  if (typeof value !== "string") return null;
  if (!value.startsWith("/")) return null;
  if (value.startsWith("//") || value.startsWith("/\\")) return null;
  if (/[\s\u0000-\u001f]/.test(value)) return null;
  return value;
}
