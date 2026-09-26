---
name: Kinectem standalone build environment
description: Why a shell-invoked frontend build needs explicit workflow environment settings.
---

When validating Kinectem with a direct shell build, provide both `PORT` and `BASE_PATH=/app/`; ordinary shell commands do not inherit the managed web workflow's injected environment.

**Why:** A shell build first failed for missing `PORT`, then for missing `BASE_PATH`, despite the running preview workflow having both. The third invocation with both set succeeded.

**How to apply:** Use this only for standalone shell builds. Do not change the workflow or application routing to work around missing shell variables.