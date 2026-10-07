---
name: Long-picker browser verification
description: Distinguish browser automation-session failures from real UI failures in large admin lists.
---

A stalled browser-automation command does not establish that a long admin picker has frozen. Confirm actual app responsiveness before changing pagination or introducing virtualization.

**Why:** Long team-directory verification stalled and reset the automation notebook immediately after a successful continuation response. The live API was healthy; an isolated browser context and lightweight synchronous DOM checks confirmed the complete list, responsive sticky controls, and successful desktop/mobile assignment flows.

**How to apply:** Inspect the request result and page errors, use a fresh isolated context when the automation session becomes unreliable, and prefer bounded scrolling plus small DOM counts over large locator/snapshot operations. Limit recovery to the failed or unverified flow rather than repeating a whole browser pass.
