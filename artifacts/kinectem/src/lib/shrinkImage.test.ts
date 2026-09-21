import { describe, expect, it } from "vitest";
import {
  classifyImageFile,
  normalizeImageFileMime,
  shrinkImage,
} from "./shrinkImage";

function file(name: string, type: string): File {
  return new File([new Uint8Array([1])], name, { type });
}

describe("classifyImageFile", () => {
  it("accepts supported MIME types", () => {
    expect(classifyImageFile(file("photo.bin", "image/jpeg"))).toBe("supported");
    expect(classifyImageFile(file("photo.bin", "image/webp"))).toBe("supported");
  });

  it("accepts known photo extensions when the picker omits MIME", () => {
    for (const extension of ["jpg", "jpeg", "png", "webp", "gif"]) {
      expect(classifyImageFile(file(`photo.${extension}`, ""))).toBe("supported");
    }
  });

  it("classifies HEIC and HEIF before generic rejection", () => {
    expect(classifyImageFile(file("photo.heic", ""))).toBe("heic");
    expect(classifyImageFile(file("photo.heif", "image/heif"))).toBe("heic");
  });

  it("does not turn videos or PDFs into images", () => {
    expect(classifyImageFile(file("clip.mp4", "video/mp4"))).toBe("not-image");
    expect(classifyImageFile(file("flyer.pdf", "application/pdf"))).toBe("not-image");
  });

  it("normalizes MIME-less JPEG and PNG files before an early shrink return", async () => {
    const jpeg = await shrinkImage(file("photo.jpeg", ""));
    const png = normalizeImageFileMime(file("photo.png", ""));

    expect(jpeg.type).toBe("image/jpeg");
    expect(png.type).toBe("image/png");
    expect(jpeg.name).toBe("photo.jpeg");
    expect(png.name).toBe("photo.png");
  });
});