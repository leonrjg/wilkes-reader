import { PARAGRAPH_HOST, travelOnArrow } from "./caretTravel.js";
import { insertPlainText, selectText } from "./editableText.js";
import { replacesItems, splitRuns, type ParagraphEdit } from "./edits.js";
import type { StyledRun } from "./paragraphs.js";
import { textOfRuns } from "./styledText.js";
import {
  joinNeighbour,
  type PdfEditSession,
  type PendingInput,
  type Slot,
} from "./usePdfEditSession.js";

/**
 * What the keyboard means in a document being edited.
 *
 * The whole layer is one editable surface, so that a selection can start in
 * one paragraph and end in another the way it does in any text. The price is
 * that the browser would then edit across paragraphs as well -- merging the
 * elements they are drawn in, which are not its to merge. So everything typed
 * is looked at here first, and sorted into three kinds:
 *
 *   - Inside one paragraph that is already live text: the browser's, entirely.
 *     Caret, selection, undo and input methods behave as they do anywhere.
 *   - Inside one paragraph the page still draws: nothing is typed there. The
 *     paragraph is made live text and the keystroke happens in that.
 *   - Anything that changes which paragraphs there are -- Enter, a deletion at
 *     a paragraph's edge, anything typed over a selection that spans several
 *     -- is a change to the session, and nothing in the DOM is touched.
 */

/** A paragraph on screen, as the input handling needs to know it. */
export interface ParagraphHandle {
  /** The element its text is in. */
  element: HTMLElement;
  slot: () => Slot;
  /** A DOM position inside the element, as an offset into what the paragraph
   *  says. */
  offsetOf: (node: Node, offset: number) => number;
  /** What it says now. */
  runs: () => StyledRun[];
  /** The caret has left: time to decide what has become of it. Live text only. */
  settle?: () => void;
}

/** Announce a paragraph for as long as it is mounted. Returns what withdraws it. */
export type RegisterParagraph = (handle: ParagraphHandle) => () => void;

/** A place in the document's text. */
interface Point {
  handle: ParagraphHandle;
  offset: number;
}

/** A stretch of the document's text, in reading order. */
interface Span {
  start: Point;
  end: Point;
}

const lengthOf = (handle: ParagraphHandle) => textOfRuns(handle.runs()).length;

export function attachEditInput(
  layer: HTMLElement,
  session: () => PdfEditSession,
  handles: ReadonlyMap<HTMLElement, ParagraphHandle>,
): () => void {
  const handleOf = (node: Node): ParagraphHandle | null => {
    const element = node instanceof Element ? node : node.parentElement;
    const host = element?.closest<HTMLElement>(`[${PARAGRAPH_HOST}]`);
    return (host && handles.get(host)) ?? null;
  };

  /** The paragraphs on screen, in reading order -- which is their order in
   *  the document. */
  const inOrder = () =>
    [...handles.values()].sort((a, b) =>
      a.element.compareDocumentPosition(b.element) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
    );

  /** A DOM position as a place in the text. One that is between paragraphs
   *  rather than in one -- a selection dragged out into a margin ends there --
   *  is the nearest place in the direction the selection came from. */
  const pointAt = (node: Node, offset: number, edge: "start" | "end"): Point | null => {
    const handle = handleOf(node);
    if (handle) return { handle, offset: handle.offsetOf(node, offset) };
    const range = document.createRange();
    const ordered = inOrder();
    if (edge === "end") ordered.reverse();
    for (const candidate of ordered) {
      range.selectNodeContents(candidate.element);
      const side = range.comparePoint(node, offset);
      if (edge === "start" && side <= 0) return { handle: candidate, offset: 0 };
      if (edge === "end" && side >= 0) return { handle: candidate, offset: lengthOf(candidate) };
    }
    return null;
  };

  const spanOf = (range: AbstractRange): Span | null => {
    if (!layer.contains(range.startContainer) || !layer.contains(range.endContainer)) return null;
    const start = pointAt(range.startContainer, range.startOffset, "start");
    const end = pointAt(range.endContainer, range.endOffset, "end");
    return start && end ? { start, end } : null;
  };

  const selectedRange = (): Range | null => {
    const selection = window.getSelection();
    return selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
  };
  const selectedSpan = (): Span | null => {
    const range = selectedRange();
    return range && spanOf(range);
  };

  /** What a span says, a line to a paragraph. */
  const textOf = ({ start, end }: Span): string => {
    const ordered = inOrder();
    return ordered
      .slice(ordered.indexOf(start.handle), ordered.indexOf(end.handle) + 1)
      .map((handle) =>
        textOfRuns(handle.runs()).slice(
          handle === start.handle ? start.offset : 0,
          handle === end.handle ? end.offset : undefined,
        ),
      )
      .join("\n");
  };

  /** Make one paragraph of everything a span touches, without what it covers. */
  const joinAcross = ({ start, end }: Span, input: PendingInput | null): ParagraphEdit | null =>
    session().joinParagraphs(
      start.handle.slot(),
      end.handle.slot(),
      splitRuns(start.handle.runs(), start.offset)[0],
      splitRuns(end.handle.runs(), end.offset)[1],
      input,
    );

  /** Take a paragraph from the page and have `input` happen in it. */
  const handOver = ({ start, end }: Span, input: PendingInput | null) => {
    session().beginEdit(start.handle.slot().paragraph, {
      anchor: start.offset,
      focus: end.offset,
      input,
    });
  };

  /** Remove what a span covers. */
  const erase = (span: Span) => {
    if (span.start.handle !== span.end.handle) joinAcross(span, null);
    else if (span.start.handle.slot().edit) document.execCommand("delete");
    else if (span.start.offset !== span.end.offset) handOver(span, { kind: "delete" });
  };

  const onBeforeInput = (event: InputEvent) => {
    const range = selectedRange();
    const selected = range && spanOf(range);
    if (!range || !selected) {
      // Not in the text at all: there is nothing here to type into.
      event.preventDefault();
      return;
    }
    const kind = event.inputType;
    // History is the browser's record of what it typed, which is only live
    // text; formatting and dragging are not offered across paragraphs.
    const notOurs = kind.startsWith("history") || kind.startsWith("format") || /Drag|Drop/.test(kind);
    const { handle } = selected.start;

    if (handle !== selected.end.handle) {
      event.preventDefault();
      if (notOurs) return;
      // Taking out what is selected is the whole of a deletion; anything else
      // is then typed where it was.
      const input = pendingInput(event);
      joinAcross(selected, input.kind === "delete" ? null : input);
      return;
    }

    // Backspace before a paragraph's first character or Delete after its last:
    // nothing of the paragraph goes, but the break beside it does.
    if (kind.startsWith("delete") && selected.start.offset === selected.end.offset) {
      const direction =
        kind.endsWith("Backward") && selected.start.offset === 0
          ? -1
          : kind.endsWith("Forward") && selected.start.offset >= lengthOf(handle)
            ? 1
            : null;
      if (direction !== null) {
        event.preventDefault();
        joinNeighbour(session(), handle.slot(), direction, handle.runs());
        return;
      }
    }

    if (handle.slot().edit) {
      // The browser types -- provided the caret is in the text itself, and not
      // beside it in the block the text is laid out in.
      if (!handleOf(range.startContainer) || !handleOf(range.endContainer)) {
        event.preventDefault();
        selectText(handle.element, selected.start.offset, selected.end.offset);
        return;
      }
      // And provided it types text. Given a line to break -- a paste of
      // several -- it would make a second element of the paragraph's.
      const text = kind === "insertParagraph" ? "\n" : insertedText(event);
      if (!notOurs && kind.startsWith("insert") && /[\r\n]/.test(text)) {
        event.preventDefault();
        insertPlainText(text);
      }
      return;
    }

    // The page's own paragraph: it stays the page's, and is never typed into.
    event.preventDefault();
    if (notOurs) return;
    // What the keystroke applies to can be more than the selection -- a word,
    // for a word deletion -- but never more than this paragraph.
    const target = event.getTargetRanges()[0];
    const affected = (target && spanOf(target)) ?? selected;
    handOver(
      {
        start: affected.start.handle === handle ? affected.start : { handle, offset: 0 },
        end: affected.end.handle === handle ? affected.end : { handle, offset: lengthOf(handle) },
      },
      pendingInput(event),
    );
  };

  // A composition cannot be cancelled and replayed, so a paragraph of the
  // page is handed over as one starts and the composition begins again in
  // live text.
  const onCompositionStart = () => {
    const selected = selectedSpan();
    if (!selected) return;
    if (selected.start.handle !== selected.end.handle) joinAcross(selected, null);
    else if (!selected.start.handle.slot().edit) handOver(selected, null);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.isComposing) return;
    const selected = selectedSpan();
    if (!selected) return;
    const { start, end } = selected;

    // Enter makes two paragraphs where there was one. Caught as a key because
    // plain-text editing reports Enter and Shift+Enter as the same input; with
    // Shift it goes on to become a line break inside the paragraph.
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (start.handle === end.handle) {
        const runs = start.handle.runs();
        session().splitParagraph(
          start.handle.slot(),
          splitRuns(runs, start.offset)[0],
          splitRuns(runs, end.offset)[1],
        );
        return;
      }
      // Over a selection that spans paragraphs: what it covers goes, and the
      // break falls where it was.
      const joined = joinAcross(selected, null);
      if (!joined) return;
      const [before, after] = splitRuns(joined.runs, start.offset);
      session().splitParagraph({ paragraph: joined.paragraph, edit: joined }, before, after);
      return;
    }

    // Escape gives a paragraph back to the page. One the reader made has no
    // page to go back to.
    if (event.key === "Escape") {
      const { edit } = start.handle.slot();
      if (!edit || !replacesItems(edit)) return;
      event.preventDefault();
      session().removeEdit(edit.id);
      return;
    }

    travelOnArrow(event, layer);
  };

  // What is copied is what the paragraphs say, not what the lines the page
  // broke them into say: no hyphens from line ends, a line to a paragraph.
  const onCopy = (event: ClipboardEvent) => {
    const selected = selectedSpan();
    if (!selected || !event.clipboardData) return;
    event.preventDefault();
    event.clipboardData.setData("text/plain", textOf(selected));
    if (event.type === "cut") erase(selected);
  };

  // A paragraph of live text is settled -- handed back to the page if it says
  // what the page says -- when the selection has left it altogether.
  let occupied = new Set<ParagraphHandle>();
  const settleExcept = (still: Set<ParagraphHandle>) => {
    for (const handle of occupied) {
      if (!still.has(handle) && handles.get(handle.element) === handle) handle.settle?.();
    }
    occupied = still;
  };
  const onSelectionChange = () => {
    const selection = window.getSelection();
    const still = new Set<ParagraphHandle>();
    if (selection && document.activeElement === layer) {
      for (const node of [selection.anchorNode, selection.focusNode]) {
        const handle = node && layer.contains(node) ? handleOf(node) : null;
        if (handle) still.add(handle);
      }
    }
    settleExcept(still);
  };
  const onFocusOut = () => settleExcept(new Set());

  layer.addEventListener("beforeinput", onBeforeInput);
  layer.addEventListener("compositionstart", onCompositionStart);
  layer.addEventListener("keydown", onKeyDown);
  layer.addEventListener("copy", onCopy);
  layer.addEventListener("cut", onCopy);
  layer.addEventListener("focusout", onFocusOut);
  document.addEventListener("selectionchange", onSelectionChange);
  return () => {
    layer.removeEventListener("beforeinput", onBeforeInput);
    layer.removeEventListener("compositionstart", onCompositionStart);
    layer.removeEventListener("keydown", onKeyDown);
    layer.removeEventListener("copy", onCopy);
    layer.removeEventListener("cut", onCopy);
    layer.removeEventListener("focusout", onFocusOut);
    document.removeEventListener("selectionchange", onSelectionChange);
  };
}

const insertedText = (event: InputEvent) =>
  event.data ?? event.dataTransfer?.getData("text/plain") ?? "";

function pendingInput(event: InputEvent): PendingInput {
  if (event.inputType.startsWith("delete")) return { kind: "delete" };
  const breaks = event.inputType === "insertLineBreak" || event.inputType === "insertParagraph";
  return { kind: "insert", text: breaks ? "\n" : insertedText(event) };
}
