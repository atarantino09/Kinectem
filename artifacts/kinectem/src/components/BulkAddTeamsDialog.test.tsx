import { describe, it, expect } from "vitest";
import { parseBulkRows } from "./BulkAddTeamsDialog";

// Task #814 — line-paired parsing of the two bulk-add columns.
describe("parseBulkRows", () => {
  it("pairs teams and coaches strictly by line number", () => {
    const { rows, errors } = parseBulkRows(
      "Alpha\nBravo\nCharlie",
      "a@x.com\n\nc@x.com",
    );
    expect(errors).toEqual([]);
    expect(rows).toEqual([
      { line: 1, name: "Alpha", email: "a@x.com" },
      { line: 2, name: "Bravo", email: "" },
      { line: 3, name: "Charlie", email: "c@x.com" },
    ]);
  });

  it("behaves like the old parser when the coach column is empty", () => {
    const { rows, errors } = parseBulkRows(
      "  Alpha  \n\nalpha\nBravo\n  ",
      "",
    );
    expect(errors).toEqual([]);
    expect(rows.map((r) => r.name)).toEqual(["Alpha", "Bravo"]);
  });

  it("flags invalid coach emails with the line number", () => {
    const { rows, errors } = parseBulkRows("Alpha\nBravo", "not-an-email\nb@x.com");
    expect(errors).toHaveLength(1);
    expect(errors[0].line).toBe(1);
    expect(rows).toHaveLength(2); // row still counted; submission is blocked
  });

  it("flags a coach email with no team name on the same line", () => {
    const { rows, errors } = parseBulkRows("Alpha\n", "a@x.com\norphan@x.com");
    expect(errors).toHaveLength(1);
    expect(errors[0].line).toBe(2);
    expect(rows).toHaveLength(1);
  });

  it("collapses duplicate team names (keeping the first pairing)", () => {
    const { rows, errors } = parseBulkRows(
      "Alpha\nalpha\nBravo",
      "first@x.com\nsecond@x.com\n",
    );
    expect(errors).toEqual([]);
    expect(rows).toEqual([
      { line: 1, name: "Alpha", email: "first@x.com" },
      { line: 3, name: "Bravo", email: "" },
    ]);
  });

  it("lowercases and trims coach emails", () => {
    const { rows } = parseBulkRows("Alpha", "  Coach@X.COM ");
    expect(rows[0].email).toBe("coach@x.com");
  });
});
