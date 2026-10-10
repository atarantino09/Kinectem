import { useEffect, useState } from "react";
import { Link } from "wouter";
import { formatOrgName } from "@/lib/format";
import { FitText } from "@/components/FitText";
import { orgInitials, type RecapOrgIdentity } from "@/lib/recapOrgBrand";

/** Prominent organization identity for published game recaps (cards + page). */
export function RecapOrgBanner({
  org,
  postId,
  size = "card",
  linked = true,
}: {
  org: RecapOrgIdentity;
  postId: string;
  size?: "card" | "page";
  linked?: boolean;
}) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [org.logoUrl]);
  const big = size === "page";
  const box = big ? "h-16 w-16" : "h-12 w-12";
  const name = formatOrgName(org.orgName);
  const inner = (
    <>
      {org.logoUrl && !broken ? (
        <img
          src={org.logoUrl}
          alt={`${org.orgName} logo`}
          loading="lazy"
          onError={() => setBroken(true)}
          className={`${box} shrink-0 rounded-xl bg-white object-contain p-1.5 shadow-sm`}
          data-testid={`img-recap-org-logo-${postId}`}
        />
      ) : (
        <span
          className={`${box} flex shrink-0 items-center justify-center rounded-xl bg-white text-lg font-black text-slate-800 shadow-sm`}
          aria-hidden="true"
          data-testid={`fallback-recap-org-logo-${postId}`}
        >
          {orgInitials(org.orgName)}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-bold uppercase tracking-widest">Organization</p>
        <FitText
          as="p"
          max={big ? 22 : 16}
          min={13}
          lineHeight={1.2}
          className="font-black"
          data-testid={`text-recap-org-name-${postId}`}
        >
          {name}
        </FitText>
      </div>
    </>
  );
  const cls = `flex min-w-0 items-center gap-3 ${big ? "px-5 py-4 rounded-xl" : "px-5 py-3"}`;
  const style = { ...org.style, borderBottom: `4px solid ${org.accent}` };
  return linked ? (
    <Link
      href={`/organizations/${org.orgId}`}
      className={cls}
      style={style}
      data-testid={`banner-recap-org-${postId}`}
    >
      {inner}
    </Link>
  ) : (
    <div className={cls} style={style} data-testid={`banner-recap-org-${postId}`}>
      {inner}
    </div>
  );
}
