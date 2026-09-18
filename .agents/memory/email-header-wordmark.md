---
name: Email header wordmark
description: Why branded email headers use a tightly cropped, centered logo asset.
---

Render the real Kinectem logo from the full-width official banner, with centering baked into the image pixels. Deliver it as an inline CID attachment, not a remote image. Do not recreate the wordmark with styled HTML text.

**Why:** Desktop email clients such as Yahoo may block remote content and may ignore CSS centering on a tightly cropped CID image. The inline full-width banner avoids remote blocking and keeps the logo centered even when client alignment rules fail.

**How to apply:** The shared sender must attach the full banner bytes and render a matching `cid:` source. Keep the image at the shell width so its pixel-centered logo cannot shift; hosted copies remain for previews.