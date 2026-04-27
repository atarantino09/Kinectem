import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";

export type WhoamiUser = {
  id: string;
  name: string;
  email: string;
  role: "athlete" | "parent" | "coach" | "admin";
};

export type WhoamiResponse = {
  authenticated: boolean;
  isMasquerading?: boolean;
  realUser?: WhoamiUser;
  viewingAs?: WhoamiUser | null;
  canAuthorRecap?: boolean;
};

export function useWhoami() {
  return useQuery<WhoamiResponse>({
    queryKey: ["whoami"],
    queryFn: () =>
      customFetch<WhoamiResponse>("/api/v1/auth/whoami", { method: "GET" }),
    staleTime: 30_000,
    retry: false,
  });
}
