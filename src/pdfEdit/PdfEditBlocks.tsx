import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { EditFragment, ParagraphEdit } from "./edits.js";
import type { PdfEditSession } from "./usePdfEditSession.js";

/**
 * The edited paragraphs, as live text over the pages.
 *
 * Each is one `contenteditable` for the whole paragraph, however many pages it
 * crosses, so the caret, selection, undo and input methods are the browser's
 * and behave as they do anywhere else. The browser also does the line
 * breaking: the reflow engine is told how many lines the text wrapped to and
 * never wraps anything itself, which is what keeps the two from disagreeing.
 *
 * A paragraph split across a page break is still one block of text. What makes
 * its lines skip the foot of one page and resume at the head of the next is a
 * float as wide as the block, sized to exactly that distance, which no line
 * box fits beside. Floats can move later lines down and sideways but never
 * back up, which is why a paragraph beside another column is not split.
 *
 * These live in one layer over the whole document rather than inside a page,
 * because the pages are virtualized and a paragraph can belong to two of them.
 */

/** Where a page is in the scrolled content, and how large it is drawn. */
export interface PageGeometry {
  /** CSS px from the content's top to the page's top. */
  top: number;
  /** CSS px per page unit. */
  scale: number;
}

interface PdfEditBlocksProps {
  session: PdfEditSession;
  geometryOf: (page: number) => PageGeometry | null;
}

export default function PdfEditBlocks({ session, geometryOf }: PdfEditBlocksProps) {
  return (
    <>
      {session.edits.map((edit) => (
        <PdfEditBlock key={edit.id} session={session} edit={edit} geometryOf={geometryOf} />
      ))}
    </>
  );
}

/** A fragment of a paragraph, in CSS px within the scrolled content. */
interface Box {
  left: number;
  top: number;
  lines: number;
}

/** Layout engines keep lengths in 64ths of a pixel. A line height that is not
 *  a whole number of them is rounded per line, and forty lines of rounding is
 *  enough to put the last line of a page on the wrong side of a float. */
const snap = (pixels: number) => Math.round(pixels * 64) / 64;
/** Extra width on the text box, so a line the page set full is not wrapped by
 *  a fraction of a pixel of rounding. */
const WIDTH_SLACK_PX = 1;
/** How much taller a fragment's spacer is than its lines. Any positive amount
 *  under a line height keeps a fragment's last line clear of the float below. */
const FLOAT_SLACK_PX = 0.5;

function PdfEditBlock({
  session,
  edit,
  geometryOf,
}: {
  session: PdfEditSession;
  edit: ParagraphEdit;
  geometryOf: (page: number) => PageGeometry | null;
}) {
  const textRef = useRef<HTMLDivElement>(null);
  const probeRef = useRef<HTMLSpanElement>(null);
  const [focused, setFocused] = useState(false);
  const { paragraph } = edit;
  const { updateEdit, removeEdit, focusRequest, clearFocusRequest } = session;

  const home = geometryOf(paragraph.page);
  const scale = home?.scale ?? 1;
  const lineHeight = snap(paragraph.lineHeight * scale);
  const textWidth = paragraph.width * scale + WIDTH_SLACK_PX;
  const boxes = fragmentBoxes(session.fragmentsOf(edit), geometryOf);
  // A cascade waiting on a page's analysis has not placed this paragraph yet.
  // The text stays mounted where it last was: unmounting would drop the caret.
  const lastBoxes = useRef<Box[]>([]);
  if (boxes.length > 0) lastBoxes.current = boxes;
  const shown = lastBoxes.current;

  const font = session.fontOf(edit);
  const textStyle: React.CSSProperties = {
    fontFamily: `"${paragraph.fontName}", ${font.fallback}`,
    fontSize: paragraph.fontSize * scale,
    fontWeight: font.bold ? "bold" : "normal",
    fontStyle: font.italic ? "italic" : "normal",
    lineHeight: `${lineHeight}px`,
    color: edit.color,
  };

  /** Report what the browser made of the text: how many lines, and where in a
   *  line box this type's baseline sits. */
  const measure = useCallback(() => {
    const text = textRef.current;
    const probe = probeRef.current;
    if (!text || !probe?.parentElement) return;
    const lineCount = countLines(text, lineHeight);
    const ascent =
      (probe.getBoundingClientRect().top - probe.parentElement.getBoundingClientRect().top) / scale;
    const changed =
      lineCount !== edit.lineCount || edit.ascent === null || Math.abs(ascent - edit.ascent) > 0.01;
    if (changed) updateEdit(edit.id, { lineCount, ascent });
  }, [edit.id, edit.lineCount, edit.ascent, lineHeight, scale, updateEdit]);

  // The text is the browser's while it is mounted: React writes it once and
  // reads it back, and never re-renders it under the caret.
  useLayoutEffect(() => {
    const text = textRef.current;
    if (!text) return;
    text.textContent = edit.text;
    return () => updateEdit(edit.id, { text: text.innerText });
    // `edit.text` is deliberately not a dependency: it is written once, at mount.
  }, [edit.id, updateEdit]);

  // Before paint, so the lines around a paragraph never show at the position
  // its previous height put them.
  useLayoutEffect(measure, [measure, textWidth, paragraph.fontSize]);

  // An embedded font registers when its page first renders, which can be after
  // this block mounted in the fallback face.
  useEffect(() => {
    document.fonts.addEventListener("loadingdone", measure);
    return () => document.fonts.removeEventListener("loadingdone", measure);
  }, [measure]);

  useLayoutEffect(() => {
    const text = textRef.current;
    if (!text || focusRequest?.editId !== edit.id) return;
    text.focus({ preventScroll: true });
    placeCaret(text, focusRequest.clientX, focusRequest.clientY);
    clearFocusRequest();
  }, [focusRequest, edit.id, clearFocusRequest]);

  const left = Math.min(...shown.map((box) => box.left));
  const widest = Math.max(...shown.map((box) => box.left)) - left;

  return (
    <div
      className="pdf-edit-block"
      style={{
        left: shown.length > 0 ? left : 0,
        top: shown[0]?.top ?? 0,
        width: textWidth + (shown.length > 0 ? widest : 0),
        visibility: shown.length > 0 ? "visible" : "hidden",
      }}
    >
      {shown.map((box, index) => {
        const next = shown[index + 1];
        const height = box.lines * lineHeight;
        const indent = box.left - left;
        return (
          <FragmentFloats
            key={index}
            height={height + FLOAT_SLACK_PX}
            indentLeft={indent}
            indentRight={widest - indent}
            gapBelow={next ? next.top - (box.top + height) - FLOAT_SLACK_PX : 0}
          />
        );
      })}
      <div
        ref={textRef}
        className="pdf-edit-text"
        contentEditable="plaintext-only"
        suppressContentEditableWarning
        spellCheck={false}
        style={{
          ...textStyle,
          textAlign: paragraph.align,
          textIndent: paragraph.indent * scale,
        }}
        onInput={measure}
        onFocus={() => setFocused(true)}
        onBlur={(event) => {
          setFocused(false);
          updateEdit(edit.id, { text: event.currentTarget.innerText });
        }}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          removeEdit(edit.id);
        }}
      />
      {/* Same type, out of flow: where its baseline falls is where the text's
          does, without putting a measuring element inside editable content. */}
      <div className="pdf-edit-probe" style={textStyle} aria-hidden>
        <span ref={probeRef} />
      </div>
      {focused &&
        shown.map((box, index) => (
          <div
            key={`outline-${index}`}
            className="pdf-edit-outline"
            style={{
              left: box.left - left,
              top: box.top - shown[0].top,
              width: textWidth,
              height: box.lines * lineHeight,
            }}
          />
        ))}
    </div>
  );
}

/** The floats that confine one fragment's lines to its place: a spacer down
 *  its left as tall as its lines, a second down its right when a later
 *  fragment sits further in, and below both a full-width float across the
 *  distance to the next fragment. */
function FragmentFloats({
  height,
  indentLeft,
  indentRight,
  gapBelow,
}: {
  height: number;
  indentLeft: number;
  indentRight: number;
  gapBelow: number;
}) {
  return (
    <>
      <div className="pdf-edit-float" style={{ float: "left", clear: "both", width: indentLeft, height }} />
      {indentRight > 0 && (
        <div className="pdf-edit-float" style={{ float: "right", width: indentRight, height }} />
      )}
      {gapBelow > 0 && (
        <div
          className="pdf-edit-float"
          style={{ float: "left", clear: "both", width: "100%", height: gapBelow }}
        />
      )}
    </>
  );
}

function fragmentBoxes(
  fragments: EditFragment[],
  geometryOf: (page: number) => PageGeometry | null,
): Box[] {
  const boxes: Box[] = [];
  for (const fragment of fragments) {
    const geometry = geometryOf(fragment.page);
    if (!geometry) continue;
    boxes.push({
      left: fragment.x * geometry.scale,
      top: geometry.top + fragment.y * geometry.scale,
      lines: fragment.lines,
    });
  }
  return boxes;
}

/** How many lines the text wrapped to. Counted from where its line boxes are
 *  rather than from the element's height, which includes every page break the
 *  paragraph crosses. */
function countLines(text: HTMLElement, lineHeight: number): number {
  const range = document.createRange();
  range.selectNodeContents(text);
  const tops: number[] = [];
  for (const rect of range.getClientRects()) {
    if (rect.height === 0) continue;
    if (!tops.some((top) => Math.abs(top - rect.top) < lineHeight / 2)) tops.push(rect.top);
  }
  return Math.max(1, tops.length);
}

/** Put the caret where the click that opened the edit landed. */
function placeCaret(text: HTMLElement, clientX: number, clientY: number): void {
  const range = caretRangeAt(clientX, clientY);
  if (!range || !text.contains(range.startContainer)) return;
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function caretRangeAt(clientX: number, clientY: number): Range | null {
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
