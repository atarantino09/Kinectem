---
name: user-event clipboard mocks
description: How Testing Library user-event affects clipboard mocks in JSDOM tests.
---

In JSDOM tests using Testing Library, call `userEvent.setup()` before spying on `navigator.clipboard.writeText`.

**Why:** `userEvent.setup()` installs its own clipboard stub. A mock attached before setup can be replaced, making successful copy behavior appear to have made zero calls.

**How to apply:** Create the user-event instance first, then spy on the resulting clipboard object's `writeText` method before rendering or clicking the copy control.