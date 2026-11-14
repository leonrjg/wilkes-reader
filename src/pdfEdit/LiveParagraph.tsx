import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { PARAGRAPH_HOST } from "./caretTravel.js";
import type { RegisterParagraph } from "./editInput.js";
import { insertPlainText, lineRects, selectText, textOffsetOf } from "./editableText.js";
import { estimatedAscent, type EditFragment, type ParagraphEdit } from "./edits.js";
import { layoutFragments, type FragmentBox } from "./fragmentFloats.js";
import type { PageGeometry } from "./PdfEditLayer.js";
import { lineHeightPx, liveFace, paragraphTextStyle } from "./paragraphStyle.js";
import type { RunStyle } from "./paragraphs.js";
import { readRuns, restyleRuns, sameRuns, styleIndexOf, writeRuns } from "./styledText.js";
import { typesetText } from "./typeset.js";
import type { Handoff, PdfEditSession } from "./usePdfEditSession.js";

/**
 * A paragraph the reader has changed, as live text over the pages.
 *
 * It is one run of text for the whole paragraph, however many pages it
 * crosses, so the caret, selection, undo and input methods are the browser's
 * and behave as they do anywhere else. The browser also does the line
 * breaking: the reflow engine is told how many lines the text wrapped to and
 * never wraps anything itself, which is what keeps the two from disagreeing.
 *
 * A paragraph whose lines stand in more than one place -- across a page break,
 * across two columns -- is still one block of text; `fragmentFloats` is what
 * makes its lines skip from each place to the next.
 */

interface LiveParagraphProps {
  session: PdfEditSession;
  edit: ParagraphEdit;
  geometryOf: (page: number) => PageGeometry | null;
  register: RegisterParagraph;
}

/** Extra width on the text box, so a line the page set full is not wrapped by
 *  a fraction of a pixel of rounding. */
const WIDTH_SLACK_PX = 1;
/** How long typing has to pause before what was typed is copied out of the
 *  DOM. Long enough not to run on every keystroke, short enough that little is
 *  lost if the reader leaves. */
const REMEMBER_DELAY_MS = 400;
export default function LiveParagraph({ session, edit, geometryOf, register }: LiveParagraphProps) {
  const textRef = useRef<HTMLDivElement>(null);
  const probeRef = useRef<HTMLSpanElement>(null);
  const { paragraph } = edit;
  const { updateEdit, removeEdit, handoff, clearHandoff } = session;

  const scale = geometryOf(paragraph.page)?.scale ?? 1;
  const lineHeight = lineHeightPx(paragraph, scale);
  const textWidth = paragraph.width * scale + WIDTH_SLACK_PX;
  const boxes = fragmentBoxes(session.fragmentsOf(edit), geometryOf);
  // A cascade waiting on a page's analysis has not placed this paragraph yet.
  // The text stays mounted where it last was: unmounting would drop the caret.
  const lastBoxes = useRef<FragmentBox[]>([]);
  if (boxes.length > 0) lastBoxes.current = boxes;
  const shown = lastBoxes.current;

  const liveFontOf = (style: RunStyle) => session.liveFontOf(paragraph.page, style);
  const faceOf = (style: RunStyle) =>
    liveFace(style.fontName, session.fontOf(paragraph.page, style.fontName), liveFontOf(style));
  const textStyle = {
    ...paragraphTextStyle(paragraph, faceOf(paragraph.styles[paragraph.baseStyle]), scale),
    color: paragraph.color,
  };
  // Which whole fonts have arrived: a string, so an effect can depend on it.
  const facesReady = paragraph.styles.map((style) => liveFontOf(style)?.family ?? "").join("|");

  // What the text says now. Read against the paragraph as it is when asked,
  // not as it was when whoever asks was set up: its styles can have grown.
  const paragraphRef = useRef(paragraph);
  paragraphRef.current = paragraph;
  const readNow = useCallback(
    () => (textRef.current ? readRuns(textRef.current, paragraphRef.current) : null),
    [],
  );

  /** Report what the browser made of the text: how many lines, and where in a
   *  line box this type's baseline sits. */
  const measure = useCallback(() => {
    const text = textRef.current;
    const probe = probeRef.current;
    if (!text || !probe?.parentElement) return;
    const lineCount = Math.max(1, lineRects(text).length);
    const ascent =
      (probe.getBoundingClientRect().top - probe.parentElement.getBoundingClientRect().top) / scale;
    const changed =
      lineCount !== edit.lineCount || edit.ascent === null || Math.abs(ascent - edit.ascent) > 0.01;
    if (changed) updateEdit(edit.id, { lineCount, ascent });
  }, [edit.id, edit.lineCount, edit.ascent, scale, updateEdit]);

  // The text is the browser's while it is mounted: React writes it when the
  // paragraph is taken over, and again only when what it says is changed from
  // outside it -- cut in two, it keeps its first half. It never re-renders it
  // under the caret for anything the reader typed.
  useLayoutEffect(() => {
    if (textRef.current) writeRuns(textRef.current, edit.runs, paragraph, faceOf);
    // Neither the runs nor the faces are dependencies: both change with what
    // is typed here and elsewhere, and none of that is a reason to rewrite.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edit.id, edit.revision]);

  // On the way out, what it said is copied back for whoever mounts it next.
  useLayoutEffect(() => {
    const text = textRef.current;
    if (!text) return;
    return () => updateEdit(edit.id, { runs: readRuns(text, paragraphRef.current) });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per mount
  }, [edit.id, updateEdit]);

  // What the input handling needs of this paragraph. When the caret leaves,
  // a paragraph back to saying what the page says is given back to the page,
  // which sets it better than this can. Not one that is half of a split or
  // the whole of a join: its being here is the change.
  const editRef = useRef(edit);
  editRef.current = edit;
  useEffect(() => {
    const element = textRef.current;
    if (!element) return;
    return register({
      element,
      slot: () => ({ paragraph: editRef.current.paragraph, edit: editRef.current }),
      offsetOf: (node, offset) => textOffsetOf(element, node, offset),
      runs: () => readRuns(element, paragraphRef.current),
      settle: () => {
        const runs = readRuns(element, paragraphRef.current);
        const current = editRef.current;
        if (!current.structural && sameRuns(runs, current.paragraph.runs)) removeEdit(current.id);
        else updateEdit(current.id, { runs });
      },
    });
  }, [register, removeEdit, updateEdit]);

  // What the paragraph says is the DOM's while it is mounted, and is copied
  // into the session when typing pauses -- which is when it reaches the
  // host's store, so a reader who closes the document mid-sentence finds the
  // sentence there.
  const remember = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rememberSoon = () => {
    if (remember.current) clearTimeout(remember.current);
    remember.current = setTimeout(() => {
      const runs = readNow();
      if (runs) updateEdit(edit.id, { runs });
    }, REMEMBER_DELAY_MS);
  };
  useEffect(
    () => () => {
      if (remember.current) clearTimeout(remember.current);
    },
    [],
  );

  // Whatever changes the text -- typing, undo, a paste -- is followed from the
  // text itself: input events are the layer's, not this element's.
  const typedRef = useRef(() => {});
  typedRef.current = () => {
    measure();
    rememberSoon();
  };
  // Watching from before the paragraph is given the keystroke that made it
  // live text, which is typed into it as it mounts: a paragraph changed by
  // that one keystroke and no other has still been changed.
  useLayoutEffect(() => {
    const text = textRef.current;
    if (!text) return;
    const observer = new MutationObserver(() => typedRef.current());
    observer.observe(text, { characterData: true, childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  // Taken over from the page mid-keystroke: put the caret back where it was
  // over the page's rendering, then let the keystroke happen.
  useLayoutEffect(() => {
    const text = textRef.current;
    if (!text || handoff?.editId !== edit.id) return;
    receive(text, handoff);
    clearHandoff();
  }, [handoff, edit.id, clearHandoff]);

  // A whole font arriving from the host replaces the page's face in every span
  // that was written before it came.
  useLayoutEffect(() => {
    if (textRef.current) restyleRuns(textRef.current, paragraph, faceOf);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `facesReady` is what `faceOf` depends on
  }, [facesReady, paragraph]);

  // Before paint, so the lines around a paragraph never show at the position
  // its previous height put them.
  useLayoutEffect(measure, [measure, textWidth, paragraph.fontSize, facesReady]);

  // What this paragraph says and where, for whoever saves the document. Read
  // off the screen when asked, so it is always what is on the screen.
  const typeset = () => {
    const text = textRef.current;
    const layer = text?.closest(".pdf-edit-layer");
    if (!text || !layer) return [];
    const origin = layer.getBoundingClientRect().left;
    return typesetText({
      text,
      paragraph,
      fragments: session.fragmentsOf(edit),
      ascent: edit.ascent ?? estimatedAscent(paragraph),
      fontId: (style) => liveFontOf(style)?.id ?? null,
      styleOf: (node) => styleIndexOf(text, node, paragraph),
      toPage: (page, clientX) => (clientX - origin) / (geometryOf(page)?.scale ?? scale),
    });
  };
  const typesetRef = useRef(typeset);
  typesetRef.current = typeset;
  const { registerTypesetter } = session;
  useEffect(
    () => registerTypesetter(edit.id, () => typesetRef.current()),
    [registerTypesetter, edit.id],
  );

  // An embedded font registers when its page first renders, which can be after
  // this block mounted in the fallback face.
  useEffect(() => {
    document.fonts.addEventListener("loadingdone", measure);
    return () => document.fonts.removeEventListener("loadingdone", measure);
  }, [measure]);

  const layout = layoutFragments(shown, lineHeight, textWidth);
  const columned = layout.columns > 1;

  return (
    <div
      className="pdf-edit-block"
      style={{
        left: layout.left,
        top: layout.top,
        visibility: shown.length > 0 ? "visible" : "hidden",
        ...(columned
          ? { width: layout.columns, height: layout.columnHeight, columnCount: layout.columns }
          : { width: layout.width }),
      }}
    >
      {/* Always there, so the text is never mounted afresh -- and the caret
          dropped -- when a paragraph comes to span two columns. */}
      <div style={columned ? { width: layout.width } : undefined}>
      {layout.floats.map((float, index) => (
        <div
          key={index}
          className="pdf-edit-float"
          contentEditable={false}
          style={{
            float: float.side,
            clear: float.clear ? "both" : "none",
            width: float.width,
            height: float.height,
          }}
        />
      ))}
      <div
        ref={textRef}
        className="pdf-edit-text"
        style={{
          ...textStyle,
          textAlign: paragraph.align,
          textIndent: paragraph.indent * scale,
        }}
        {...{ [PARAGRAPH_HOST]: "" }}
      />
      {/* Same type, out of flow: where its baseline falls is where the text's
          does, without putting a measuring element inside editable content. */}
      <div className="pdf-edit-probe" style={textStyle} contentEditable={false} aria-hidden>
        <span ref={probeRef} />
      </div>
      </div>
    </div>
  );
}

/** Take the caret, and the keystroke, from the page's rendering: through the
 *  browser's own editing commands, so both are in its undo history. */
function receive(text: HTMLElement, handoff: Handoff): void {
  text.closest<HTMLElement>("[contenteditable]")?.focus({ preventScroll: true });
  selectText(text, handoff.anchor, handoff.focus);
  if (handoff.input?.kind === "insert") {
    insertPlainText(handoff.input.text);
  } else if (handoff.input?.kind === "delete") {
    document.execCommand("delete");
  }
}

function fragmentBoxes(
  fragments: EditFragment[],
  geometryOf: (page: number) => PageGeometry | null,
): FragmentBox[] {
  const boxes: FragmentBox[] = [];
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
