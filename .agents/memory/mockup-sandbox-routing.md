---
name: Mockup sandbox preview routing
description: Why this project's isolated canvas mockups use a development proxy
---

The isolated canvas preview may arrive without its app files even when its dependencies and old canvas references still exist. Do not assume old mockup iframes prove the local sandbox is intact.

**Why:** The shared development domain routed the mockup preview path to the marketing site's root fallback, while direct domain access to the standalone preview port was unavailable. A development-only proxy was needed to make an isolated sandbox preview reachable at the expected path without embedding or changing the production app.

**How to apply:** When a mockup iframe shows the marketing page or a blank preview, verify the response title and route through the shared dev domain before changing the component. Keep prototype code and generated imagery isolated from the product app; the proxy must not affect production serving.