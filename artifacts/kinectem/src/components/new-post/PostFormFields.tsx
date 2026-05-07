import type { PaginatedUserTeamMembershipsResponse } from "@workspace/api-client-react";
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
import { FileText, Info, Play, Save, X } from "lucide-react";
import { UserAvatar } from "@/components/UserAvatar";
import { MediaSection } from "./MediaSection";
import {
  RosterTagPicker,
  type RosterPickerMember,
} from "./RosterTagPicker";

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
  teamId: string;
  onTeamIdChange: (v: string) => void;
  myTeams: PaginatedUserTeamMembershipsResponse | undefined;
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
  // Highlight composer only — roster picker state. Pass `members:
  // []` and `loading: true` while the parent fetches the roster.
  // The picker hides itself when there's no team scope (`teamId`
  // is null) so highlights posted from /new without a team don't
  // surface a useless dropdown.
  rosterTagTeamId?: string | null;
  rosterMembers?: RosterPickerMember[];
  rosterLoading?: boolean;
  taggedUserIds?: string[];
  onTaggedUserIdsChange?: (next: string[]) => void;
  saving: boolean;
  publishing: boolean;
  // True when the form should refuse submission because the user has
  // no team to post to. Disables the bottom Post button so the user
  // can't trigger a guaranteed-400 round-trip; the header bar gets
  // the same flag through PostHeaderBar.
  publishDisabled?: boolean;
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
  teamId,
  onTeamIdChange,
  myTeams,
  draftId,
  lockedToTeam,
  isEditingPublished,
  loadedKind = null,
  canDelete = false,
  rosterTagTeamId = null,
  rosterMembers = [],
  rosterLoading = false,
  taggedUserIds = [],
  onTaggedUserIdsChange,
  saving,
  publishing,
  publishDisabled = false,
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

      {!draftId && !lockedToTeam && !isOrgPost && !isEditingPublished && myTeams && myTeams.data.length > 0 && (
        <div>
          <Label className="text-xs font-black uppercase tracking-widest text-muted-foreground">
            Post to Team
          </Label>
          <Select value={teamId} onValueChange={onTeamIdChange}>
            <SelectTrigger
              className="mt-2"
              data-testid="select-post-to-team"
            >
              <SelectValue placeholder="Pick a team" />
            </SelectTrigger>
            <SelectContent>
              {myTeams.data.map((m) => (
                <SelectItem
                  key={m.teamId}
                  value={m.teamId}
                  data-testid={`option-post-to-team-${m.teamId}`}
                >
                  <div className="flex flex-col items-start">
                    <span className="font-semibold">{m.teamName}</span>
                    <span className="text-[11px] text-muted-foreground">
                      {m.organization.name}
                    </span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Zero-authorable-teams guard. Surfaces an explanatory message
          when the picker would otherwise be empty AND the post isn't
          locked to a team via the URL — i.e. the only way the user
          could publish is by picking a team they don't have. Mirrors
          the server-side "Only admins, coaches, and authors can create
          game recaps" guard so the user sees why Publish is disabled
          before clicking. Skipped for highlights without a team scope
          and for the org Update / draft / edit-published paths. */}
      {!draftId && !lockedToTeam && !isOrgPost && !isEditingPublished && myTeams && myTeams.data.length === 0 && (
        <div
          className="flex items-start gap-2 rounded-lg bg-muted/60 border border-border px-3 py-2"
          data-testid="empty-state-no-authorable-teams"
        >
          <Info className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
          <p className="text-xs text-muted-foreground font-medium">
            Only admins, coaches, and authors can create game recaps.
            Ask a coach or organization admin to add you to a team
            before publishing.
          </p>
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

      {(() => {
        // Per-player tag picker. Two paths land here:
        //   - Brand-new highlight composer (task #313): `isShort`
        //     with a team scope.
        //   - Edit-post screen for a published recap or highlight
        //     (task #322): `isEditingPublished` with the loaded post
        //     being an article or highlight and a team scope.
        // The recap CREATE path keeps using only the "Tag every
        // rostered player" checkbox above; the per-player picker
        // shows up on edit so the author can fine-tune individuals
        // alongside the bulk-tag checkbox.
        const showPicker =
          !!rosterTagTeamId &&
          !!onTaggedUserIdsChange &&
          (isShort ||
            (isEditingPublished &&
              (loadedKind === "article" || loadedKind === "highlight")));
        if (!showPicker) return null;
        const memberById = new Map(
          rosterMembers.map((m) => [m.userId, m]),
        );
        // Filter currently-tagged ids down to roster members so a
        // stale tag (player removed from the roster after being
        // tagged) doesn't render with a missing display name. The
        // diff on save still respects whatever is in `taggedUserIds`,
        // so a stale tag isn't accidentally removed just because it
        // doesn't render.
        const visibleTagged = taggedUserIds
          .map((id) => memberById.get(id))
          .filter((m): m is RosterPickerMember => !!m);
        const removeOne = (userId: string) => {
          onTaggedUserIdsChange!(taggedUserIds.filter((id) => id !== userId));
        };
        return (
          <div className="space-y-2">
            <RosterTagPicker
              members={rosterMembers}
              selectedUserIds={taggedUserIds}
              onSelectionChange={onTaggedUserIdsChange!}
              loading={rosterLoading}
            />
            {/* Inline list of currently tagged players — surfaces
                the "untag" affordance without making the user open
                the dropdown. Hidden during the initial roster
                fetch so it doesn't briefly render an empty state.
                Empty-state copy when nothing is tagged points the
                user at the picker above. */}
            {!rosterLoading && rosterMembers.length > 0 && (
              <div data-testid="list-tagged-players">
                {visibleTagged.length === 0 ? (
                  <p
                    className="text-[11px] text-muted-foreground font-semibold"
                    data-testid="empty-tagged-players"
                  >
                    No players tagged yet — use the picker above to
                    add some.
                  </p>
                ) : (
                  <ul className="flex flex-wrap gap-1.5">
                    {visibleTagged.map((m) => (
                      <li
                        key={m.userId}
                        className="inline-flex items-center gap-1.5 rounded-full bg-muted/60 border border-border pl-1.5 pr-1 py-0.5 text-xs"
                        data-testid={`tagged-player-${m.userId}`}
                      >
                        <UserAvatar
                          avatarUrl={m.avatarUrl}
                          displayName={m.displayName}
                          size="xs"
                          fallbackClassName="bg-slate-900 text-primary-foreground"
                        />
                        <span className="font-semibold">
                          {m.displayName}
                        </span>
                        <button
                          type="button"
                          onClick={() => removeOne(m.userId)}
                          className="ml-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground hover:bg-background hover:text-foreground"
                          aria-label={`Remove tag for ${m.displayName}`}
                          data-testid={`button-remove-tagged-${m.userId}`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        );
      })()}

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
          disabled={publishing || publishDisabled}
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
