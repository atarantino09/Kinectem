---
name: Email dark-mode branding
description: How Kinectem email branding stays legible across automatic email-client dark mode and path-based artifact routing.
---

Transactional email headers must use the standard logo in light mode and the white monochrome lockup in dark mode. Do not rely on email clients to invert a transparent black wordmark correctly.

**Why:** Apple Mail can darken the email card while leaving raster image colors unchanged, making the standard black wordmark nearly invisible.

**How to apply:** Keep both images in the shared email renderer and swap them with email-compatible dark-mode CSS. Build the dark asset URL through the `/app` artifact path when the supplied base URL is the site root, but do not duplicate `/app` when it is already present.