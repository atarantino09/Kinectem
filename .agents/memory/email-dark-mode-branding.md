---
name: Email dark-mode branding
description: How Kinectem email branding stays legible across automatic email-client dark mode and path-based artifact routing.
---

Transactional email headers must use the supplied full-width banner with the Kinectem logo embedded on its intended dark background. Do not rely on email clients to invert or correctly place a transparent wordmark.

**Why:** Apple Mail can darken the email card while leaving raster image colors unchanged, making a transparent black wordmark nearly invisible. Keeping the logo and dark surface in one image preserves contrast in both themes.

**How to apply:** Keep the same banner file in both the root marketing public assets and the `/app` public assets. Resolve it relative to the supplied base URL, and retain a dark cell plus readable alt text when remote images are blocked.