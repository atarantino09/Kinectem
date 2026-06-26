import type { PaginatedUserTeamMembershipsResponse } from "@workspace/api-client-react";
import { formatOrgName } from "@/lib/format";
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
import { Link } from "wouter";
import { TeamAvatar, UserAvatar } from "@/components/UserAvatar";
import { MediaSection } from "./MediaSection";
import { AiAssistButton } from "./AiAssistButton";
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
  // "Posted in" section data (task #465). Only the edit-published
  // path passes these; create / draft sessions leave them undefined
  // so the section is hidden. Team fields are null for org Updates.
  loadedTeamId?: string | null;
  loadedTeamName?: string | null;
  loadedTeamSlug?: string | null;
  loadedTeamAvatarUrl?: string | null;
  loadedOrgId?: string | null;
  loadedOrgName?: string | null;
  loadedOrgSlug?: string | null;
  loadedOrgAvatarUrl?: string | null;
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
  loadedTeamId = null,
  loadedTeamName = null,
  loadedTeamSlug = null,
  loadedTeamAvatarUrl = null,
  loadedOrgId = null,
  loadedOrgName = null,
  loadedOrgSlug = null,
  loadedOrgAvatarUrl = null,
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
  // Best-effort team name for AI Assist context: the loaded post's team
  // (edit path) or the currently-selected team in the composer.
  const aiTeamName =
    loadedTeamName ??
    myTeams?.data.find((m) => m.teamId === teamId)?.teamName ??
    null;
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

      {isEditingPublished && (loadedTeamId || loadedOrgId) && (
        // Task #465 — surface the team and parent org as clickable
        // links so the author can jump back to the team / org page
        // from the editor. Hidden on draft / brand-new composer
        // sessions (no published context). Org Updates show only
        // the org row.
        <div data-testid="section-edit-post-posted-in">
          <Label className="text-xs font-black uppercase tracking-widest text-muted-foreground">
            Posted in
          </Label>
          <div className="mt-2 space-y-1.5">
            {loadedTeamId && (
              <Link
                href={`/teams/${loadedTeamSlug || loadedTeamId}`}
                className="flex items-center gap-2 text-sm hover:underline"
                data-testid="link-edit-post-team"
              >
                <TeamAvatar
                  avatarUrl={loadedTeamAvatarUrl ?? loadedOrgAvatarUrl ?? null}
                  displayName={loadedTeamName ?? "Team"}
                  size="sm"
                  className="shrink-0"
                  fallbackClassName="bg-slate-900 text-primary-foreground font-black"
                />
                <span className="font-semibold truncate">
                  {loadedTeamName ?? "Team"}
                </span>
              </Link>
            )}
            {loadedOrgId && (
              <Link
                href={`/organizations/${loadedOrgSlug || loadedOrgId}`}
                className="flex items-center gap-2 text-sm hover:underline"
                data-testid="link-edit-post-org"
              >
                <TeamAvatar
                  avatarUrl={loadedOrgAvatarUrl ?? null}
                  displayName={loadedOrgName ?? "Organization"}
                  size="sm"
                  className="shrink-0"
                  fallbackClassName="bg-slate-900 text-primary-foreground font-black"
                />
                <span className="font-semibold truncate">
                  {loadedOrgName ?? "Organization"}
                </span>
              </Link>
            )}
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
        <div className="flex items-center justify-between gap-2">
          <Label
            htmlFor="body"
            className="text-xs font-black uppercase tracking-widest text-muted-foreground"
          >
            {/* Same input is reused across all three post kinds:
                recap "Recap", highlight "Description", org "Update". */}
            {isShort ? "Description" : isOrgPost ? "Update" : "Recap"}
          </Label>
          <AiAssistButton
            postType={postType}
            title={title}
            body={body}
            gameDate={gameDate}
            teamName={aiTeamName}
            onInsert={onBodyChange}
          />
        </div>
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

      {/* Task #510 — for short posts the picker always renders (even
          when the user has zero authorable teams) so "Just my profile"
          is always reachable. For recaps it stays gated on having at
          least one authorable team. */}
      {!draftId && !lockedToTeam && !isOrgPost && !isEditingPublished && myTeams && (isShort || myTeams.data.length > 0) && (
        <div>
          <Label className="text-xs font-black uppercase tracking-widest text-muted-foreground">
            {isShort ? "Post to" : "Post to Team"}
          </Label>
          <Select value={teamId} onValueChange={onTeamIdChange}>
            <SelectTrigger
              className="mt-2"
              data-testid="select-post-to-team"
            >
              <SelectValue placeholder={isShort ? "Pick a destination" : "Pick a team"} />
            </SelectTrigger>
            <SelectContent>
              {isShort && (
                <SelectItem
                  value="__profile__"
                  data-testid="option-post-to-profile"
                >
                  <div className="flex flex-col items-start">
                    <span className="font-semibold">Just my profile</span>
                    <span className="text-[11px] text-muted-foreground">
                      Visible on your profile and to your followers
                    </span>
                  </div>
                </SelectItem>
              )}
              {myTeams.data.map((m) => (
                <SelectItem
                  key={m.teamId}
                  value={m.teamId}
                  data-testid={`option-post-to-team-${m.teamId}`}
                >
                  <div className="flex flex-col items-start">
                    <span className="font-semibold">{m.teamName}</span>
                    <span className="text-[11px] text-muted-foreground">
                      {m.organization
                        ? formatOrgName(m.organization.name)
                        : "Independent team"}
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
      {/* Task #510 — short posts have the "Just my profile" fallback,
          so the zero-authorable-teams empty-state is recap-only. */}
      {!draftId && !lockedToTeam && !isOrgPost && !isEditingPublished && !isShort && myTeams && myTeams.data.length === 0 && (
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
