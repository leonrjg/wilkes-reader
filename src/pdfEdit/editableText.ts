/**
 * The DOM side of editable text: where the caret is, as a number.
 *
 * The editor thinks of a paragraph's text as one string and of a caret as an
 * offset into it. The browser thinks of text nodes and (node, offset) pairs.
 * Everything that crosses between the two is here, so the components never
 * walk the DOM themselves.
 */

function textNodes(root: Node): Text[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node as Text);
  return nodes;
}

/** How much text an element holds. */
export function textLength(root: Node): number {
  return textNodes(root).reduce((total, node) => total + node.length, 0);
}

/** A DOM position inside `root`, as an offset into its text. A position on an
 *  element rather than in a text node counts the text before it. */
export function textOffsetOf(root: Node, node: Node, offset: number): number {
  const range = document.createRange();
  range.selectNodeContents(root);
  range.setEnd(node, offset);
  return range.toString().length;
}

/** The DOM position at an offset into `root`'s text. */
export function positionAt(root: Node, offset: number): { node: Node; offset: number } {
  let remaining = Math.max(0, offset);
  const nodes = textNodes(root);
  for (const node of nodes) {
    if (remaining <= node.length) return { node, offset: remaining };
    remaining -= node.length;
  }
  const last = nodes[nodes.length - 1];
  return last ? { node: last, offset: last.length } : { node: root, offset: 0 };
}

/** Select from one offset into `root`'s text to another. */
export function selectText(root: Node, anchor: number, focus: number): void {
  const selection = window.getSelection();
  if (!selection) return;
  const from = positionAt(root, anchor);
  const to = positionAt(root, focus);
  selection.setBaseAndExtent(from.node, from.offset, to.node, to.offset);
}

/** The line boxes of an element's text, top to bottom. Several client rects
 *  on one line -- one per text node, one per justified word -- are one line. */
export function lineRects(root: Node): DOMRect[] {
  const range = document.createRange();
  range.selectNodeContents(root);
  const lines: DOMRect[] = [];
  for (const rect of range.getClientRects()) {
    if (rect.height === 0) continue;
    const line = lines.find(
      (candidate) => Math.abs(candidate.top - rect.top) < Math.min(candidate.height, rect.height) / 2,
    );
    if (!line) {
      lines.push(DOMRect.fromRect(rect));
      continue;
    }
    const left = Math.min(line.left, rect.left);
    const right = Math.max(line.right, rect.right);
    line.x = left;
    line.width = right - left;
  }
  return lines.sort((a, b) => a.top - b.top);
}

/** Where the caret is on screen, or null when the selection is a range or the
 *  browser will not say (it reports nothing for a caret in an empty line). */
export function caretRect(): DOMRect | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  const rect = range.getClientRects()[0] ?? range.getBoundingClientRect();
  return rect.height > 0 ? rect : null;
}

/** Put the caret at the text position nearest a point, if that is in `root`. */
export function placeCaretAtPoint(root: Node, clientX: number, clientY: number): boolean {
  const range = rangeAtPoint(clientX, clientY);
  if (!range || !root.contains(range.startContainer)) return false;
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  return true;
}

function rangeAtPoint(clientX: number, clientY: number): Range | null {
  const position = document.caretPositionFromPoint?.(clientX, clientY);
  if (position) {
    const range = document.createRange();
    range.setStart(position.offsetNode, position.offset);
    range.collapse(true);
    return range;
  }
  // WebKit has only the older name.
  return document.caretRangeFromPoint?.(clientX, clientY) ?? null;
}
