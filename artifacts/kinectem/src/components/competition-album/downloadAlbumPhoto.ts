import type { AlbumPhoto } from "@/lib/competitionAlbum";

export async function downloadAlbumPhoto(photo: Pick<AlbumPhoto, "id" | "url" | "fileName">) {
  const response = await fetch(photo.url, { credentials: "include", cache: "no-store" });
  if (!response.ok) {
    throw new Error(
      response.status === 401
        ? "Please sign in again to download photos."
        : response.status === 404
          ? "This photo is no longer available."
          : "The photo couldn’t be downloaded. Please try again.",
    );
  }
  const blob = await response.blob();
  if (!blob.size || !blob.type.startsWith("image/")) {
    throw new Error("The photo couldn’t be downloaded. Please try again.");
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = photo.fileName || `competition-photo-${photo.id}`;
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
    // Leave time for mobile browsers to start reading the download.
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}
