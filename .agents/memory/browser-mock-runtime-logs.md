---
name: Browser mock errors in shared runtime logs
description: Distinguishing isolated browser-fixture failures from real application failures.
---

An isolated browser using mocked API responses can still report runtime errors into the shared development workflow logs.

**Why:** A malformed browser-only response produced an apparent app runtime error in the shared logs, even though real API responses and the public app were healthy.

**How to apply:** When verification uses browser request interception, check the mock response against the actual API contract before changing application code in response to shared runtime errors. Reproduce with real responses before treating a fixture-generated failure as a product bug.
