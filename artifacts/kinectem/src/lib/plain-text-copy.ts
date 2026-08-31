import type { ClipboardEvent } from "react";

/**
 * Keep manually selected copy operations portable across rich-text editors.
 * Browsers may otherwise place an HTML representation of the rendered preview
 * on the clipboard, which external team tools and email clients can interpret
 * differently from the visible text.
 */
export function copySelectionAsPlainText(
  event: ClipboardEvent<HTMLElement>,
): void {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) return;

  const container = event.currentTarget;
  if (
    !container.contains(selection.anchorNode) ||
    !container.contains(selection.focusNode)
  ) {
    return;
  }

  event.clipboardData.clearData();
  event.clipboardData.setData("text/plain", selection.toString());
  event.preventDefault();
}