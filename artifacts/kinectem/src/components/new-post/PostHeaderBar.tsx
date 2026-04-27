import { Button } from "@/components/ui/button";
import { ArrowLeft, Save, Check } from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface PostHeaderBarProps {
  Icon: LucideIcon;
  heading: string;
  isShort: boolean;
  isEditingPublished: boolean;
  draftId: string | null;
  saving: boolean;
  publishing: boolean;
  savedAt: Date | null;
  onCancel: () => void;
  onSaveDraft: () => void;
}

export function PostHeaderBar({
  Icon,
  heading,
  isShort,
  isEditingPublished,
  draftId,
  saving,
  publishing,
  savedAt,
  onCancel,
  onSaveDraft,
}: PostHeaderBarProps) {
  return (
    <header className="border-b border-border bg-card">
      <div className="max-w-3xl mx-auto px-4 h-14 flex items-center justify-between gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={onCancel}
          className="font-bold"
        >
          <ArrowLeft className="w-4 h-4 mr-2" /> Cancel
        </Button>
        <div className="flex items-center gap-2 text-sm font-bold">
          <Icon className="w-4 h-4" />
          {isEditingPublished
            ? "Editing Recap"
            : draftId
              ? "Editing Draft"
              : heading}
        </div>
        <div className="flex items-center gap-2">
          {!isShort && !isEditingPublished && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onSaveDraft}
              disabled={saving}
              className="font-bold rounded-full"
              data-testid="button-save-draft"
            >
              <Save className="w-3.5 h-3.5 mr-1.5" />
              {saving ? "Saving…" : "Save Draft"}
            </Button>
          )}
          <Button
            type="submit"
            form="new-post-form"
            disabled={publishing}
            className="font-bold rounded-full"
            data-testid="button-publish"
          >
            {publishing
              ? "Posting…"
              : isEditingPublished
                ? "Save"
                : draftId
                  ? "Publish"
                  : "Post"}
          </Button>
        </div>
      </div>
      {draftId && savedAt && (
        <div className="max-w-3xl mx-auto px-4 pb-2 text-[11px] text-muted-foreground flex items-center gap-1.5 font-semibold">
          <Check className="w-3 h-3 text-emerald-600" />
          Saved {savedAt.toLocaleTimeString()}
        </div>
      )}
    </header>
  );
}
