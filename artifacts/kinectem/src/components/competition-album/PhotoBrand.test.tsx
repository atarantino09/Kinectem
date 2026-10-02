import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PhotoBrand } from "./PhotoBrand";

describe("competition photo branding", () => {
  it("uses a compact competition-name badge when no logo is configured", () => {
    render(
      <PhotoBrand
        competition={{ name: "Summer Cup", logoUrl: null, brandColor: null }}
      />,
    );

    expect(screen.getByTestId("photo-brand")).toHaveTextContent("Summer Cup");
    expect(screen.getByTestId("photo-brand")).toHaveStyle({
      borderBottom: "2px solid #1e293b",
    });
  });

  it("falls back to the competition name if its configured logo cannot load", () => {
    render(
      <PhotoBrand
        competition={{
          name: "Summer Cup",
          logoUrl: "https://example.invalid/summer-cup.svg",
          brandColor: "#2457a7",
        }}
      />,
    );

    fireEvent.error(screen.getByRole("img", { name: "Summer Cup" }));
    expect(screen.getByTestId("photo-brand")).toHaveTextContent("Summer Cup");
    expect(screen.getByTestId("photo-brand")).toHaveStyle({
      borderBottom: "2px solid #2457a7",
    });
  });
});