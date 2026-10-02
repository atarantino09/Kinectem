import { describe, expect, it } from "vitest";
import { COMPETITION_PHOTO_MAX_BYTES, validateCompetitionPhotoBytes } from "../src/lib/competition-photo-storage";

describe("competition photo validation", () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02, 0xff, 0xd9]);
  const png = Buffer.from("89504e470d0a1a0a0000000049454e44ae426082", "hex");
  const gif = Buffer.from("GIF89aimage");

  it("accepts matching photo signatures, canonicalizing JPEG aliases", () => {
    expect(validateCompetitionPhotoBytes(jpeg, "image/jpg", false)).toEqual(jpeg);
    expect(validateCompetitionPhotoBytes(png, "image/png", false)).toEqual(png);
    expect(validateCompetitionPhotoBytes(gif, "image/gif", false)).toEqual(gif);
  });

  it("rejects SVG, HTML, videos, empty data, and mismatched types", () => {
    for (const [bytes, mime] of [
      [Buffer.from("<svg></svg>"), "image/svg+xml"],
      [Buffer.from("<script>bad()</script>"), "image/png"],
      [jpeg, "image/png"],
      [Buffer.from("video"), "video/mp4"],
      [Buffer.alloc(0), "image/jpeg"],
    ] as const) {
      expect(() => validateCompetitionPhotoBytes(bytes, mime, false)).toThrow();
    }
  });

  it("bounds actual bytes, not only uploader metadata", () => {
    expect(() => validateCompetitionPhotoBytes(Buffer.alloc(COMPETITION_PHOTO_MAX_BYTES + 1), "image/png", false))
      .toThrow("10 MB");
  });

  it("preserves minor type restrictions and removes JPEG location metadata", () => {
    expect(() => validateCompetitionPhotoBytes(gif, "image/gif", true)).toThrow("Under-13");
    const exifJpeg = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x0a]),
      Buffer.from("GPS-data"),
      jpeg.subarray(2),
    ]);
    const cleaned = validateCompetitionPhotoBytes(exifJpeg, "image/jpeg", true);
    expect(cleaned.includes(Buffer.from("GPS-data"))).toBe(false);
    expect(cleaned).toEqual(jpeg);
  });
});