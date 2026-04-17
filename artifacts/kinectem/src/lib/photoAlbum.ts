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

type Store = Record<string, AlbumPhoto[]>;

function readStore(): Store {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Store) : {};
  } catch {
    return {};
  }
}

function writeStore(store: Store) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
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

  const addPhoto = useCallback(
    (photo: Omit<AlbumPhoto, "id" | "postId" | "createdAt">) => {
      const store = readStore();
      const entry: AlbumPhoto = {
        ...photo,
        id: crypto.randomUUID(),
        postId,
        createdAt: new Date().toISOString(),
      };
      store[postId] = [entry, ...(store[postId] ?? [])];
      writeStore(store);
    },
    [postId],
  );

  const removePhoto = useCallback(
    (photoId: string) => {
      const store = readStore();
      store[postId] = (store[postId] ?? []).filter((p) => p.id !== photoId);
      writeStore(store);
    },
    [postId],
  );

  return { photos, addPhoto, removePhoto };
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
