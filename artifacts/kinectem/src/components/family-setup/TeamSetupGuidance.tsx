import { Link } from "wouter";

export function TeamSetupContext({ teamName, organizationName }: { teamName?: string; organizationName?: string | null }) {
  return (
    <section className="min-w-0 rounded-lg border border-amber-300 border-l-4 bg-amber-50 p-3 text-sm text-red-700 [overflow-wrap:anywhere]" aria-label="Invited team" data-testid="team-setup-context">
      {teamName ? (
        <>
          <p className="font-semibold">You are adding a child to <strong className="font-extrabold">{teamName}</strong>. <span className="font-extrabold">Only add children who play on this team.</span></p>
          {organizationName && <p className="mt-1 text-xs text-amber-800">Organization: {organizationName}</p>}
        </>
      ) : <p>The invited team has not been verified yet. Check the invitation’s team details before adding a child.</p>}
    </section>
  );
}

export function OtherTeamGuidance({ setupComplete = false }: { setupComplete?: boolean } = {}) {
  return (
    <aside className="rounded-lg border border-border bg-muted/30 p-3 text-sm leading-5 [overflow-wrap:anywhere]" aria-label="Children on other teams" data-testid="other-team-guidance">
      <p className="font-bold">Adding a child to another team?</p>
      <ol className="mt-2 list-decimal space-y-2 pl-5">
        <li>{setupComplete ? <>Tap <strong>Done</strong> below, then open the other team’s invitation.</> : <>Finish adding your child to this team, then open the other team’s invitation.</>}</li>
        <li>Sign in with your <strong>same parent account</strong>. No new parent account needed.</li>
        <li>Choose your child’s existing account, or create one for a different child you haven’t added yet.</li>
      </ol>
      <div className="mt-3 space-y-2 border-t border-border pt-3 text-xs">
        <p>All your children appear together in <strong>Family</strong>, even on different teams.</p>
        <p>The other parent must accept a family invitation before they can see that child in their account.</p>
      </div>
      <Link href="/family?help=duplicate-child" className="mt-2 inline-block font-semibold text-primary underline">Already created a duplicate child?</Link>
    </aside>
  );
}
