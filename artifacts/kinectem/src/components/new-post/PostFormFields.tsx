import type { PaginatedOrganizationsResponse } from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FileText, Info, Play, Save } from "lucide-react";
import { MediaSection } from "./MediaSection";

interface PostFormFieldsProps {
  postType: "short" | "long";
  onPostTypeChange: (t: "short" | "long") => void;
  title: string;
  onTitleChange: (v: string) => void;
  body: string;
  onBodyChange: (v: string) => void;
  gameDate: string;
  onGameDateChange: (v: string) => void;
  tagRoster: boolean;
  onTagRosterChange: (v: boolean) => void;
  photos: string[];
  onPhotosChange: (next: string[]) => void;
  videoUrl: string;
  onVideoUrlChange: (next: string) => void;
  orgId: string;
  onOrgIdChange: (v: string) => void;
  myOrgs: PaginatedOrganizationsResponse | undefined;
  draftId: string | null;
  lockedToTeam: boolean;
  isEditingPublished: boolean;
  // Loaded post kind (edit path only). Drives field visibility for
  // highlight / org_post; null falls back to the article composer.
  loadedKind?: "article" | "highlight" | "org_post" | null;
  // True only when the viewer is the original author of the loaded
  // article. Used here to suppress the "only the original author can
  // delete" disclaimer for the original author themselves (they have
  // the in-editor Delete affordance and don't need the note). Defaults
  // to false so co-authors / coaches / org admins still see the note.
  canDelete?: boolean;
  saving: boolean;
  publishing: boolean;
  onSaveDraft: () => void;
  onSubmit: (e: React.FormEvent) => void;
}

export function PostFormFields({
  postType,
  onPostTypeChange,
  title,
  onTitleChange,
  body,
  onBodyChange,
  gameDate,
  onGameDateChange,
  tagRoster,
  onTagRosterChange,
  photos,
  onPhotosChange,
  videoUrl,
  onVideoUrlChange,
  orgId,
  onOrgIdChange,
  myOrgs,
  draftId,
  lockedToTeam,
  isEditingPublished,
  loadedKind = null,
  canDelete = false,
  saving,
  publishing,
  onSaveDraft,
  onSubmit,
}: PostFormFieldsProps) {
  const isShort = postType === "short";
  // Org Updates use the long form but hide gameDate / tagRoster /
  // on-behalf-of (which only apply to recap articles).
  const isOrgPost = loadedKind === "org_post";
  return (
    <form id="new-post-form" onSubmit={onSubmit} className="space-y-5">
      {isEditingPublished && !canDelete && (
        // Co-authors, coaches, and org admins can also land on this
        // edit screen but only the original author gets the in-editor
        // Delete affordance. Spell that out so other authors aren't
        // confused when they don't see the delete control. Skip the
        // note when `canDelete` is true — the original author has the
        // Delete button right above and doesn't need this disclaimer.
        <div
          className="flex items-start gap-2 rounded-lg bg-muted/60 border border-border px-3 py-2"
          data-testid="note-only-author-can-delete"
        >
          <Info className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
          <p className="text-xs text-muted-foreground font-medium">
            Only the original author can delete a post. Co-authors,
            coaches, and organization admins can still edit it here.
          </p>
        </div>
      )}
      {!draftId && !lockedToTeam && !isEditingPublished && (
        // Post-type toggle: only when starting from a blank composer.
        <div>
          <Label className="text-xs font-black uppercase tracking-widest text-muted-foreground">
            Post Type
          </Label>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => onPostTypeChange("long")}
              className={`px-4 py-3 rounded-lg border-2 text-sm font-bold flex items-center justify-center gap-2 ${
                postType === "long"
                  ? "border-primary bg-primary/5 text-primary"
                  : "border-border text-muted-foreground"
              }`}
            >
              <FileText className="w-4 h-4" /> Game Recap
            </button>
            <button
              type="button"
              onClick={() => onPostTypeChange("short")}
              className={`px-4 py-3 rounded-lg border-2 text-sm font-bold flex items-center justify-center gap-2 ${
                postType === "short"
                  ? "border-primary bg-primary/5 text-primary"
                  : "border-border text-muted-foreground"
              }`}
            >
              <Play className="w-4 h-4" /> Highlight
            </button>
          </div>
        </div>
      )}

      <div>
        <Label
          htmlFor="title"
          className="text-xs font-black uppercase tracking-widest text-muted-foreground"
        >
          Title
        </Label>
        <Input
          id="title"
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          placeholder={
            isShort
              ? "Game-winning save vs. Crosstown"
              : "Comeback win in OT"
          }
          className="mt-2 text-lg font-bold"
          maxLength={200}
          data-testid="input-title"
        />
      </div>

      {!isShort && !isOrgPost && (
        <div>
          <Label
            htmlFor="game-date"
            className="text-xs font-black uppercase tracking-widest text-muted-foreground"
          >
            Game Date
          </Label>
          <Input
            id="game-date"
            type="date"
            value={gameDate}
            onChange={(e) => onGameDateChange(e.target.value)}
            className="mt-2 font-bold"
            data-testid="input-game-date"
            aria-describedby="game-date-help"
          />
          <p
            id="game-date-help"
            className="mt-1.5 text-[11px] text-muted-foreground font-semibold"
          >
            Defaults to today. Change it if the game was on a different day.
          </p>
        </div>
      )}

      <div>
        <Label
          htmlFor="body"
          className="text-xs font-black uppercase tracking-widest text-muted-foreground"
        >
          {/* Same input is reused across all three post kinds:
              recap "Recap", highlight "Description", org "Update". */}
          {isShort ? "Description" : isOrgPost ? "Update" : "Recap"}
        </Label>
        <Textarea
          id="body"
          value={body}
          onChange={(e) => onBodyChange(e.target.value)}
          placeholder={
            isShort
              ? "Add a caption for this clip…"
              : isOrgPost
                ? "Share an update with the organization…"
                : "Tell the story of the game…"
          }
          className={`mt-2 ${isShort ? "min-h-[120px]" : "min-h-[260px]"}`}
          data-testid="input-body"
        />
      </div>


      <MediaSection
        photos={photos}
        onPhotosChange={onPhotosChange}
        videoUrl={videoUrl}
        onVideoUrlChange={onVideoUrlChange}
      />

      {!draftId && !lockedToTeam && !isOrgPost && myOrgs && myOrgs.data.length > 0 && (
        <div>
          <Label className="text-xs font-black uppercase tracking-widest text-muted-foreground">
            Post On Behalf Of
          </Label>
          <Select value={orgId} onValueChange={onOrgIdChange}>
            <SelectTrigger className="mt-2">
              <SelectValue placeholder="My profile" />
            </SelectTrigger>
            <SelectContent>
              {myOrgs.data.map((org) => (
                <SelectItem key={org.id} value={org.id}>
                  {org.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {!isShort && !isOrgPost && (
        <div className="pt-4 border-t border-border">
          <label
            htmlFor="tag-roster"
            className="flex items-start gap-3 cursor-pointer"
          >
            <Checkbox
              id="tag-roster"
              checked={tagRoster}
              onCheckedChange={(v) => onTagRosterChange(v === true)}
              className="mt-0.5"
              data-testid="checkbox-tag-roster"
            />
            <span className="text-sm">
              <span className="font-bold">
                Tag every rostered player on this team
              </span>
              <span className="block mt-1 text-[12px] text-muted-foreground font-semibold">
                The recap will appear on each rostered player's profile.
                Uncheck to publish as a regular long-form post with no player
                tags.
              </span>
            </span>
          </label>
        </div>
      )}

      <div className="pt-4 border-t border-border flex items-center justify-end gap-2">
        {!isShort && !isEditingPublished && (
          <Button
            type="button"
            variant="outline"
            onClick={onSaveDraft}
            disabled={saving}
            className="font-bold rounded-full"
            data-testid="button-save-draft-bottom"
          >
            <Save className="w-4 h-4 mr-1.5" />
            {saving ? "Saving…" : "Save Draft"}
          </Button>
        )}
        <Button
          type="submit"
          variant="brand"
          disabled={publishing}
          data-testid="button-publish-bottom"
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
    </form>
  );
}
