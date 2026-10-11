import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { useWhoami } from "@/hooks/useWhoami";

export type AdminPostType = "game_recap" | "combined_recap" | "historical_recap" | "practice_plan" | "highlight" | "org_post" | "news";
export type AdminPostSort = "newest" | "oldest" | "sport" | "location" | "organization" | "post_type";
export type AdminPostFilters = {
  q?: string;
  sport?: string;
  location?: string;
  organizationId?: string;
  postType?: AdminPostType;
  sort?: AdminPostSort;
};
export type AdminPostItem = {
  id: string;
  sourceId: string;
  type: AdminPostType;
  title: string;
  excerpt: string;
  createdAt: string;
  status: string;
  hidden: boolean;
  sport: string | null;
  location: string | null;
  author: { id: string; name: string } | null;
  team: { id: string; name: string } | null;
  organization: { id: string; name: string } | null;
};
export type AdminPostsResponse = {
  data: AdminPostItem[];
  pagination: { totalCount: number; limit: number; offset: number; hasMore: boolean };
  facets: {
    sports: string[];
    locations: string[];
    organizations: Array<{ id: string; name: string }>;
    postTypes: Array<{ value: AdminPostType; label: string }>;
  };
};
export const ADMIN_POST_PAGE_SIZE = 25;
export const ADMIN_POST_TYPES: Array<{ value: AdminPostType; label: string }> = [
  { value: "game_recap", label: "Game recap" },
  { value: "combined_recap", label: "Combined recap" },
  { value: "historical_recap", label: "Historical recap" },
  { value: "practice_plan", label: "Practice plan" },
  { value: "highlight", label: "Highlight" },
  { value: "org_post", label: "Organization post" },
  { value: "news", label: "In the news" },
];

export function useAdminPosts(filters: AdminPostFilters, page: number) {
  const { data: who } = useWhoami();
  const params = new URLSearchParams({
    limit: String(ADMIN_POST_PAGE_SIZE),
    offset: String(page * ADMIN_POST_PAGE_SIZE),
  });
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value);
  }
  return useQuery<AdminPostsResponse>({
    queryKey: ["admin", "posts", who?.realUser?.id, who?.isMasquerading, filters, page],
    enabled: !!who?.authenticated && who.realUser?.role === "admin",
    queryFn: () => customFetch<AdminPostsResponse>(`/api/v1/admin/posts?${params}`, { method: "GET" }),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}
