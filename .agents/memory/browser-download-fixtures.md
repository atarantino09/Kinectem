---
name: Browser download fixture verification
description: Distinguishing unstubbed download failures from browser limitations
---

Native anchor downloads can bypass page-level HTTP mocks. A rendered image and a download event are not enough to prove a usable file was saved.

**Why:** The image may be stubbed while the download reaches the real server and fails with 404. A canceled file save can then be mistaken for a browser or environment restriction.

**How to apply:** Inspect the download request's actual HTTP status and verify nonempty saved bytes with the expected file signature. Use genuine synthetic stored files or fixtures that intercept the application's actual download request. Clearly distinguish tests with mocked photo bytes from verification of object storage.
