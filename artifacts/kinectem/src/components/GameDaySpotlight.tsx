import { useState } from "react";
import { ArrowUpRight, Sparkles } from "lucide-react";
import { Link } from "wouter";
import {
  queryOpts,
  useGetOrganizationById,
  useGetTeamById,
  type FeedPost,
} from "@workspace/api-client-react";
import { BlurFillImage } from "@/components/BlurFillImage";
import { Button } from "@/components/ui/button";
import { featuredRecapPreviewText } from "@/lib/featuredRecapPreview";

export function GameDaySpotlight({ post }: { post: FeedPost }) {
  const [failedBanner, setFailedBanner] = useState(false);
  const [failedLogo, setFailedLogo] = useState(false);
  const image = post.assets.find((asset) => asset.fileType?.startsWith("image/") && asset.url);
  const teamId = !image && post.context.type === "team" ? post.context.id : "";
  const { data: team, isError: teamError } = useGetTeamById(teamId, {
    query: queryOpts({ enabled: !!teamId }),
  });
  const orgId = !image
    ? post.context.type === "team"
      ? post.context.orgId ?? team?.organization?.id ?? ""
      : post.context.type === "organization" ? post.context.id : ""
    : "";
  const { data: org } = useGetOrganizationById(orgId, {
    query: queryOpts({ enabled: !!orgId && (!teamId || !!team || teamError) }),
  });

  const bannerUrl = !failedBanner ? team?.bannerUrl : null;
  const logoUrl = !bannerUrl && !failedLogo ? org?.logoUrl : null;
  const fallbackUrl = bannerUrl || logoUrl;
  const previewText = post.postType === "long"
    ? featuredRecapPreviewText({
        body: post.body ?? null,
        summary: post.description ?? null,
      })
    : post.description || post.body;

  return (
    <article className="game-day-lead">
      <div className={`game-day-lead-image${!image && fallbackUrl ? " game-day-lead-image-fallback" : ""}${logoUrl ? " game-day-lead-image-logo" : ""}${!image && !fallbackUrl ? " game-day-lead-image-empty" : ""}`}>
        {image ? (
          <img src={image.url} alt="" />
        ) : fallbackUrl ? (
          <div className="game-day-fallback-image" onErrorCapture={() => {
            if (bannerUrl) setFailedBanner(true);
            else setFailedLogo(true);
          }}>
            <BlurFillImage
              src={fallbackUrl}
              alt={bannerUrl
                ? `${team?.name ?? post.context.name ?? "Team"} photo`
                : `${org?.name ?? post.context.orgName ?? post.context.name ?? "Organization"} logo`}
            />
          </div>
        ) : (
          <Sparkles size={48} aria-hidden="true" />
        )}
        <span className="game-day-lead-tag">{post.postType === "long" ? "Spotlight recap" : "Community post"}</span>
      </div>
      <div className="game-day-lead-copy">
        <div className="game-day-lead-attribution">
          {post.context.type === "team" && post.context.orgName && (
            <div className="game-day-lead-org-name" data-testid="text-spotlight-organization">
              {post.context.orgId ? (
                <Link href={`/organizations/${post.context.orgId}`}>{post.context.orgName}</Link>
              ) : (
                <strong>{post.context.orgName}</strong>
              )}
            </div>
          )}
          {post.context.type === "team" && (
            <Link href={`/teams/${post.context.id}`} className="game-day-lead-team-name" data-testid="link-spotlight-team">
              {post.context.name || "View team"}
            </Link>
          )}
          {post.context.type === "organization" && (
            <Link href={`/organizations/${post.context.id}`} className="game-day-lead-org-name">{post.context.name || "View organization"}</Link>
          )}
          <span className="game-day-lead-byline">By {post.author.displayName}</span>
        </div>
        <h2>{post.title || "A moment worth sharing"}</h2>
        <p className="line-clamp-4" data-testid="text-spotlight-preview">
          {previewText || "Catch up with the latest from your community."}
        </p>
        <div className="game-day-lead-footer">
          <span className="text-xs text-muted-foreground">From your teams</span>
          <Link href={`/posts/${post.id}`}><Button size="sm" className="gap-1">Read story <ArrowUpRight size={14} /></Button></Link>
        </div>
      </div>
    </article>
  );
}