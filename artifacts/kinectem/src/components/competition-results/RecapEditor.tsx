import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { api, storyHref, useInvalidateResults, type ManagedRecap } from "@/lib/competition-results";
import { errMsg } from "./ResultsUiHelpers";

export function RecapEditor({
  cid,
  recap,
  label,
  onDirty,
  disabled = false,
}: {
  cid: string;
  recap: ManagedRecap;
  label: string;
  onDirty: (id: string, dirty: boolean) => void;
  disabled?: boolean;
}) {
  const [title, setTitle] = useState(recap.draft.title);
  const [body, setBody] = useState(recap.draft.body);
  const [baseDraft, setBaseDraft] = useState(recap.draft);
  const [baseRevision, setBaseRevision] = useState(recap.revision);
  const [confirmAct, setConfirmAct] = useState<"unpublish" | "delete" | "reload" | null>(null);
  const invalidate = useInvalidateResults(cid);
  const { toast } = useToast();
  const dirty = title !== baseDraft.title || body !== baseDraft.body;
  const stale = recap.revision > baseRevision;
  const onDirtyRef = useRef(onDirty);
  onDirtyRef.current = onDirty;
  useEffect(() => {
    onDirtyRef.current(recap.id, dirty);
    return () => onDirtyRef.current(recap.id, false);
  }, [dirty, recap.id]);
  // Adopt server copy only when the saved revision changes and nothing is unsaved.
  const adopt = (saved: ManagedRecap) => {
    setBaseRevision(saved.revision);
    setBaseDraft(saved.draft);
    setTitle(saved.draft.title);
    setBody(saved.draft.body);
  };
  useEffect(() => {
    if (recap.revision > baseRevision && !dirty) adopt(recap);
  }, [recap.revision, baseRevision, dirty, recap.draft.title, recap.draft.body]);

  const onOk = (t: string) => () => {
    invalidate();
    setConfirmAct(null);
    toast({ title: t });
  };
  const onErr = (e: unknown) =>
    toast({ title: "Action failed", description: errMsg(e), variant: "destructive" });
  const save = useMutation({
    mutationFn: () => api.saveRecap(cid, recap.id, { title, body, expectedRevision: baseRevision }),
    onSuccess: (saved) => { adopt(saved); onOk("Draft saved")(); },
    onError: onErr,
  });
  const publish = useMutation({
    mutationFn: () => api.publish(cid, recap.id, baseRevision),
    onSuccess: onOk("Recap published"),
    onError: onErr,
  });
  const unpublish = useMutation({
    mutationFn: () => api.unpublish(cid, recap.id, baseRevision),
    onSuccess: onOk("Recap unpublished"),
    onError: onErr,
  });
  const del = useMutation({
    mutationFn: () => api.remove(cid, recap.id, baseRevision),
    onSuccess: onOk("Recap deleted"),
    onError: onErr,
  });
  const busy = disabled || save.isPending || publish.isPending || unpublish.isPending || del.isPending;
  const isLive = !!recap.published;
  const unpublishedChanges =
    isLive && (recap.published?.title !== recap.draft.title || recap.published?.body !== recap.draft.body);

  return (
    <div className="space-y-3 rounded-xl border border-border p-4" data-testid={`recap-${recap.id}`}>
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-sm font-black">{label}</h4>
        <Badge variant="outline" data-testid={`badge-recap-state-${recap.id}`}>
          {isLive ? "published" : "draft"}
        </Badge>
        {recap.draft.partial ? <Badge className="bg-amber-100 text-amber-900">partial results</Badge> : null}
        {dirty ? <Badge className="bg-amber-100 text-amber-900">unsaved edits</Badge> : null}
        {unpublishedChanges && !dirty ? <Badge variant="outline">draft differs from published</Badge> : null}
        {isLive ? (
          <Link href={storyHref(recap.id)} className="ml-auto text-xs font-bold underline">
            View public story
          </Link>
        ) : null}
      </div>
      <Input value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Recap title" data-testid={`input-recap-title-${recap.id}`} />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={8}
        aria-label="Recap body"
        className="w-full rounded-lg border border-border bg-background p-3 text-sm"
        data-testid={`input-recap-body-${recap.id}`}
      />
      <p className="text-xs text-muted-foreground">
        Based on {recap.draft.sourceUrl ?? "organizer-reviewed results"}
        {recap.draft.resultsAsOf ? ` as of ${recap.draft.resultsAsOf}` : ""}.
      </p>
      {stale && dirty ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" data-testid="recap-edit-conflict">
          Another saved revision is available. Your unsaved text is still here; copy it before loading the latest draft.
          <Button variant="outline" size="sm" className="mt-2" onClick={() => setConfirmAct("reload")}>Load latest draft</Button>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={!dirty || stale || !title.trim() || !body.trim() || busy} onClick={() => save.mutate()} data-testid={`btn-save-recap-${recap.id}`}>
          Save draft
        </Button>
        <Button
          variant="brand"
          disabled={dirty || stale || busy || (isLive && !unpublishedChanges)}
          onClick={() => publish.mutate()}
          title={dirty ? "Save your edits before publishing" : undefined}
          data-testid={`btn-publish-recap-${recap.id}`}
        >
          {isLive ? "Publish update" : "Publish"}
        </Button>
        {isLive ? (
          <Button variant="outline" disabled={busy} onClick={() => setConfirmAct("unpublish")} data-testid={`btn-unpublish-recap-${recap.id}`}>
            Unpublish
          </Button>
        ) : null}
        <Button
          variant="outline"
          className="border-destructive/50 text-destructive"
          disabled={busy}
          onClick={() => setConfirmAct("delete")}
          data-testid={`btn-delete-recap-${recap.id}`}
        >
          Delete
        </Button>
      </div>
      <AlertDialog open={confirmAct !== null} onOpenChange={(o) => !o && setConfirmAct(null)}>
        <AlertDialogContent data-testid="dialog-recap-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmAct === "reload" ? "Discard unsaved edits and load the latest draft?" : confirmAct === "delete" ? "Delete this recap?" : "Unpublish this recap?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmAct === "reload" ? "Copy any text you want to keep first. This replaces your unsaved editor text with the latest saved draft." : confirmAct === "delete"
                ? "The draft and any published story are removed. Team placements of it disappear."
                : "The public story stops being readable and leaves the competition page and team pages. The draft stays."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (confirmAct === "reload") { adopt(recap); setConfirmAct(null); }
                else if (confirmAct === "delete") del.mutate();
                else unpublish.mutate();
              }}
              data-testid="btn-confirm-recap-action"
            >
              {confirmAct === "reload" ? "Discard and load" : confirmAct === "delete" ? "Delete recap" : "Unpublish"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
