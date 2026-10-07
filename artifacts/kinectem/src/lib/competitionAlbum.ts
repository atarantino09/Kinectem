import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { customFetch, useGetLoggedInUser } from "@workspace/api-client-react";
import { apiErrorMessage } from "@/lib/api-errors";
import { classifyImageFile, shrinkImage } from "@/lib/shrinkImage";

export type AlbumStatus = "pending" | "approved" | "rejected";
export type AlbumView = "approved" | "mine" | "pending" | "rejected";

export type AlbumCompetition = {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  brandColor: string | null;
};

export type AlbumPhoto = {
  id: string;
  batchId: string;
  url: string;
  fileName: string;
  status: AlbumStatus;
  uploadedByName: string;
  createdAt: string;
  teamIds: string[];
  teamNames: string[];
  canDelete: boolean;
};

export type AlbumTeam = { id: string; name: string; canTag: boolean };

export type AlbumResponse = {
  competition: AlbumCompetition;
  photos: AlbumPhoto[];
  teams: AlbumTeam[];
  canManage: boolean;
  isCompetitionAdmin?: boolean;
  canUpload: boolean;
  contributionsOpen: boolean;
  pendingCount: number;
  approvedCount: number;
};

export type TeamCompetitionPhoto = AlbumPhoto & {
  competition: AlbumCompetition;
};

export const ALBUM_KEY = "competition-album";
export const TEAM_ALBUM_KEY = "team-competition-photos";
export const ALBUM_MAX_BATCH = 100;

function jf<T>(url: string, method: string, body?: unknown): Promise<T> {
  return customFetch<T>(url, {
    method,
    ...(body === undefined
      ? {}
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
}

export function errText(err: unknown, fallback = "Please try again."): string {
  return apiErrorMessage(err) ?? (err instanceof Error ? err.message : fallback);
}

/** Session identity used in every cache key so private views never leak. */
export function useAlbumSessionId(): string {
  const { data: me } = useGetLoggedInUser();
  return me && "id" in me && me.id ? String(me.id) : "anon";
}

/** Clears private album caches whenever the signed-in user changes. */
export function useAlbumAuthReset(sessionId: string) {
  const qc = useQueryClient();
  const prev = useRef(sessionId);
  useEffect(() => {
    if (prev.current !== sessionId) {
      prev.current = sessionId;
      qc.removeQueries({ queryKey: [ALBUM_KEY] });
      qc.removeQueries({ queryKey: [TEAM_ALBUM_KEY] });
    }
  }, [sessionId, qc]);
}

export function invalidateAlbums(qc: QueryClient) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: [ALBUM_KEY] }),
    qc.invalidateQueries({ queryKey: [TEAM_ALBUM_KEY] }),
  ]);
}

export function useCompetitionAlbum(
  competitionId: string,
  view: AlbumView,
  enabled = true,
) {
  const sid = useAlbumSessionId();
  return useQuery<AlbumResponse>({
    queryKey: [ALBUM_KEY, sid, competitionId, view],
    queryFn: () =>
      jf<AlbumResponse>(
        `/api/v1/competitions/${competitionId}/album?view=${view}`,
        "GET",
      ),
    enabled: enabled && !!competitionId && sid !== "anon",
    retry: 1,
    staleTime: 0,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
}

export function useTeamCompetitionPhotos(teamId: string) {
  const sid = useAlbumSessionId();
  return useQuery<{ photos: TeamCompetitionPhoto[] }>({
    queryKey: [TEAM_ALBUM_KEY, sid, teamId],
    queryFn: () =>
      jf<{ photos: TeamCompetitionPhoto[] }>(
        `/api/v1/teams/${teamId}/competition-photos`,
        "GET",
      ),
    enabled: !!teamId && sid !== "anon",
    retry: 1,
    staleTime: 0,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}

export type ReviewResult = { changedIds: string[]; conflictIds: string[] };

export function useReviewPhotos(competitionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: {
      photoIds: string[];
      action: "approve" | "reject";
      expectedStatus: AlbumStatus;
    }) =>
      jf<ReviewResult>(
        `/api/v1/competitions/${competitionId}/album/review`,
        "POST",
        v,
      ),
    onSettled: () => invalidateAlbums(qc),
  });
}

export function useSetPhotoTags(competitionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { photoIds: string[]; teamIds: string[] }) =>
      jf<unknown>(
        `/api/v1/competitions/${competitionId}/album/photos/tags`,
        "PATCH",
        v,
      ),
    onSettled: () => invalidateAlbums(qc),
  });
}

export function useDeleteAlbumPhoto(competitionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (photoId: string) =>
      jf<unknown>(
        `/api/v1/competitions/${competitionId}/album/photos/${photoId}`,
        "DELETE",
      ),
    onSettled: () => invalidateAlbums(qc),
  });
}

export function useSetContributions(competitionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (contributionsOpen: boolean) =>
      jf<unknown>(`/api/v1/competitions/${competitionId}/album`, "PATCH", {
        contributionsOpen,
      }),
    onSettled: () => invalidateAlbums(qc),
  });
}

/* ------------------------------ Upload engine ----------------------------- */

export type UploadItem = {
  id: string;
  file: File;
  previewUrl: string;
  status: "queued" | "preparing" | "uploading" | "done" | "failed";
  progress: number;
  error?: string;
  clientPhotoId: string;
  processed?: File;
  photoId?: string;
  uploaded?: boolean;
  batchKey?: string;
};

export function newClientId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function createBatch(competitionId: string, clientBatchId: string) {
  return jf<{ id: string }>(
    `/api/v1/competitions/${competitionId}/album/batches`,
    "POST",
    { clientBatchId },
  );
}

export function completeBatch(competitionId: string, batchId: string) {
  return jf<{ submittedCount: number }>(
    `/api/v1/competitions/${competitionId}/album/batches/${batchId}/complete`,
    "POST",
  );
}

function putWithProgress(
  url: string,
  blob: Blob,
  onProgress: (pct: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open("PUT", url);
    x.timeout = 120_000;
    let sameOrigin = true;
    try {
      sameOrigin = new URL(url, window.location.href).origin === window.location.origin;
    } catch {
      sameOrigin = true;
    }
    // Cross-origin private GCS URLs must omit credentials.
    x.withCredentials = sameOrigin;
    x.setRequestHeader("Content-Type", blob.type || "image/jpeg");
    x.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    x.onload = () =>
      x.status >= 200 && x.status < 300
        ? resolve()
        : reject(new Error(`Upload failed (${x.status})`));
    x.onerror = () => reject(new Error("Network error during upload"));
    x.ontimeout = () => reject(new Error("Upload timed out. Please retry this photo."));
    x.onabort = () => reject(new Error("Upload cancelled"));
    x.send(blob);
  });
}

/**
 * Uploads one file into an existing batch. Safe to re-run: the client photo id
 * is stable, and steps already finished (`uploaded`) are skipped.
 */
export async function uploadOne(
  competitionId: string,
  batchId: string,
  batchKey: string,
  item: UploadItem,
  teamIds: string[],
  patch: (p: Partial<UploadItem>) => void,
): Promise<boolean> {
  try {
    let blob = item.processed;
    if (!blob) {
      patch({ status: "preparing", error: undefined });
      blob =
        classifyImageFile(item.file) === "supported"
          ? await shrinkImage(item.file)
          : item.file;
      patch({ processed: blob });
    }
    patch({ status: "uploading", error: undefined });
    if (!item.uploaded) {
      const slot = await jf<{
        photoId: string;
        uploadUrl: string;
        confirmed?: boolean;
      }>(
        `/api/v1/competitions/${competitionId}/album/batches/${batchId}/photos`,
        "POST",
        {
          clientPhotoId: item.clientPhotoId,
          fileName: blob.name || item.file.name,
          fileType: blob.type || "image/jpeg",
          fileSize: blob.size,
          teamIds,
        },
      );
      patch({ photoId: slot.photoId });
      item = { ...item, photoId: slot.photoId };
      if (slot.confirmed) {
        patch({ uploaded: true, status: "done", progress: 100, batchKey });
        return true;
      }
      await putWithProgress(slot.uploadUrl, blob, (p) => patch({ progress: p }));
      patch({ uploaded: true });
    }
    await jf<unknown>(
      `/api/v1/competitions/${competitionId}/album/photos/${item.photoId}/confirm`,
      "POST",
    );
    patch({ status: "done", progress: 100, batchKey });
    return true;
  } catch (err) {
    patch({ status: "failed", error: errText(err, "Upload failed") });
    return false;
  }
}
