import { useEffect, useRef, useState } from "react";

export function DuplicateChildHelp({ initiallyOpen = false }: { initiallyOpen?: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (initiallyOpen) {
      setOpen(true);
      ref.current?.scrollIntoView({ block: "start" });
    }
  }, [initiallyOpen]);
  return (
    <details ref={ref} open={open} onToggle={(event) => setOpen(event.currentTarget.open)} className="min-w-0 scroll-mt-4 rounded-xl border border-border p-4 text-sm [overflow-wrap:anywhere]" data-testid="duplicate-child-help">
      <summary className="cursor-pointer font-bold">Already created a duplicate child?</summary>
      <div className="mt-3 space-y-3 leading-6">
        <p>First identify the correct profile to keep. Check each profile’s teams and content, and coordinate with the other parent so you both keep the same child profile. No content, memberships, or consent history is merged or transferred automatically.</p>
        <p>Request deletion only for the duplicate: <strong>Family → that child → Communication controls → Delete account</strong>. Check the child’s identity before confirming.</p>
        <p><strong>Delete account is account-wide:</strong> it affects that profile across all teams and all parents. The account is locked immediately when the request is accepted. Permanent deletion is handled after the existing 30-day cooling-off period; the request does not instantly remove roster entries, and an automatic purge on day 30 is not guaranteed.</p>
        <p><strong>Unlink</strong> removes your guardian connection, not the child’s account. Removing a child from one team only changes that team’s membership, not their account or family connections. Neither action deletes a duplicate profile.</p>
        <p>If you’re unsure which profile to keep or cannot access it, contact <a href="mailto:privacy@kinectem.com" className="font-semibold text-primary underline">Kinectem privacy support</a> before taking action. Don’t unlink the last guardian or create more profiles to resolve the problem.</p>
      </div>
    </details>
  );
}
