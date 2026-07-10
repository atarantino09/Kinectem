---
name: Radix popper max-height on mobile
description: Never override Select/DropdownMenu content max-h with fixed values; cap against the Radix available-height var or mobile clips/can't scroll.
---

**Rule:** Any `max-h` override on a Radix popper content (shadcn `SelectContent`, `DropdownMenuContent`) must include the Radix available-height var in a `min()`, e.g. `max-h-[min(var(--radix-select-content-available-height),24rem)]` (dropdown-menu uses `--radix-dropdown-menu-content-available-height`). Never a bare fixed cap like `max-h-72`, `max-h-[480px]`, or `min(60vh,24rem)`.

**Why:** The shadcn base classes already cap at the available-height var, but tailwind-merge lets a local `max-h-*` override win. A fixed cap (esp. `vh`-based — iOS `vh` includes the collapsed URL-bar area) can exceed the real available space, so the popper extends past the viewport edge on phones: the signup DOB month list rendered clipped above Safari's URL bar and the top options (January) were unreachable/unscrollable.

**How to apply:** When shrinking a long dropdown, wrap the desired cap with the var: `min(var(--radix-…-available-height), <cap>)`. Verified pattern via Playwright at 400x720: listbox bounding box stays in viewport and inner scroll reaches first/last options.
