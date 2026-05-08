import { describe, expect, it } from "vitest";
import {
  ANON_MINOR_NAME_CONTEXT,
  TRUSTED_MINOR_NAME_CONTEXT,
  displayNameForViewer,
  maskedDisplayName,
  shouldMaskMinorName,
  type MinorNameViewerContext,
} from "../src/lib/spec-helpers";

const minor = (over: Partial<{ id: string; name: string }> = {}) => ({
  id: over.id ?? "minor-1",
  name: over.name ?? "Sam Karim",
  isMinor: true,
});

const adult = (over: Partial<{ id: string; name: string }> = {}) => ({
  id: over.id ?? "adult-1",
  name: over.name ?? "Alex Reed",
  isMinor: false,
});

describe("maskedDisplayName", () => {
  it("renders Firstname L. for a two-word name", () => {
    expect(maskedDisplayName({ name: "Sam Karim" })).toBe("Sam K.");
  });

  it("only initials the final surname token for multi-word last names", () => {
    // Implementation collapses any middle/given tokens between the
    // first name and the trailing surname so the masked form stays
    // short — `"Sam Van Der Meer"` → `"Sam M."`.
    expect(maskedDisplayName({ name: "Sam Van Der Meer" })).toBe("Sam M.");
  });

  it("returns just the first name when only one token is present", () => {
    expect(maskedDisplayName({ name: "Sam" })).toBe("Sam");
  });

  it("preserves the empty / whitespace-only display gracefully", () => {
    expect(maskedDisplayName({ name: "" })).toBe("");
    expect(maskedDisplayName({ name: "   " })).toBe("   ");
  });
});

describe("shouldMaskMinorName", () => {
  it("never masks a non-minor target", () => {
    expect(shouldMaskMinorName(adult(), ANON_MINOR_NAME_CONTEXT)).toBe(false);
  });

  it("masks a minor for an anonymous viewer", () => {
    expect(shouldMaskMinorName(minor(), ANON_MINOR_NAME_CONTEXT)).toBe(true);
  });

  it("does not mask when the viewer is the minor themselves", () => {
    const ctx: MinorNameViewerContext = {
      viewerId: "minor-1",
      viewerRole: "athlete",
      privilegedTargetIds: new Set(["minor-1"]),
    };
    expect(shouldMaskMinorName(minor({ id: "minor-1" }), ctx)).toBe(false);
  });

  it("does not mask when the viewer is in the privileged set (linked guardian / shared roster)", () => {
    const ctx: MinorNameViewerContext = {
      viewerId: "guardian-1",
      viewerRole: "parent",
      privilegedTargetIds: new Set(["minor-1"]),
    };
    expect(shouldMaskMinorName(minor({ id: "minor-1" }), ctx)).toBe(false);
  });

  it("masks when the viewer is privileged for some other minor but not this one", () => {
    const ctx: MinorNameViewerContext = {
      viewerId: "guardian-1",
      viewerRole: "parent",
      privilegedTargetIds: new Set(["minor-2"]),
    };
    expect(shouldMaskMinorName(minor({ id: "minor-1" }), ctx)).toBe(true);
  });

  it("never masks when the bypass flag is set (admin / migrated route default)", () => {
    expect(shouldMaskMinorName(minor(), TRUSTED_MINOR_NAME_CONTEXT)).toBe(
      false,
    );
  });
});

describe("displayNameForViewer", () => {
  it("returns the masked form for an anonymous viewer of a minor", () => {
    expect(displayNameForViewer(minor(), ANON_MINOR_NAME_CONTEXT)).toBe(
      "Sam K.",
    );
  });

  it("returns the full name for a privileged viewer", () => {
    const ctx: MinorNameViewerContext = {
      viewerId: "guardian-1",
      viewerRole: "parent",
      privilegedTargetIds: new Set(["minor-1"]),
    };
    expect(displayNameForViewer(minor({ id: "minor-1" }), ctx)).toBe(
      "Sam Karim",
    );
  });

  it("returns the full name when no context is supplied (backwards-compat default)", () => {
    expect(displayNameForViewer(minor())).toBe("Sam Karim");
  });

  it("never masks adults regardless of context", () => {
    expect(displayNameForViewer(adult(), ANON_MINOR_NAME_CONTEXT)).toBe(
      "Alex Reed",
    );
  });
});
