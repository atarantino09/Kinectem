---
name: Modal text blur (dialog centering + composited scroll layers)
description: Why shadcn dialogs in kinectem center with flexbox, and why nested overflow-scroll inside a dialog renders blurry text.
---

# Modal text blur — two distinct causes

Users repeatedly report "text looks a little blurry" only *inside* modals while
the rest of the app is crisp. Native-resolution screenshots confirm it. There
are two independent causes; both have bitten this codebase.

## Cause 1 — `-translate-1/2` centering on odd-sized modals

The shadcn `DialogContent` / `AlertDialogContent` default centers with
`fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2`. When the modal's
width or height is an **odd** number of pixels (height almost always is, since
it's content-driven), `-50%` resolves to a half-pixel offset and the browser
rasterizes the box on a sub-pixel boundary → its **text renders blurry**.

**Rule:** center modal content with a flex wrapper
(`fixed inset-0 flex items-center justify-center`) so the box lands on whole
pixels, and drop the `slide-in/out-*` classes (they reintroduce a translate).
Wrapper is `pointer-events-none`, content `pointer-events-auto`, so Radix
outside-click dismissal + focus trap still work.

**How to apply:** if you re-add a modal primitive, copy from another artifact,
or `npx shadcn add dialog`, re-apply the flex-centering wrapper — the upstream
shadcn template brings back the translate centering and the blur with it.

## Cause 2 — a nested `overflow-y-auto` scroll box inside the dialog

A scrollable region (`overflow-y-auto` with content that actually overflows)
gets promoted to its **own composited layer** in Chrome. That inner layer is
positioned at the *accumulated* offset of everything above it inside the dialog;
those sub-pixel line-heights/borders push it onto a fractional device pixel, so
the compositor rasterizes the layer (and its text) blurry — **even when the
dialog itself is crisp**. Tell-tale sign: only the one scrollable sub-box is
blurry while every sibling (headings, description, a truncated `<code>` line) is
sharp.

**Rule:** don't put a nested `max-h-… overflow-y-auto` text box inside a dialog
just to bound a long preview. Let the content flow and rely on the
`DialogContent`'s own `overflow-y-auto max-h-[calc(100dvh-2rem)]` (one scroll
layer, pinned to an integer top → crisp). This also kills the bad UX of a tiny
nested scrollbar.

**Seen on:** the roster-invite "Message to copy & share" `<pre>` (a long
multi-line invite message). It was the only `overflow-y-auto` element in the
`InviteRosterDialog`, hence the only blurry one. NOTE: the zoom-in/out entrance
animation was investigated and ruled out — that scale is transient and does NOT
explain persistent (post-refresh) blur.

**Resolution for the invite message (keep):** the user wants BOTH a compact
preview (whole dialog visible) AND crisp text. Those conflict for a nested
`overflow-y-auto` box — the inner scroll layer composites at a fractional offset
and blurs (confirmed: blur appears only when the `<pre>` has its own scroll,
disappears when it doesn't). The settled design is **clip + expand toggle**, NOT
an inner scrollbar: collapsed = `max-h-40 overflow-hidden` with a bottom gradient
fade (clip → no composited scroll layer → crisp); a "Show full message" button
expands to full height in normal flow, letting the *dialog's own* scroll handle
overflow (that scroll layer pins to an integer top → also crisp). Do NOT
reintroduce `overflow-y-auto`/`overflow-auto` on the message `<pre>` to "let them
scroll the message" — that is exactly what brings the blur back.
