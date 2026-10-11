import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { AdminLayout } from "@/components/AdminLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ADMIN_POST_PAGE_SIZE,
  ADMIN_POST_TYPES,
  useAdminPosts,
  type AdminPostFilters,
  type AdminPostSort,
  type AdminPostType,
  type AdminPostsResponse,
} from "@/hooks/useAdminPosts";

const SORTS: Array<{ value: AdminPostSort; label: string }> = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "sport", label: "Sport" },
  { value: "location", label: "Location" },
  { value: "organization", label: "Organization" },
  { value: "post_type", label: "Post type" },
];

const selectClass =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const linkClass = "font-medium underline-offset-2 hover:underline focus-visible:underline";

export default function AdminPosts() {
  const [filters, setFilters] = useState<AdminPostFilters>({ sort: "newest" });
  const [page, setPage] = useState(0);
  const { data, isLoading, isError, refetch, isFetching } = useAdminPosts(filters, page);
  useEffect(() => {
    if (data && page > 0 && data.pagination.offset >= data.pagination.totalCount) {
      setPage(Math.max(0, Math.ceil(data.pagination.totalCount / ADMIN_POST_PAGE_SIZE) - 1));
    }
  }, [data, page]);

  const update = (patch: Partial<AdminPostFilters>) => {
    setPage(0);
    setFilters((f) => ({ ...f, ...patch }));
  };

  const hasFilters = !!(filters.q || filters.sport || filters.location || filters.organizationId || filters.postType);
  const hasChanges = hasFilters || (filters.sort ?? "newest") !== "newest";
  const totalCount = data?.pagination.totalCount ?? 0;
  const offset = data?.pagination.offset ?? page * ADMIN_POST_PAGE_SIZE;
  const rows = data?.data ?? [];
  const showingFrom = rows.length === 0 ? 0 : offset + 1;
  const showingTo = rows.length === 0 ? 0 : Math.min(totalCount, offset + rows.length);
  const lastFacets = useRef<AdminPostsResponse["facets"] | undefined>(undefined);
  if (data?.facets) lastFacets.current = data.facets;
  const facets = data?.facets ?? lastFacets.current;
  const postTypes = facets?.postTypes?.length ? facets.postTypes : ADMIN_POST_TYPES;

  return (
    <AdminLayout>
      <h1 className="mb-4 text-2xl font-black">Posts</h1>
      <p className="mb-4 text-sm text-muted-foreground">
        Browse posts from all users, including drafts, pending posts, hidden posts, and private practice plans.
      </p>
      <form
        className="mb-4 grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3"
        onSubmit={(e) => e.preventDefault()}
        aria-label="Post filters"
      >
        <div className="space-y-1 sm:col-span-2 xl:col-span-3">
          <Label htmlFor="posts-q">Search</Label>
          <Input
            id="posts-q"
            type="search"
            placeholder="Search titles, authors, teams or organizations..."
            value={filters.q ?? ""}
            onChange={(e) => update({ q: e.target.value })}
            data-testid="input-post-search"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="posts-sport">Sport</Label>
          <select id="posts-sport" className={selectClass} value={filters.sport ?? ""} onChange={(e) => update({ sport: e.target.value || undefined })} data-testid="select-post-sport">
            <option value="">All sports</option>
            {(facets?.sports ?? []).map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="posts-location">Location</Label>
          <Input
            id="posts-location"
            list="posts-location-options"
            placeholder="Any location"
            value={filters.location ?? ""}
            onChange={(e) => update({ location: e.target.value })}
            data-testid="input-post-location"
          />
          <datalist id="posts-location-options">
            {(facets?.locations ?? []).map((l) => <option key={l} value={l} />)}
          </datalist>
        </div>
        <div className="space-y-1">
          <Label htmlFor="posts-org">Organization</Label>
          <select id="posts-org" className={selectClass} value={filters.organizationId ?? ""} onChange={(e) => update({ organizationId: e.target.value || undefined })} data-testid="select-post-org">
            <option value="">All organizations</option>
            <option value="none">No organization (independent)</option>
            {(facets?.organizations ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="posts-type">Post type</Label>
          <select id="posts-type" className={selectClass} value={filters.postType ?? ""} onChange={(e) => update({ postType: (e.target.value || undefined) as AdminPostType | undefined })} data-testid="select-post-type">
            <option value="">All types</option>
            {postTypes.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="posts-sort">Sort by</Label>
          <select id="posts-sort" className={selectClass} value={filters.sort ?? "newest"} onChange={(e) => update({ sort: e.target.value as AdminPostSort })} data-testid="select-post-sort">
            {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
        <div className="flex items-end">
          <Button type="button" variant="ghost" disabled={!hasChanges} onClick={() => update({ q: undefined, sport: undefined, location: undefined, organizationId: undefined, postType: undefined, sort: "newest" })} data-testid="btn-reset-post-filters">
            Clear filters
          </Button>
        </div>
      </form>

      {isLoading ? (
        <div className="space-y-3" data-testid="posts-loading" role="status" aria-label="Loading posts">
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-24 animate-pulse rounded-xl border bg-muted" />)}
        </div>
      ) : isError ? (
        <div role="alert" className="rounded-xl border p-6 text-center" data-testid="posts-error">
          <p className="mb-3 text-sm">Posts could not be loaded.</p>
          <Button variant="outline" onClick={() => void refetch()} disabled={isFetching} data-testid="btn-retry-posts">Retry</Button>
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border p-6 text-center text-sm text-muted-foreground" data-testid="posts-empty">
          {hasFilters ? "No posts match these filters." : "No posts yet."}
        </div>
      ) : (
        <ul className="space-y-3" data-testid="posts-list">
          {rows.map((p) => (
            <li key={p.id} className="min-w-0 rounded-xl border bg-card p-4 shadow-sm" data-testid={`card-post-${p.id}`}>
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <Badge variant="outline">{ADMIN_POST_TYPES.find((t) => t.value === p.type)?.label ?? p.type}</Badge>
                <Badge variant={p.hidden || p.status === "rejected" ? "destructive" : "secondary"} data-testid={`status-post-${p.id}`}>
                  {p.hidden ? "Hidden" : p.status}
                </Badge>
                {p.sport && <span className="text-xs text-muted-foreground">{p.sport}</span>}
                {p.location && <span className="text-xs text-muted-foreground">{p.location}</span>}
              </div>
              <h2 className="mt-2 break-words font-semibold leading-snug [overflow-wrap:anywhere]">{p.title}</h2>
              {p.excerpt && <p className="mt-1 line-clamp-2 break-words text-sm text-muted-foreground [overflow-wrap:anywhere]">{p.excerpt}</p>}
              <div className="mt-3 flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                <span className="min-w-0 max-w-full [overflow-wrap:anywhere]">
                  <span className="text-muted-foreground">Author: </span>
                  {p.author ? <Link href={`/users/${p.author.id}`} className={linkClass}>{p.author.name}</Link> : "—"}
                </span>
                <span className="min-w-0 max-w-full [overflow-wrap:anywhere]">
                  <span className="text-muted-foreground">Organization: </span>
                  {p.organization ? <Link href={`/organizations/${p.organization.id}`} className={linkClass}>{p.organization.name}</Link> : "—"}
                </span>
                <span className="min-w-0 max-w-full [overflow-wrap:anywhere]">
                  <span className="text-muted-foreground">Team: </span>
                  {p.team ? <Link href={`/teams/${p.team.id}`} className={linkClass}>{p.team.name}</Link> : "—"}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-xs text-muted-foreground">
                <span>{new Date(p.createdAt).toLocaleString()}</span>
                <Link href={`/posts/${p.id}`} className="text-sm font-semibold text-foreground underline-offset-2 hover:underline" aria-label={`View post: ${p.title}`} data-testid={`link-view-post-${p.id}`}>
                  View post
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
        <div data-testid="posts-pagination-info">Showing {showingFrom}–{showingTo} of {totalCount}</div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" disabled={page === 0 || isFetching} onClick={() => setPage((p) => Math.max(0, p - 1))} data-testid="btn-posts-prev">Previous</Button>
          <Button size="sm" variant="outline" disabled={!data?.pagination.hasMore || isFetching} onClick={() => setPage((p) => p + 1)} data-testid="btn-posts-next">Next</Button>
        </div>
      </div>
    </AdminLayout>
  );
}
