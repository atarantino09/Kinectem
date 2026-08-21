---
name: Tour dropdown portal testing
description: Testing guidance for SpotlightTour steps that programmatically open Radix dropdown menus.
---

When a SpotlightTour step opens a Radix DropdownMenu programmatically, use a component test to verify the tour card and the trigger's controlled open state, then use a real-browser test to verify the portaled menu item is visible and highlighted.

**Why:** The tour portal and Radix dropdown portal interact differently in JSDOM: the controlled trigger can report expanded while the content item is not discoverable in the component test, even though the live browser renders the open menu and both spotlight targets correctly.

**How to apply:** Keep menu state controlled by the owning page, close it when the tour advances away or completes, and cover the final visual/tour behavior with a browser test rather than adding brittle `forceMount` behavior solely for JSDOM.