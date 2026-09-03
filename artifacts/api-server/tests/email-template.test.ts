import { describe, expect, it } from "vitest";
import {
  plainTextToHtml,
  renderBrandedEmailHtml,
} from "@workspace/email-template";

describe("Kinectem branded email presentation", () => {
  it("renders the responsive shell, transparent lockup, escaped hierarchy, and CTA", () => {
    const html = renderBrandedEmailHtml({
      subject: `Join <North & South>`,
      contextLabel: `Varsity <Team>`,
      baseUrl: "https://kinectem.example/",
      bodyHtml:
        '<p>Approved body copy.</p><p><a href="https://kinectem.example/app/invites/token">Accept invite →</a></p>',
    });

    expect(html).toContain("<!doctype html>");
    expect(html).toContain('name="viewport"');
    expect(html).toContain(
      'src="https://kinectem.example/logo-horizontal.png"',
    );
    expect(html).toContain('alt="Kinectem"');
    expect(html).toContain("email-card");
    expect(html).toContain("email-body-copy p > a");
    expect(html).toContain("Join &lt;North &amp; South&gt;");
    expect(html).toContain("Varsity &lt;Team&gt;");
    expect(html).toContain("Where the story of the season comes to life.");
    expect(html).not.toContain("Youth sports stories, shared safely.");
    expect(html).not.toContain("Join <North & South>");
    expect(html).toContain('href="https://kinectem.example/app/invites/token"');
  });

  it("turns text-only messages into escaped, linked HTML", () => {
    const html = plainTextToHtml(
      "Organization: <North & South>\n\nReview:\nhttps://kinectem.example/app/admin?claim=1&view=review",
    );

    expect(html).toContain("Organization: &lt;North &amp; South&gt;");
    expect(html).not.toContain("<North & South>");
    expect(html).toContain(
      'href="https://kinectem.example/app/admin?claim=1&amp;view=review"',
    );
  });

  it("keeps caller-owned compliance content inside the shell", () => {
    const html = renderBrandedEmailHtml({
      subject: "Weekly update",
      baseUrl: "https://kinectem.example",
      bodyHtml: "<p>Team activity</p>",
      footerHtml:
        '<p>Manage preferences · <a href="https://kinectem.example/api/unsubscribe">Unsubscribe</a></p>',
    });

    expect(html).toContain("Manage preferences");
    expect(html).toContain("Unsubscribe");
    expect(html).toContain("</html>");
  });
});
