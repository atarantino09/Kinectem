---
name: Email header wordmark
description: Why branded email headers use a tightly cropped, centered logo asset.
---

Render the real Kinectem logo from a tightly cropped asset, centered inside a compact, fixed-height masthead. Do not recreate the wordmark with styled HTML text.

**Why:** Desktop email clients such as Yahoo may block remote content while preserving the image's declared dimensions. A full-width banner leaves a large empty area with tiny alt text, while a hand-built text approximation does not match the real brand mark.

**How to apply:** Keep the logo image substantially smaller than its table-backed masthead and center both the image and its fallback. Serve the cropped asset from both root and `/app` artifact paths.