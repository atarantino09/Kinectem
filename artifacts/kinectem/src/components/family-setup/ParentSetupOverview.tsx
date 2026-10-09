import { AlertTriangle } from "lucide-react";

const steps = [
  { title: "Create your parent account", detail: "Use your own name and details." },
  { title: "Add the other parent", detail: "Enter their name and email, or skip.", optional: true },
  { title: "Create your child’s account", detail: "One child account, shared by both parents." },
];

/** The same plain-language roadmap at both parent entry points. */
export function ParentSetupOverview({ teamName }: { teamName?: string }) {
  return (
    <section className="rounded-xl border border-violet-200 bg-violet-50/80 p-4" aria-label="Family setup steps" data-testid="parent-setup-overview">
      <p className="text-sm font-bold text-slate-950">Set up your family in 3 steps</p>
      {teamName && <p className="mt-1 text-sm text-slate-900">Your child is invited to <strong>{teamName}</strong>.</p>}
      <ol className="mt-3 space-y-3" data-testid="text-parent-steps">
        {steps.map((step, index) => (
          <li key={step.title} className="flex items-start gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-violet-600 text-xs font-bold text-white" aria-hidden="true">{index + 1}</span>
            <div className="min-w-0">
              <p className="text-sm font-semibold leading-5 text-slate-950">
                {step.title}
                {step.optional && <span className="ml-1.5 text-xs font-normal text-violet-700">(optional)</span>}
              </p>
              <p className="text-xs leading-5 text-slate-700">{step.detail}</p>
            </div>
          </li>
        ))}
      </ol>
      <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs leading-5 text-amber-900" data-testid="note-check-other-parent">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <p><strong>Before you start, check with the other parent.</strong> If they already created your child’s account, ask them to send you a family invitation instead of creating your child again.</p>
      </div>
      <p className="mt-3 border-t border-violet-200 pt-3 text-xs leading-5 text-slate-700">
        Step 2 saves the other parent’s name and email. After you finish your child’s account in Step 3, we email the parent you added in Step 2 a family invitation. They sign in or create their own parent account and accept it to connect to the same child. Ask them to wait for that email—not create your child again from the team invite.
      </p>
      {teamName && <p className="mt-2 text-xs font-semibold leading-5 text-violet-900">When you finish setup, your child will automatically be added to {teamName}’s roster.</p>}
    </section>
  );
}
