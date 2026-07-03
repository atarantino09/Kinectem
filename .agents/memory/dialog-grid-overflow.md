---
name: Dialog grid horizontal overflow from long unbreakable strings
description: Why long URLs/tokens blow out shadcn DialogContent width, and the correct wrap fix.
---

# shadcn DialogContent grid + long unbreakable strings → horizontal overflow

The shared `DialogContent` (`components/ui/dialog.tsx`) is `display: grid` and sets
`overflow-y-auto` (which computes `overflow-x` to `auto` too). Grid tracks size to
their items' **min-content**. Any descendant with a long unbreakable string (invite
URLs, hashed tokens, IDs) can push the track wider than `max-w-*`, blowing out the
whole modal — a horizontal scrollbar appears and **every** child looks clipped.

**Why `break-words` is NOT enough:** Tailwind `break-words` = `overflow-wrap: break-word`,
which permits breaking during layout but does **not** reduce the element's intrinsic
min-content size. So the grid track still expands to the full URL width.

**How to apply:**
- For wrapping text that contains long tokens/URLs (e.g. a "message to send" `<pre>`),
  use `[overflow-wrap:anywhere]` (or `break-all`) — these DO collapse min-content so
  the string wraps and the track stays within `max-w-*`.
- For single-line display, `truncate` (adds `overflow:hidden`) also keeps min-content
  small; pair with `min-w-0` on its flex parent.
- Root cause is min-content, not the visible overflow — fix the string element, not by
  slapping `overflow-x-hidden` on the whole dialog (that just hides clipped content).
