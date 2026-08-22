---
name: JSDOM file reads
description: Cross-browser and JSDOM guidance for reading files selected through web file inputs
---

Use the browser-native FileReader API when a file-upload flow needs to read text and must also run in the project's JSDOM tests. Do not assume File.text() exists in the test environment.

**Why:** The installed JSDOM File implementation can lack File.text(), causing an uncaught async error even though the same code works in a real browser.

**How to apply:** Resolve FileReader.onload with its string result, reject or toast from FileReader.onerror, and reset the input value after capturing the selected file so the same file can be chosen again.