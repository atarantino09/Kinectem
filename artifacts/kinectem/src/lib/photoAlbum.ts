import { useCallback, useEffect, useState } from "react";

export type AlbumPhoto = {
  id: string;
  postId: string;
  dataUrl: string;
  uploaderName: string;
  caption: string;
  createdAt: string;
};

const STORAGE_KEY = "kinectem.photoAlbums.v1";

// Conservative cap below the typical 5 MB localStorage origin quota. Used for
// the pre-flight estimate in `addPhoto` so a multi-photo insert doesn't get
// stuck halfway through with the second `setItem` throwing.
const STORE_BUDGET_BYTES = 4 * 1024 * 1024;

export class AlbumQuotaError extends Error {
  constructor(message = "Album storage is full on this device.") {
    super(message);
    this.name = "AlbumQuotaError";
  }
}

function isQuotaError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.name === "QuotaExceededError") return true;
  if (err.name === "NS_ERROR_DOM_QUOTA_REACHED") return true;
  const code = (err as { code?: number }).code;
  return code === 22 || code === 1014;
}

type Store = Record<string, AlbumPhoto[]>;

function readStore(): Store {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Store) : {};
  } catch {
    return {};
  }
}

export function writeStore(store: Store) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch (err) {
    if (isQuotaError(err)) {
      throw new AlbumQuotaError();
    }
    throw err;
  }
  window.dispatchEvent(new CustomEvent("kinectem.album.changed"));
}

export function useAlbum(postId: string) {
  const [photos, setPhotos] = useState<AlbumPhoto[]>([]);

  const refresh = useCallback(() => {
    setPhotos(readStore()[postId] ?? []);
  }, [postId]);

  useEffect(() => {
    refresh();
    const onChange = () => refresh();
    window.addEventListener("kinectem.album.changed", onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener("kinectem.album.changed", onChange);
      window.removeEventListener("storage", onChange);
    };
  }, [refresh]);

  const addPhotos = useCallback(
    (newPhotos: Omit<AlbumPhoto, "id" | "postId" | "createdAt">[]) => {
      if (newPhotos.length === 0) return;
      const store = readStore();
      const now = new Date().toISOString();
      const entries: AlbumPhoto[] = newPhotos.map((p) => ({
        ...p,
        id: crypto.randomUUID(),
        postId,
        createdAt: now,
      }));
      store[postId] = [...entries, ...(store[postId] ?? [])];
      // Pre-flight check: bail before touching localStorage if the resulting
      // payload would obviously bust the origin quota. Avoids partial inserts
      // — either the whole batch lands or none of it does.
      if (JSON.stringify(store).length > STORE_BUDGET_BYTES) {
        throw new AlbumQuotaError();
      }
      writeStore(store);
    },
    [postId],
  );

  const addPhoto = useCallback(
    (photo: Omit<AlbumPhoto, "id" | "postId" | "createdAt">) => addPhotos([photo]),
    [addPhotos],
  );

  const removePhoto = useCallback(
    (photoId: string) => {
      const store = readStore();
      store[postId] = (store[postId] ?? []).filter((p) => p.id !== photoId);
      writeStore(store);
    },
    [postId],
  );

  return { photos, addPhoto, addPhotos, removePhoto };
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
