---
name: Team banner cropping
description: Team hero photos use one compact fixed aspect and are user-cropped before upload.
---

Team hero photos and all team-photo previews use the same compact 16:5 frame. Create team, the inline header selector, and Edit team must open the reusable banner-shaped crop dialog before compression, staging, or upload.

**Why:** Adaptive portrait-aware frames made the top of team pages expand unpredictably. Admin-controlled drag and zoom preserves intentional framing while keeping page geometry consistent.

**How to apply:** Keep banner aspect shared across display, previews, and cropper. Process only confirmed cropped output through existing validation, compression, size-limit, staging/PATCH, and error flows. Cancel preserves the current photo; upload failures reject so the cropper stays open for retry.
