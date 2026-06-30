---
name: Runtime-error overlay "(unknown runtime error)"
description: Why the dev runtime-error overlay shows "(unknown runtime error)" and how the benign ResizeObserver loop signal is suppressed.
---

# Dev runtime-error overlay shows "(unknown runtime error)"

`@replit/vite-plugin-runtime-error-modal` listens on `window` `error` +
`unhandledrejection` and, for any payload that is **not** an `Error`, relabels it
`new Error("(unknown runtime error)")`. So a window `error` event whose `error`
object is `null` (message-only) surfaces as a red "(unknown runtime error)"
overlay even though nothing real threw.

The classic source is the browser's benign **ResizeObserver loop** signal
("ResizeObserver loop completed with undelivered notifications" / "loop limit
exceeded") — it dispatches a `window` error event with `evt.error === null`,
message-only. It is transient, dismiss-on-tap, breaks nothing, and is
**dev-overlay-only** (the plugin doesn't run in prod). It's timing/layout
dependent (Radix Select/Dialog/Toast + our own ResizeObservers settling, notably
on mobile right after login), so it often won't reproduce in clean scripted runs.

**Rule:** treat an empty "(unknown runtime error)" overlay (no stack, dismissable,
nothing broken) as the ResizeObserver loop signal, not a real crash.

**Fix applied:** an inline classic `<script>` placed first in
`artifacts/kinectem/index.html` `<head>` adds a capture-phase `window` `error`
listener that `stopImmediatePropagation()` + `preventDefault()` **only** when
`e.error == null` AND the message contains `"ResizeObserver loop"`.

**Why this works / why these constraints:**
- Inline classic head script runs during parse, **before** the plugin's deferred
  module registers its listener. For a `window`-targeted error event (AT_TARGET),
  listeners fire in registration order, so registering first is what lets
  `stopImmediatePropagation()` block the plugin handler — the capture flag alone
  is not enough.
- Requiring `e.error == null` means a real error thrown *inside* an observer
  callback (non-null `error`) still surfaces — we only swallow the engine's
  benign loop notification.
