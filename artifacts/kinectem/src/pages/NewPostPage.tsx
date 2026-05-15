import { useSearch } from "wouter";
import { useEffect, useMemo } from "react";
import {
  useGetLoggedInUser,
  useListTeamMembers,
  useListUserTeams,
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
  // Authorable-teams picker for the composer's "Post to Team" select.
  // Skipped when the URL already locks the post to a specific team
  // (the picker is hidden in that case anyway).
  const { data: myTeams } = useListUserTeams(
    me?.id ?? "",
    { authorable: true },
    {
      query: queryOpts({ enabled: !!me?.id && !initialTeamId }),
    },
  );

  // Auto-pre-select when the user only has one authorable team — the
  // picker would otherwise force a redundant click. Guarded on
  // `form.teamId` so we don't fight a manual selection, and on
  // `!initialTeamId` so URL-locked composers keep their explicit team.
  useEffect(() => {
    if (initialTeamId) return;
    if (form.teamId) return;
    // Task #510 — highlights default to "Just my profile" so a user
    // with one authorable team isn't auto-routed into team scope.
    // The author can still flip the picker to the team if they want.
    if (form.isShort) return;
    const only = myTeams?.data;
    if (only && only.length === 1) {
      form.setTeamId(only[0].teamId);
    }
  }, [myTeams, initialTeamId, form]);

  // Disable Publish when the composer is in "needs a team but has
  // none" territory: a brand-new post that isn't URL-locked to a
  // team, isn't an org Update, isn't an edit / draft, and either the
  // teams list has loaded with zero entries OR the user simply hasn't
  // picked one yet. Drafts and edit-published posts already carry a
  // team via the loaded payload, so they bypass this guard.
  const composerNeedsTeam =
    !initialTeamId && !form.draftId && !form.isEditingPublished;
  // Task #510 — short posts can target the uploader's profile only,
  // so "__profile__" counts as a valid selection. Recaps still
  // require a real team.
  const hasTeamSelection =
    !!form.teamId &&
    (!form.isShort ? form.teamId !== "__profile__" : true);
  const publishDisabled =
    composerNeedsTeam && form.loadedKind !== "org_post" && !hasTeamSelection;

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
    <div className="min-h-screen">
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
        onCancel={form.requestCancel}
        onSaveDraft={form.onSaveDraft}
        canDelete={form.canDelete}
        onRequestDelete={() => form.setConfirmDeleteOpen(true)}
        publishDisabled={publishDisabled}
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

      {/* Task #447 — Confirmation that a non-admin author's recap
          is awaiting org admin approval. Replaces the silent
          "Posted!" toast in the pending_approval branch so authors
          know why the recap isn't yet visible on the team page.
          Dismiss runs the existing post-submit navigation (team
          page or post detail). */}
      <AlertDialog
        open={form.pendingApprovalOpen}
        onOpenChange={(next) => {
          if (!next) form.onDismissPendingApproval();
        }}
      >
        <AlertDialogContent data-testid="dialog-recap-pending-approval">
          <AlertDialogHeader>
            <AlertDialogTitle>Recap submitted for approval</AlertDialogTitle>
            <AlertDialogDescription>
              Thanks! Your game recap was submitted and is now waiting
              for an organization admin to approve it. It won't appear
              on the team page until they do.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction
              onClick={() => form.onDismissPendingApproval()}
              data-testid="button-recap-pending-approval-dismiss"
            >
              Got it
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
              teamId={form.teamId}
              onTeamIdChange={form.setTeamId}
              myTeams={myTeams}
              draftId={form.draftId}
              lockedToTeam={form.lockedToTeam}
              isEditingPublished={form.isEditingPublished}
              loadedKind={form.loadedKind}
              canDelete={form.canDelete}
              rosterTagTeamId={rosterTeamId || null}
              rosterMembers={rosterMembers}
              rosterLoading={rosterLoading}
              loadedTeamId={form.loadedTeamId}
              loadedTeamName={form.loadedTeamName}
              loadedTeamSlug={form.loadedTeamSlug}
              loadedTeamAvatarUrl={form.loadedTeamAvatarUrl}
              loadedOrgId={form.loadedOrgId}
              loadedOrgName={form.loadedOrgName}
              loadedOrgSlug={form.loadedOrgSlug}
              loadedOrgAvatarUrl={form.loadedOrgAvatarUrl}
              taggedUserIds={form.taggedUserIds}
              onTaggedUserIdsChange={form.setTaggedUserIds}
              saving={form.saving}
              publishing={form.publishing}
              publishDisabled={publishDisabled}
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
