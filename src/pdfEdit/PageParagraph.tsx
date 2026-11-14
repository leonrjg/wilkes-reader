import { useEffect, useRef } from "react";
import { PARAGRAPH_HOST } from "./caretTravel.js";
import type { RegisterParagraph } from "./editInput.js";
import { textOffsetOf } from "./editableText.js";
import { estimatedAscent } from "./edits.js";
import type { PageGeometry } from "./PdfEditLayer.js";
import type { Paragraph } from "./paragraphs.js";
import { lineHeightPx, pageFace, paragraphTextStyle } from "./paragraphStyle.js";
import type { PdfEditSession } from "./usePdfEditSession.js";

/**
 * A paragraph nobody has changed: the page's own rendering, with a caret.
 *
 * The page keeps drawing the paragraph. Over each of its lines sits the same
 * text, invisible, so a click puts a caret between two letters and a selection
 * covers words -- but there is nothing to see until the reader types. Only
 * then is the paragraph taken from the page and set as live text
 * (`LiveParagraph`); the keystroke that asked for it is passed along and
 * happens there. Nothing is ever typed into this.
 *
 * This is what lets every paragraph be editable without every paragraph being
 * re-set: one the reader only passes through keeps the page's exact line
 * breaks, kerning and inline type.
 */

interface PageParagraphProps {
  session: PdfEditSession;
  paragraph: Paragraph;
  geometryOf: (page: number) => PageGeometry | null;
  register: RegisterParagraph;
}

export default function PageParagraph({ session, paragraph, geometryOf, register }: PageParagraphProps) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = hostRef.current;
    if (!element) return;
    return register({
      element,
      slot: () => ({ paragraph, edit: null }),
      offsetOf: (node, offset) => offsetIn(element, paragraph, node, offset),
      runs: () => paragraph.runs,
    });
  }, [register, paragraph]);

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
  // With no lines when it is not placed yet: its page's layout is still
  // waiting on an analysis.
  return (
    <div
      ref={hostRef}
      className="pdf-edit-page-text"
      style={{ caretColor: paragraph.color }}
      {...{ [PARAGRAPH_HOST]: "" }}
    >
      {lines}
    </div>
  );
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
