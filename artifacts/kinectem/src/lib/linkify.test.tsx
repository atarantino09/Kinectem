import { describe, it, expect } from "vitest";
import { isValidElement, type ReactNode } from "react";
import { linkify } from "./linkify";

type AnchorProps = {
  href: string;
  target: string;
  rel: string;
  children: ReactNode;
};

function asAnchor(node: ReactNode): AnchorProps {
  if (!isValidElement(node) || node.type !== "a") {
    throw new Error(`Expected anchor element, got ${String(node)}`);
  }
  return node.props as AnchorProps;
}

describe("linkify", () => {
  it("returns an empty array for empty input", () => {
    expect(linkify("")).toEqual([]);
  });

  it("returns plain text when no URL is present", () => {
    const result = linkify("just a normal sentence.");
    expect(result).toEqual(["just a normal sentence."]);
  });

  it("wraps a single https URL in an anchor", () => {
    const result = linkify("Check out https://example.com");
    expect(result).toHaveLength(2);
    expect(result[0]).toBe("Check out ");
    const a = asAnchor(result[1]);
    expect(a.href).toBe("https://example.com");
    expect(a.target).toBe("_blank");
    expect(a.rel).toBe("noopener noreferrer");
    expect(a.children).toBe("https://example.com");
  });

  it("supports http URLs", () => {
    const result = linkify("see http://news.site/path?q=1 here");
    const a = asAnchor(result[1]);
    expect(a.href).toBe("http://news.site/path?q=1");
    expect(a.children).toBe("http://news.site/path?q=1");
    expect(result[2]).toBe(" here");
  });

  it("does not swallow trailing punctuation", () => {
    const result = linkify("Visit https://example.com, please.");
    const a = asAnchor(result[1]);
    expect(a.children).toBe("https://example.com");
    expect(result[2]).toBe(", please.");
  });

  it("strips a trailing period from the URL", () => {
    const result = linkify("Go to https://example.com/foo.");
    const a = asAnchor(result[1]);
    expect(a.children).toBe("https://example.com/foo");
    expect(result[2]).toBe(".");
  });

  it("does not include a closing paren when the URL is wrapped in parens", () => {
    const result = linkify("(see https://example.com/page)");
    expect(result[0]).toBe("(see ");
    const a = asAnchor(result[1]);
    expect(a.children).toBe("https://example.com/page");
    expect(result[2]).toBe(")");
  });

  it("preserves balanced parens inside a URL", () => {
    const result = linkify(
      "ref https://en.wikipedia.org/wiki/Foo_(bar) and more",
    );
    const a = asAnchor(result[1]);
    expect(a.children).toBe("https://en.wikipedia.org/wiki/Foo_(bar)");
    expect(result[2]).toBe(" and more");
  });

  it("linkifies multiple URLs in one string", () => {
    const result = linkify(
      "first https://a.example then https://b.example/path end",
    );
    expect(result).toHaveLength(5);
    expect(result[0]).toBe("first ");
    expect(asAnchor(result[1]).children).toBe("https://a.example");
    expect(result[2]).toBe(" then ");
    expect(asAnchor(result[3]).children).toBe("https://b.example/path");
    expect(result[4]).toBe(" end");
  });

  it("handles bare www URLs and links them via https", () => {
    const result = linkify("visit www.example.com today");
    const a = asAnchor(result[1]);
    expect(a.children).toBe("www.example.com");
    expect(a.href).toBe("https://www.example.com");
    expect(result[2]).toBe(" today");
  });

  it("opens links in a new tab with safe rel", () => {
    const result = linkify("https://example.com");
    const a = asAnchor(result[0]);
    expect(a.target).toBe("_blank");
    expect(a.rel).toBe("noopener noreferrer");
  });
});
