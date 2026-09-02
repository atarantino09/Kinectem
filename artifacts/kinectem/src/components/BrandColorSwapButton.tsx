import { ArrowLeftRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export function BrandColorSwapButton({
  onSwap,
  testId = "btn-swap-brand-colors",
}: {
  onSwap: () => void;
  testId?: string;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className="gap-2 rounded-full font-bold"
      onClick={onSwap}
      aria-label="Swap primary and secondary brand colors"
      title="Swap primary and secondary brand colors"
      data-testid={testId}
    >
      <ArrowLeftRight className="h-4 w-4" />
      Swap colors
    </Button>
  );
}