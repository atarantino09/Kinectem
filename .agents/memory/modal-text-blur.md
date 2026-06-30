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
pixels. Drop the `slide-in/out-*` classes (translate transform) AND the
`zoom-in/out-95` scale classes — **entrance/exit should be fade-only**. Keep
just `data-[state=open]:animate-in fade-in-0` / `data-[state=closed]:animate-out
fade-out-0`.

**Why:** users repeatedly reported "text looks a little blurry" only inside
modals; native-resolution screenshots of the rest of the app were crisp. Two
distinct causes, both fixed: (1) the `-translate-1/2` centering lands odd-sized
boxes on a half-pixel; (2) the `zoom-in-95` entrance scales the dialog up, so
the browser rasterizes its text as a **scaled bitmap during the pop-in** and it
looks blurry until the animation settles — worst on dense small text (e.g. the
roster-invite "copy & share" message `<pre>`).

**How to apply:** if you re-add a modal primitive, copy from another artifact,
or `npx shadcn add dialog`, re-apply the flex-centering wrapper AND strip the
zoom scale — the upstream shadcn template brings back both the translate
centering and the `zoom-in-95` scale, and the blur with them.
Wrapper is `pointer-events-none`, content `pointer-events-auto`, so Radix
outside-click dismissal + focus trap still work.
