import { describe, expect, it } from "vitest";
import {
  plainTextToHtml,
  renderBrandedEmailHtml,
} from "@workspace/email-template";

describe("Kinectem branded email presentation", () => {
  it("renders the responsive shell, branded banner, escaped hierarchy, and CTA", () => {
    const html = renderBrandedEmailHtml({
      subject: `Join <North & South>`,
      contextLabel: `Varsity <Team>`,
      baseUrl: "https://kinectem.example/",
      bodyHtml:
        '<p>Approved body copy.</p><p><a href="https://kinectem.example/app/invites/token">https://kinectem.example/app/invites/token</a></p>',
    });

    expect(html).toContain("<!doctype html>");
    expect(html).toContain('name="viewport"');
    expect(html).toContain('alt="Kinectem"');
    expect(html).toContain("email-card");
    expect(html).toContain("email-hero");
    expect(html).toContain('bgcolor="#0b0f19"');
    expect(html).toContain("email-header-banner.png");
    expect(html).toContain("email-cta-cell");
    expect(html).toContain("background:#8b2cf5");
    expect(html).toContain("Join &lt;North &amp; South&gt;");
    expect(html).toContain("Varsity &lt;Team&gt;");
    expect(html).toContain("Where the story of the season comes to life.");
    expect(html).not.toContain("Youth sports stories, shared safely.");
    expect(html).not.toContain("Join <North & South>");
    expect(html).toContain('href="https://kinectem.example/app/invites/token"');
    expect(html).toContain('name="color-scheme"');
    expect(html).toContain("@media only screen and (max-width: 620px)");
    expect(html).toContain("@media (prefers-color-scheme: dark)");
    expect(html).toContain(
      'src="https://kinectem.example/email-header-banner.png"',
    );
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
    expect(html).toContain("Open in Kinectem");
    expect(html).toContain("Button not working?");
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
