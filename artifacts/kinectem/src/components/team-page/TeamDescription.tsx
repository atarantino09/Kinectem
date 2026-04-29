import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { linkify } from "@/lib/linkify";

export function TeamDescription({
  description,
  teamName,
}: {
  description: string;
  teamName: string;
}) {
  const ref = useRef<HTMLParagraphElement | null>(null);
  const [overflow, setOverflow] = useState(false);
  const [open, setOpen] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => {
      setOverflow(el.scrollHeight - 1 > el.clientHeight);
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [description]);

  useEffect(() => {
    setOverflow((prev) => prev);
  }, []);

  return (
    <div className="mt-3 max-w-md">
      <p
        ref={ref}
        className="text-sm text-muted-foreground leading-relaxed line-clamp-5 whitespace-pre-wrap"
        data-testid="text-team-description"
      >
        {linkify(description)}
      </p>
      {overflow && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-1 text-xs font-bold text-primary hover:underline"
          data-testid="btn-team-description-more"
        >
          See more
        </button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-black tracking-tight">
              About {teamName}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">
            {linkify(description)}
          </p>
        </DialogContent>
      </Dialog>
    </div>
  );
}
