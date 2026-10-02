import { describe, expect, it } from "vitest";
import {
  buildPayload,
  checkClipDimensions,
  checkClipFile,
  getHistorical,
  historicalDateLabel,
  historicalEditHref,
  validateHistorical,
  type HistoricalFormState,
} from "./historical";

const base: HistoricalFormState = {
  title: "State final",
  body: "text",
  coverImageUrl: "u",
  dateMode: "year",
  gameDate: "2001-01-01",
  year: "1974",
  newspaper: " ",
  byline: "",
  publicationDate: "",
};

describe("historical helpers", () => {
  it("year mode sends year only and no today default", () => {
    const p = buildPayload(base, true, false);
    expect(p.historical.gameDate).toBeNull();
    expect(p.historical.year).toBe(1974);
    expect(p.historical.newspaper).toBeNull();
  });
  it("validates date or year", () => {
    expect(validateHistorical({ ...base, year: "" })).toBeTruthy();
    expect(validateHistorical({ ...base, dateMode: "exact", gameDate: "" })).toBeTruthy();
    expect(validateHistorical(base)).toBeNull();
  });
  it("checks files", () => {
    expect(checkClipFile({ type: "application/pdf", size: 1 })).toBeTruthy();
    expect(checkClipFile({ type: "image/png", size: 6 * 1024 * 1024 })).toBeTruthy();
    expect(checkClipDimensions(9000, 10)).toBeTruthy();
    expect(checkClipDimensions(7000, 6000)).toBeTruthy();
    expect(checkClipDimensions(3000, 2000)).toBeNull();
  });
  it("reads metadata and routes edits by scope", () => {
    const h = { gameDate: null, year: 1962, newspaper: null, byline: null, publicationDate: null, rightsConfirmed: true, reviewed: true };
    expect(getHistorical({ recapKind: "historical", historical: h })).toEqual(h);
    expect(getHistorical({ recapKind: "combined", historical: h })).toBeNull();
    expect(historicalDateLabel(h)).toBe("1962");
    expect(historicalEditHref({ id: "p1", context: { type: "organization", id: "o1" } })).toBe(
      "/historical-recap?organizationId=o1&postId=p1",
    );
  });
});
