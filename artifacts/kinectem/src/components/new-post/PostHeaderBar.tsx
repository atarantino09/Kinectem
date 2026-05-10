import { Button } from "@/components/ui/button";
import { ArrowLeft, Save, Check, Trash2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface PostHeaderBarProps {
  Icon: LucideIcon;
  heading: string;
  // Centered "Editing X" label override — when set, takes priority
  // over the legacy `isEditingPublished ? "Editing Recap" : ...`
  // fallback so highlights and org Updates surface their own labels.
  editingLabel?: string;
  isShort: boolean;
  isEditingPublished: boolean;
  draftId: string | null;
  saving: boolean;
  publishing: boolean;
  savedAt: Date | null;
  onCancel: () => void;
  onSaveDraft: () => void;
  // Optional delete affordance — rendered only when the parent
  // determines the viewer is allowed to delete the loaded post.
  // Permissions are decided server-side and surfaced via canDelete:
  // recap article = original author only; highlight = uploader only;
  // org Update = author only. Drafts and brand-new posts leave this
  // undefined so the button never appears.
  canDelete?: boolean;
  onRequestDelete?: () => void;
  // Mirror of PostFormFields' `publishDisabled` — used to disable the
  // header's Post/Publish/Save submit button when the form has no
  // valid team to post to (e.g. the user has zero authorable teams).
  publishDisabled?: boolean;
}

export function PostHeaderBar({
  Icon,
  heading,
  editingLabel,
  isShort,
  isEditingPublished,
  draftId,
  saving,
  publishing,
  savedAt,
  onCancel,
  onSaveDraft,
  canDelete = false,
  onRequestDelete,
  publishDisabled = false,
}: PostHeaderBarProps) {
  // Only surface the Delete affordance when the viewer is editing an
  // already-published post AND the server marked them as eligible to
  // delete it. Keeping this check inline (rather than at the call
  // site) means the header bar stays the single source of truth for
  // the rule. Highlights and org Updates also flow through here now —
  // permissions are decided server-side via canDelete.
  const showDelete =
    isEditingPublished && canDelete && !!onRequestDelete;
  return (
    <header className="border-b border-border bg-card">
      <div className="max-w-3xl mx-auto px-4 h-14 flex items-center justify-between gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={onCancel}
          className="font-bold"
          data-testid="button-cancel-post-editor"
        >
          <ArrowLeft className="w-4 h-4 mr-2" /> Cancel
        </Button>
        <div className="flex items-center gap-2 text-sm font-bold">
          <Icon className="w-4 h-4" />
          {isEditingPublished
            ? (editingLabel ?? "Editing Recap")
            : draftId
              ? "Editing Draft"
              : heading}
        </div>
        <div className="flex items-center gap-2">
          {showDelete && (
            // Visually secondary to Save: ghost button with destructive
            // text on the left of the action group so it isn't hit by
            // accident. Opens the same confirm dialog used on the post
            // view page.
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onRequestDelete}
              className="font-bold rounded-full text-destructive hover:text-destructive hover:bg-destructive/10"
              data-testid="button-delete-post-editor"
            >
              <Trash2 className="w-3.5 h-3.5 mr-1.5" />
              Delete
            </Button>
          )}
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
            variant="brand"
            disabled={publishing || publishDisabled}
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
