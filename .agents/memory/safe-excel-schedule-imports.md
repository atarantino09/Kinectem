---
name: Safe Excel schedule imports
description: Security and date-integrity rules for converting organizer XLSX files into the existing CSV import contract.
---

Do not use the legacy `xlsx` npm package for user-selected workbooks; its last npm release has unresolved high-severity parser vulnerabilities. Bound workbook size before reading, use a maintained patched parser, and lazy-load it so ordinary page visits do not download the spreadsheet engine.

When converting an XLSX workbook into CSV for an existing CSV API, canonicalize genuine Excel date cells from their underlying date value to `YYYY-MM-DD`. Preserve displayed/formatted values for non-date cells.

**Why:** Excel caches localized display text such as `03/10/2026`. Passing that text to a server using generic date parsing can silently swap day and month, while unbounded workbook parsing exposes the browser to resource exhaustion.

**How to apply:** Use these rules for any browser-side XLSX-to-CSV compatibility layer. Test native date cells with US, day-first, and custom formats, plus empty, malformed, oversized, and same-file retry behavior.

Competition schedule limits must move together across the browser file cap,
validated CSV string, route-specific JSON parser, and maximum row count. Keep the
larger parser attached only to competition import routes; unrelated API requests
must retain the global body limit. Large previews should return exact counts but
bounded samples, and database writes should use bounded batches.

**Why:** Raising only the row count leaves league exports blocked by a different
layer, while globally relaxing JSON limits expands resource-exhaustion risk.
Returning or rendering every diff row also makes a valid large preview itself a
browser and network hazard.

**How to apply:** Whenever a competition schedule limit changes, review all four
limits together and test a request above the global body limit, the exact row
boundary, the first rejected row, preview non-destructiveness, and idempotent
batched re-imports.