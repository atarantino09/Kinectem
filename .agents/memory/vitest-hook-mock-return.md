---
name: Vitest mock-return teardown
description: Hook expression bodies returning mocks can accidentally register cleanup callbacks.
---

Use a block body without a return when resetting a mock in a Vitest beforeEach hook.

**Why:** mockReset returns the mock function itself. Vitest treats a returned function as a teardown callback and invokes it after the test. If the test configures that mock to reject or remain pending, an otherwise passing test fails or times out during cleanup, with a misleading stack pointing to the mocked error.

**How to apply:** Write `beforeEach(() => { fetchMock.mockReset(); });`, not an expression-body hook returning the mock. Check this when a mocked rejection is reported as a test failure despite correct error UI.
