---
name: Vite invalid hook after dependency merge
description: Diagnose app-wide React invalid-hook crashes caused by stale optimized dependencies after workspace lockfile changes.
---

When a React app suddenly crashes at a top-level provider with `resolveDispatcher().useRef` or another invalid-hook error immediately after dependency or lockfile changes, verify the React tree first, then clear the artifact-local Vite optimization cache and restart its managed workflow before editing components.

**Why:** Vite can retain optimized dependency chunks from the previous workspace graph. The browser may then load incompatible React module instances even when the current package tree resolves to one React version, making an unrelated provider appear broken.

**How to apply:** Confirm `react` and `react-dom` resolve consistently and the Vite config dedupes both. Remove only the generated `node_modules/.vite` directory for the affected artifact, restart its existing workflow, and verify with a live preview plus browser logs.