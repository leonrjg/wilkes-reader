import { useEffect, useRef } from "react";
import { PARAGRAPH_HOST } from "./caretTravel.js";
import { textOffsetOf } from "./editableText.js";
import { estimatedAscent } from "./edits.js";
import type { PageGeometry } from "./PdfEditLayer.js";
import type { Paragraph } from "./paragraphs.js";
import { lineHeightPx, pageFace, paragraphTextStyle } from "./paragraphStyle.js";
import type { PdfEditSession, PendingInput } from "./usePdfEditSession.js";

/**
 * A paragraph nobody has changed: the page's own rendering, with a caret.
 *
 * The page keeps drawing the paragraph. Over each of its lines sits the same
 * text, invisible and editable, so a click puts a caret between two letters
 * and a selection covers words -- but there is nothing to see until the reader
 * types. Only then is the paragraph taken from the page and set as live text
 * (`LiveParagraph`); the keystroke that asked for it is passed along and
 * happens there.
 *
 * This is what lets every paragraph be editable without every paragraph being
 * re-set: one the reader only passes through keeps the page's exact line
 * breaks, kerning and inline type.
 */

interface PageParagraphProps {
  session: PdfEditSession;
  paragraph: Paragraph;
  geometryOf: (page: number) => PageGeometry | null;
}

export default function PageParagraph({ session, paragraph, geometryOf }: PageParagraphProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const { beginEdit } = session;

  // Native listeners: React's `onBeforeInput` is its own synthesis from key
  // events, and has neither an input type nor the range it applies to.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const handOver = (anchor: number, focus: number, input: PendingInput | null) =>
      beginEdit(paragraph, { anchor, focus, input });

    const onBeforeInput = (event: InputEvent) => {
      // The text here is the page's and stays the page's: nothing is ever
      // typed into this element.
      event.preventDefault();
      if (event.inputType.startsWith("history") || event.inputType.startsWith("format")) return;
      const range = event.getTargetRanges()[0] ?? window.getSelection()?.getRangeAt(0);
      if (!range) return;
      const start = offsetIn(host, paragraph, range.startContainer, range.startOffset);
      const end = offsetIn(host, paragraph, range.endContainer, range.endOffset);
      const input = pendingInput(event);
      // A deletion with nothing in range is Backspace at the paragraph's first
      // character or Delete at its last: nothing of this paragraph goes.
      if (input.kind === "delete" && start === end) return;
      handOver(start, end, input);
    };

    // A composition cannot be cancelled and replayed, so the paragraph is
    // handed over as it starts and the composition begins again in live text.
    const onCompositionStart = () => {
      const selection = window.getSelection();
      if (!selection?.anchorNode || !selection.focusNode) return;
      handOver(
        offsetIn(host, paragraph, selection.anchorNode, selection.anchorOffset),
        offsetIn(host, paragraph, selection.focusNode, selection.focusOffset),
        null,
      );
    };

    host.addEventListener("beforeinput", onBeforeInput);
    host.addEventListener("compositionstart", onCompositionStart);
    return () => {
      host.removeEventListener("beforeinput", onBeforeInput);
      host.removeEventListener("compositionstart", onCompositionStart);
    };
  }, [paragraph, beginEdit]);

  const face = pageFace(paragraph.fontName, session.fontOf(paragraph.page, paragraph.fontName));
  const ascent = estimatedAscent(paragraph);
  const lines = paragraph.lines.map((line, index) => {
    const at = session.locate(line.itemId);
    const geometry = at && geometryOf(at.page);
    if (!at || !geometry) return null;
    const { scale } = geometry;
    return (
      <div
        key={index}
        data-line={index}
        style={{
          ...paragraphTextStyle(paragraph, face, scale),
          left: (at.x + line.inset) * scale,
          top: geometry.top + (at.y + line.baselineOffset - ascent) * scale,
          width: line.width * scale,
          height: lineHeightPx(paragraph, scale),
        }}
      >
        {line.text}
      </div>
    );
  });
  // Not placed yet: its page's layout is still waiting on an analysis.
  if (lines.every((line) => line === null)) return null;

  return (
    <div
      ref={hostRef}
      className="pdf-edit-page-text"
      style={{ caretColor: paragraph.color }}
      contentEditable="plaintext-only"
      suppressContentEditableWarning
      spellCheck={false}
      {...{ [PARAGRAPH_HOST]: "" }}
    >
      {lines}
    </div>
  );
}

function pendingInput(event: InputEvent): PendingInput {
  if (event.inputType.startsWith("delete")) return { kind: "delete" };
  if (event.inputType === "insertParagraph" || event.inputType === "insertLineBreak") {
    return { kind: "insert", text: "\n" };
  }
  return { kind: "insert", text: event.data ?? event.dataTransfer?.getData("text/plain") ?? "" };
}

/** A DOM position over the page's lines, as an offset into the paragraph's
 *  text. The two differ wherever a line ended in a typesetter's hyphen, and by
 *  the space that joins one line to the next. */
function offsetIn(host: HTMLElement, paragraph: Paragraph, node: Node, offset: number): number {
  const element = node instanceof Element ? node : node.parentElement;
  const lineElement = element?.closest<HTMLElement>("[data-line]");
  if (!lineElement) {
    // On the host itself, between two lines: the start of the line after.
    const next = node === host ? host.children[offset] : undefined;
    const index = next instanceof HTMLElement ? Number(next.dataset.line) : NaN;
    return paragraph.lines[index]?.start ?? paragraph.text.length;
  }
  const line = paragraph.lines[Number(lineElement.dataset.line)];
  return line.start + Math.min(textOffsetOf(lineElement, node, offset), line.kept);
}
