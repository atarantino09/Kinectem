---
name: API workflow port ownership
description: Managed API workflow restarts can leave an older watcher listening
---

If the managed API workflow reports running but its logs show `EADDRINUSE`, do not assume the newly started server is serving requests. Check which process owns the API port; an older `tsx watch` process may survive the restart and keep serving from a previous workflow session.

**Why:** A managed restart started a new watcher while a previous watcher and its child still held the port. The workflow appeared running even though the new child could not listen.

**How to apply:** Confirm port ownership and a clean "Server listening" log before verifying code changes. Clear only the positively identified stale process group, then restart the existing managed workflow; do not create a duplicate workflow or change its port.

Vite workflows can have the same leftover-process problem, but may silently
select the next port instead of failing. Confirm that the ready URL uses the
artifact's configured port, not just that Vite reports ready.

**Why:** A surviving frontend listener can keep the preview attached to the
older workflow while the replacement starts on a different port.