import { Loader2 } from "lucide-react";

/**
 * Lightweight, branded fallback shown while a lazily-loaded route or
 * component chunk is being fetched. Fills a generous slice of the
 * viewport so it reads as a real loading state rather than a flash.
 */
export function PageLoader() {
  return (
    <div
      className="flex items-center justify-center min-h-[50vh] w-full"
      role="status"
      aria-label="Loading"
      data-testid="page-loader"
    >
      <Loader2 className="w-8 h-8 animate-spin text-primary" />
    </div>
  );
}
