import { Button } from "@/components/ui/button";

export const LIST_PAGE_SIZE = 8;

export function ListPages({ total, page, onPage, label }: {
  total: number;
  page: number;
  onPage: (page: number) => void;
  label: string;
}) {
  const pages = Math.max(1, Math.ceil(total / LIST_PAGE_SIZE));
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <span className="flex-1">
        {total === 0 ? "0" : `${(page - 1) * LIST_PAGE_SIZE + 1}–${Math.min(page * LIST_PAGE_SIZE, total)}`} of {total}
      </span>
      {pages > 1 && <>
        <Button size="sm" variant="outline" aria-label={`Previous ${label}`} disabled={page === 1}
          onClick={() => onPage(page - 1)}>Previous</Button>
        <Button size="sm" variant="outline" aria-label={`Next ${label}`} disabled={page === pages}
          onClick={() => onPage(page + 1)}>Next</Button>
      </>}
    </div>
  );
}
