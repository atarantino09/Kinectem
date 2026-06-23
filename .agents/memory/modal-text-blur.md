---
name: Modal text blur (dialog centering)
description: Why shadcn Dialog/AlertDialog in kinectem center with flexbox, not the translate trick.
---

# Modal text blur — center with flex, not `-translate-1/2`

The shadcn `DialogContent` / `AlertDialogContent` default centers with
`fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2`. When the modal's
width or height is an **odd** number of pixels (height almost always is, since
it's content-driven), `-50%` resolves to a half-pixel offset and the browser
rasterizes the box on a sub-pixel boundary → its **text renders blurry**.

**Rule:** center modal content with a flex wrapper
(`fixed inset-0 flex items-center justify-center`) so the box lands on whole
pixels. Keep `zoom`/`fade` enter-exit animations, but drop the
`slide-in/out-*` classes — those reintroduce a translate transform.

**Why:** users repeatedly reported "text looks a little blurry" only inside
modals; native-resolution screenshots of the rest of the app were crisp.

**How to apply:** if you re-add a modal primitive, copy from another artifact,
or `npx shadcn add dialog`, re-apply the flex-centering wrapper — the upstream
shadcn template will bring back the translate centering and the blur with it.
Wrapper is `pointer-events-none`, content `pointer-events-auto`, so Radix
outside-click dismissal + focus trap still work.
