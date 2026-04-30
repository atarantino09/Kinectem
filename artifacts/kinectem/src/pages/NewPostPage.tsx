import { useSearch } from "wouter";
import { useMemo } from "react";
import {
  useGetLoggedInUser,
  useListTeamMembers,
  useListUserOrganizations,
  queryOpts,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { FileText, Play } from "lucide-react";
import { CoAuthorsSection } from "@/components/new-post/CoAuthorsSection";
import { PostHeaderBar } from "@/components/new-post/PostHeaderBar";
import { PostFormFields } from "@/components/new-post/PostFormFields";
import { useNewPostForm } from "@/components/new-post/useNewPostForm";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export default function NewPostPage() {
  const search = useSearch();
  const params = new URLSearchParams(search);
  const initialType = params.get("type") === "short" ? "short" : "long";
  const initialDraftId = params.get("draftId");
  // editId is the same shape as draftId (a post id that already
  // exists), but it points at an already-PUBLISHED post and the
  // composer must not re-call /publish on submit. This is the
  // "Edit a published recap" path — used today mainly so a coach
  // can flip the "Tag every rostered player" checkbox after the
  // fact, but it also supports edits to title/body/media/date.
  const initialEditId = params.get("editId");
  const initialTeamId = params.get("teamId");
  const initialFrom = params.get("from");

  const form = useNewPostForm({
    initialType,
    initialDraftId,
    initialEditId,
    initialTeamId,
    initialFrom,
  });

  const { data: me } = useGetLoggedInUser();
  const { data: myOrgs } = useListUserOrganizations(me?.id ?? "", undefined, {
    query: queryOpts({ enabled: !!me?.id && !initialTeamId }),
  });

  // Roster for the per-player Tag Players picker. Originally added
  // for the highlight composer (task #313); task #322 extends the
  // same picker to the edit-post screen for both recaps and
  // highlights so the author can fine-tune who is tagged after
  // publishing. We fetch when:
  //   - this is a brand-new highlight scoped to a team, OR
  //   - we're editing a published recap (article) or highlight that
  //     has a known team scope.
  // Recap creates and unscoped highlights still skip the request.
  // We pass `status` / `position` as hints; the server currently
  // ignores them, so we also filter the response client-side:
  // pending invitees can't accept tags yet (their account may not
  // even be confirmed), and coaches / admins shouldn't appear in a
  // "tag the players who are in the post" picker.
  const isEditingTaggablePost =
    form.isEditingPublished &&
    (form.loadedKind === "article" || form.loadedKind === "highlight");
  const rosterTeamId =
    form.isShort || isEditingTaggablePost ? (form.highlightTeamId ?? "") : "";
  const rosterEnabled = !!rosterTeamId;
  const { data: rosterData, isLoading: rosterLoading } = useListTeamMembers(
    rosterTeamId,
    { status: "active", position: "player", limit: 100 },
    { query: queryOpts({ enabled: rosterEnabled }) },
  );
  const rosterMembers = useMemo(
    () =>
      (rosterData?.data ?? [])
        .filter((m) => m.status === "active" && m.position === "player")
        .map((m) => ({
          userId: m.userId,
          displayName: m.displayName,
          avatarUrl: m.avatarUrl ?? null,
        })),
    [rosterData],
  );

  const heading = form.isShort ? "New Highlight" : "New Game Recap";
  const Icon = form.isShort ? Play : FileText;
  // Centered editor label, kind-aware so highlights and org Updates
  // don't read "Editing Recap". Defaults to "Editing Recap" for the
  // pre-task article path (loadedKind === null falls through too,
  // matching the legacy behavior on the create flow).
  const editingLabel =
    form.loadedKind === "highlight"
      ? "Editing Highlight"
      : form.loadedKind === "org_post"
        ? "Editing Update"
        : "Editing Recap";

  return (
    <div className="min-h-screen bg-background">
      <PostHeaderBar
        Icon={Icon}
        heading={heading}
        editingLabel={editingLabel}
        isShort={form.isShort}
        isEditingPublished={form.isEditingPublished}
        draftId={form.draftId}
        saving={form.saving}
        publishing={form.publishing}
        savedAt={form.savedAt}
        onCancel={() => form.setLocation(form.cancelTo)}
        onSaveDraft={form.onSaveDraft}
        canDelete={form.canDelete}
        onRequestDelete={() => form.setConfirmDeleteOpen(true)}
      />

      <AlertDialog
        open={form.confirmDeleteOpen}
        onOpenChange={form.setConfirmDeleteOpen}
      >
        <AlertDialogContent data-testid="dialog-delete-post-editor-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this post?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the post from feeds, your profile, and any
              team or organization page where it appeared. This can't be
              undone from here.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-delete-post-editor-cancel">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={form.deleting}
              onClick={(e) => {
                e.preventDefault();
                void form.onDelete();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-delete-post-editor-confirm"
            >
              {form.deleting ? "Deleting…" : "Delete post"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <main className="max-w-3xl mx-auto px-4 py-8">
        <Card className="rounded-xl border border-border shadow-sm">
          <CardContent className="p-6">
            <PostFormFields
              postType={form.postType}
              onPostTypeChange={form.setPostType}
              title={form.title}
              onTitleChange={form.setTitle}
              body={form.body}
              onBodyChange={form.setBody}
              gameDate={form.gameDate}
              onGameDateChange={form.setGameDate}
              tagRoster={form.tagRoster}
              onTagRosterChange={form.setTagRoster}
              photos={form.photos}
              onPhotosChange={form.setPhotos}
              videoUrl={form.videoUrl}
              onVideoUrlChange={form.setVideoUrl}
              orgId={form.orgId}
              onOrgIdChange={form.setOrgId}
              myOrgs={myOrgs}
              draftId={form.draftId}
              lockedToTeam={form.lockedToTeam}
              isEditingPublished={form.isEditingPublished}
              loadedKind={form.loadedKind}
              canDelete={form.canDelete}
              rosterTagTeamId={rosterTeamId || null}
              rosterMembers={rosterMembers}
              rosterLoading={rosterLoading}
              taggedUserIds={form.taggedUserIds}
              onTaggedUserIdsChange={form.setTaggedUserIds}
              saving={form.saving}
              publishing={form.publishing}
              onSaveDraft={form.onSaveDraft}
              onSubmit={form.onPublish}
            />
          </CardContent>
        </Card>

        {/* Co-authors are an article-only feature. Drafts are always
            articles; for published edits, only show when the loaded
            post is an article (not a highlight or org Update). */}
        {(form.draftId ||
          (form.editId && form.loadedKind === "article")) && (
          <CoAuthorsSection
            postId={(form.draftId ?? form.editId)!}
            myId={me?.id ?? ""}
          />
        )}
      </main>
    </div>
  );
}
