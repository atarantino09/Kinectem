import { NumericBadge } from "@/components/ui/numeric-badge";

const steps = [
  {
    title: "Add your own competition photos",
    text: "Use Add photos to select or drag in up to 100 photos at a time. Check the previews, remove any you do not want, and optionally tag participating teams before uploading. Large phone photos are compressed, progress is shown for each file, and failed files can be retried without duplicating successful uploads. Your competition-admin uploads are approved immediately.",
  },
  {
    title: "Choose whether teams can contribute",
    text: "Team contributions are on by default, so eligible members, active guardians, team staff, and organization admins of linked participating teams can submit without waiting for you to enable uploads. Every team submission still requires your approval before it appears in the album or on team pages. Followers, spectators, pending invitees, and unrelated teams cannot upload. Contributors can suggest tags for eligible teams they belong to. You can turn off Let participating teams contribute photos at any time to stop new team submissions.",
  },
  {
    title: "Receive a submission alert",
    text: "When a team contributor finishes an upload batch, competition administrators receive one bell alert and an email notification for that batch—not one per photo. Email delivery follows each recipient’s notification settings. The alert opens Pending review directly. Contributors see Pending approval in their own My submissions view; submitting does not publish their photos.",
  },
  {
    title: "Review and approve in bulk",
    text: "Open Pending review and filter by uploader, upload batch, or team. Open a photo for a larger preview, select individual photos or all visible photos, adjust Team tags, then Approve or Reject the selection. Pending and rejected photos stay private to the uploader and authorized reviewers. Rejected photos appear under Not approved rather than being treated as upload failures, and can be approved later.",
  },
  {
    title: "Share approved photos with the right teams",
    text: "Approved photos appear in this competition’s album. A photo can be tagged to more than one linked participating team; it then also appears in the Competition Photos gallery on each tagged team’s page, with a link back to this album. Untagged photos stay in the competition album only. A small competition logo or name badge stays visible on gallery tiles and full-screen views, including on team pages.",
  },
  {
    title: "Stay in control after publication",
    text: "Use Manage approved photos to change team tags or withdraw approval. Removing a team tag removes that photo from that team’s gallery; withdrawing approval or deleting a photo removes it from the approved album and all tagged team galleries. Turning team contributions off blocks new team uploads without removing existing photos or automatically approving pending submissions. Your own admin uploads remain available.",
  },
];

export function AlbumAdminGuide() {
  return (
    <aside className="rounded-xl border bg-muted/20 p-4" data-testid="guide-competition-photos">
      <h3 className="text-base font-black">How your competition photo album works</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        One shared album for your competition, with optional team submissions and approval controlled by you.
        This guide is only shown to competition administrators.
      </p>
      <ol className="mt-4 grid gap-4 md:grid-cols-2">
        {steps.map((step, index) => (
          <li key={step.title} className="flex min-w-0 items-start gap-2.5">
            <NumericBadge size={24} aria-hidden="true" className="bg-foreground/10 text-xs font-black">
              {index + 1}
            </NumericBadge>
            <div className="min-w-0">
              <h4 className="text-sm font-bold">{step.title}</h4>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{step.text}</p>
            </div>
          </li>
        ))}
      </ol>
    </aside>
  );
}