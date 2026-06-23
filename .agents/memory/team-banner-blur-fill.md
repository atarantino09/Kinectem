---
name: Team banner blur-fill display
description: Team hero photos are shown whole (no crop) via a blur-fill backdrop; team upload flows deliberately omit a crop step.
---

Team hero photos (and their upload previews) are shown **whole**, fitted inside the wide banner with a blurred copy of the same image filling the leftover space — never cropped to the banner aspect with `object-cover`.

**Why:** A wide 16:5 banner can't show a tall group/team photo cropped without cutting off heads/legs. The user explicitly chose "fit the whole photo, slight blur outside it" over edge-to-edge cover or a taller header.

**How to apply:** Team-photo upload flows intentionally have **no crop step** — they upload the original (aspect preserved) at the banner quality budget. Don't reintroduce a fixed-aspect crop for team photos. If you add any fixed-aspect display for arbitrary user-supplied photos elsewhere, prefer the same blur-fill approach over `object-cover` cropping. (The generic crop dialog still exists for avatars — that's fine.)
