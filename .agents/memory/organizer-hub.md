---
name: Competition organizer hub
description: Parent-company hub grouping competitions — branding copy semantics.
---

- **Hub branding is COPIED onto a competition at creation, not referenced.**
  - **Why:** later hub rebrands must never silently restyle past competitions; detaching keeps the copied branding on purpose.
  - **How to apply:** never "optimize" by joining organizer branding at read time; when the create wizard pre-selects a hub, the client must hydrate its branding step with the same values or a partial edit will null out inherited fields.
