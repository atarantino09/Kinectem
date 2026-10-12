import { Link } from "wouter";

export function TeamSetupContext({ teamName, organizationName }: { teamName?: string; organizationName?: string | null }) {
  return (
    <section className="min-w-0 rounded-lg border border-violet-200 bg-violet-50 p-3 text-sm text-slate-900 [overflow-wrap:anywhere]" aria-label="Invited team" data-testid="team-setup-context">
      {teamName ? (
        <>
          <p>You are adding a child to <strong>{teamName}</strong>. Only add children who play on this team.</p>
          {organizationName && <p className="mt-1 text-xs text-slate-700">Organization: {organizationName}</p>}
        </>
      ) : <p>The invited team has not been verified yet. Check the invitation’s team details before adding a child.</p>}
    </section>
  );
}

export function OtherTeamGuidance() {
  return (
    <aside className="rounded-lg border border-border bg-muted/30 p-3 text-xs leading-5 [overflow-wrap:anywhere]" aria-label="Children on other teams" data-testid="other-team-guidance">
      <p className="font-bold">Child on another team?</p>
      <p>Finish or leave this setup, open that other team’s invitation, and sign in with the same parent account. Select that child’s existing profile if already created, or create it there if new. The child will join the team named on that invitation. Don’t create a second parent account or another profile for the same child.</p>
      <p className="mt-2">All children added through your account stay linked to you and appear together in Family, even on different teams. Another parent needs a family invitation and must accept it to access a child; access is not automatic.</p>
      <Link href="/family?help=duplicate-child" className="mt-2 inline-block font-semibold text-primary underline">Already created a duplicate child?</Link>
    </aside>
  );
}
