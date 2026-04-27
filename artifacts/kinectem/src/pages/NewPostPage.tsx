import { useSearch } from "wouter";
import {
  useGetLoggedInUser,
  useListUserOrganizations,
  queryOpts,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { FileText, Play } from "lucide-react";
import { CoAuthorsSection } from "@/components/new-post/CoAuthorsSection";
import { PostHeaderBar } from "@/components/new-post/PostHeaderBar";
import { PostFormFields } from "@/components/new-post/PostFormFields";
import { useNewPostForm } from "@/components/new-post/useNewPostForm";

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

  const form = useNewPostForm({
    initialType,
    initialDraftId,
    initialEditId,
    initialTeamId,
  });

  const { data: me } = useGetLoggedInUser();
  const { data: myOrgs } = useListUserOrganizations(me?.id ?? "", undefined, {
    query: queryOpts({ enabled: !!me?.id && !initialTeamId }),
  });

  const heading = form.isShort ? "New Highlight" : "New Game Recap";
  const Icon = form.isShort ? Play : FileText;

  return (
    <div className="min-h-screen bg-background">
      <PostHeaderBar
        Icon={Icon}
        heading={heading}
        isShort={form.isShort}
        isEditingPublished={form.isEditingPublished}
        draftId={form.draftId}
        saving={form.saving}
        publishing={form.publishing}
        savedAt={form.savedAt}
        onCancel={() => form.setLocation(form.cancelTo)}
        onSaveDraft={form.onSaveDraft}
      />

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
              saving={form.saving}
              publishing={form.publishing}
              onSaveDraft={form.onSaveDraft}
              onSubmit={form.onPublish}
            />
          </CardContent>
        </Card>

        {(form.draftId || form.editId) && (
          <CoAuthorsSection
            postId={(form.draftId ?? form.editId)!}
            myId={me?.id ?? ""}
          />
        )}
      </main>
    </div>
  );
}
