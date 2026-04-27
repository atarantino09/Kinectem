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
import { FileText, Play, Save } from "lucide-react";
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
  saving,
  publishing,
  onSaveDraft,
  onSubmit,
}: PostFormFieldsProps) {
  const isShort = postType === "short";
  return (
    <form id="new-post-form" onSubmit={onSubmit} className="space-y-5">
      {!draftId && !lockedToTeam && (
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

      {!isShort && (
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

      {!isShort && (
        <div>
          <Label
            htmlFor="body"
            className="text-xs font-black uppercase tracking-widest text-muted-foreground"
          >
            Recap
          </Label>
          <Textarea
            id="body"
            value={body}
            onChange={(e) => onBodyChange(e.target.value)}
            placeholder="Tell the story of the game..."
            className="mt-2 min-h-[260px]"
            data-testid="input-body"
          />
        </div>
      )}

      <MediaSection
        photos={photos}
        onPhotosChange={onPhotosChange}
        videoUrl={videoUrl}
        onVideoUrlChange={onVideoUrlChange}
      />

      {!draftId && !lockedToTeam && myOrgs && myOrgs.data.length > 0 && (
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

      {!isShort && (
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
          disabled={publishing}
          className="font-bold rounded-full"
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
