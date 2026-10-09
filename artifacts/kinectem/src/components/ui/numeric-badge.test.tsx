import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { NumericBadge } from "./numeric-badge";
import { Badge } from "./badge";

describe("numeric-only badge treatment", () => {
  it.each([1, 8, 12, "9+", "99+", 12345])("keeps %s as one label, with caller styling and accessibility", (count) => {
    render(<NumericBadge size={16} className="brand-count-marker bg-primary text-primary-foreground" aria-label="Unread messages" data-testid="count">{count}</NumericBadge>);
    const badge = screen.getByTestId("count");
    expect(badge).toHaveClass("numeric-badge", "brand-count-marker", "bg-primary", "text-primary-foreground");
    expect(badge).toHaveAttribute("aria-label", "Unread messages");
    expect(badge).toHaveStyle("--numeric-badge-size: 16px");
    expect(badge.children).toHaveLength(1);
    expect(badge.firstElementChild).toHaveClass("numeric-badge-label");
    expect(badge).toHaveTextContent(String(count));
  });

  it("supports numeric Badge variants without changing ordinary status badges", () => {
    render(<><Badge numeric variant="outline" data-testid="number">12</Badge><Badge variant="outline" data-testid="status">Pending approval</Badge></>);
    expect(screen.getByTestId("number")).toHaveClass("numeric-badge", "numeric-badge-bordered");
    expect(screen.getByTestId("number").firstElementChild).toHaveClass("numeric-badge-label");
    expect(screen.getByTestId("status")).not.toHaveClass("numeric-badge");
    expect(screen.getByTestId("status").querySelector(".numeric-badge-label")).toBeNull();
    expect(screen.getByTestId("status")).toHaveTextContent("Pending approval");
  });
});
