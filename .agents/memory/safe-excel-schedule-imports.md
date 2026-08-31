---
name: Safe Excel schedule imports
description: Security and date-integrity rules for converting organizer XLSX files into the existing CSV import contract.
---

Do not use the legacy `xlsx` npm package for user-selected workbooks; its last npm release has unresolved high-severity parser vulnerabilities. Bound workbook size before reading, use a maintained patched parser, and lazy-load it so ordinary page visits do not download the spreadsheet engine.

When converting an XLSX workbook into CSV for an existing CSV API, canonicalize genuine Excel date cells from their underlying date value to `YYYY-MM-DD`. Preserve displayed/formatted values for non-date cells.

**Why:** Excel caches localized display text such as `03/10/2026`. Passing that text to a server using generic date parsing can silently swap day and month, while unbounded workbook parsing exposes the browser to resource exhaustion.

**How to apply:** Use these rules for any browser-side XLSX-to-CSV compatibility layer. Test native date cells with US, day-first, and custom formats, plus empty, malformed, oversized, and same-file retry behavior.