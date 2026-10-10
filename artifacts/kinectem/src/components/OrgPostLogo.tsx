import { useEffect, useState } from "react";
import { orgInitials, type RecapOrgIdentity } from "@/lib/recapOrgBrand";

/** The organization's own logo, never a team or platform-logo substitute. */
export function OrgPostLogo({ org, postId }: { org: RecapOrgIdentity; postId: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [org.logoUrl]);
  return org.logoUrl && !failed ? (
    <img
      src={org.logoUrl}
      alt={`${org.orgName} logo`}
      loading="lazy"
      onError={() => setFailed(true)}
      className="h-12 w-12 shrink-0 rounded-lg bg-white object-contain p-1 shadow-sm"
      data-testid={`img-recap-org-logo-${postId}`}
    />
  ) : (
    <span
      className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-white text-base font-bold text-slate-800"
      aria-label={`${org.orgName} logo placeholder`}
      data-testid={`fallback-recap-org-logo-${postId}`}
    >
      {orgInitials(org.orgName)}
    </span>
  );
}
