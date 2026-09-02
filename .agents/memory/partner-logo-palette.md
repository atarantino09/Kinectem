---
name: Partner logo palette
description: Product rule for deriving partner landing-page colors from uploaded logos without clobbering intentional customization.
---

Partner landing-page primary and secondary colors should be derived from the
uploaded partner logo rather than left at generic defaults. Keep both colors
editable after extraction. If a logo yields only one usable color, use it for
both stops so the public page gets a valid solid-color treatment.

Existing pages may replace the generic default pair from their saved logo, but
must not overwrite colors an admin has already customized.

**Why:** The user explicitly wants partner branding to reflect the partner's
logo, while manual adjustments remain necessary for edge cases and contrast.

**How to apply:** Reuse the established client-side logo color extractor for
partner branding flows. Trigger it for uploaded inline images, and treat any
non-default saved palette as authoritative.