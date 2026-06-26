---
name: Tailwind v4 bare CSS-var arbitrary values
description: Why `max-h-[--foo]` silently breaks in Tailwind v4 and how to spot/fix it.
---

# Tailwind v4 dropped the bare CSS-variable arbitrary-value shorthand

In Tailwind v3 you could write `max-h-[--radix-select-content-available-height]` and it
compiled to `max-height: var(--radix-...)`. **Tailwind v4 does NOT** — it emits the
literal `max-height: --radix-...` (no `var()`), which is invalid CSS, so the declaration
is dropped silently.

**Symptom seen here:** the profile "All teams" filter (a Radix `Select`) and any other
shadcn primitive whose `*Content` relied on `max-h-[--radix-*-available-height]` got NO
max-height, so `overflow-y-auto` had nothing to constrain → long lists didn't scroll and
you couldn't reach the bottom.

**Fix:** use the explicit `var()` form `max-h-[var(--radix-...)]` (or v4's paren shorthand
`max-h-(--radix-...)`). The codebase's `dropdown-menu.tsx` already uses the working
`[var(--...)]` form — match it.

**Why:** this project runs Tailwind v4 (`@import "tailwindcss"` + `@tailwindcss/vite`),
where the bare `[--foo]` syntax changed.

**How to apply / detect:** `rg -n "\-\[--" artifacts/*/src` finds suspects. Verify by
compiling: `npx @tailwindcss/cli -i in.css -o out.css` (with `@source` pointing at an
html file containing the class) and grep the output — a valid rule shows `var(...)`, a
broken one shows the bare `--name`. Remaining cosmetic-only offenders are the
`origin-[--radix-*-transform-origin]` classes in select/tooltip/dropdown-menu (animation
origin only; left as-is, out of scope for the scroll fix).
