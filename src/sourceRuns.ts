import type { DocumentSelection } from "./selection.js";
import { utf8ByteOffsetToUtf16Offset } from "./textOffsets.js";

/** The class every addressable run carries, whatever produced it. A reader
 *  that renders a byte stream through the DOM has exactly one way to answer
 *  "which bytes is the cursor in", and this is it. */
export const SOURCE_RUN_CLASS = "reader-source-run";

/** A byte range the rendered document should mark up.
 *
 *  `className` rather than a fixed `kind`: what a mark *means* is the host's
 *  business, and this only needs to know which runs share a class so it can cut
 *  spans at the boundaries between them. */
export interface TextAnnotation {
  id: string;
  range: { start: number; end: number };
  className?: string;
}

export interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  position?: { start: { offset?: number }; end: { offset?: number } };
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

/** What a newline inside flowing text means in the substrate being rendered.
 *
 *  Markdown's soft break is a line break the rendered document would otherwise
 *  lose, so it becomes a `<br>` and the newline itself carries no glyph. HTML's
 *  newline is whitespace the layout already collapses, and turning it into a
 *  break would double every line of a wrapped paragraph. */
export type SoftBreaks = "break" | "collapse";

function decodedEntity(source: string): string | null {
  const match = source.match(/^&(?:#x[\da-f]+|#\d+|[a-z][\da-z]+);/i);
  if (!match) return null;
  const textarea = window.document.createElement("textarea");
  textarea.innerHTML = match[0];
  return textarea.value;
}

/**
 * Map every UTF-16 boundary in rendered text back to a UTF-16 source boundary.
 * Punctuation the renderer consumed is skipped; escapes and entities are taken
 * as one visible character. Positions supplied by the parser bound the search to
 * the originating source node, so repeated text elsewhere cannot interfere.
 */
export function renderedBoundaries(source: string, rendered: string, start: number, end: number): number[] {
  const slice = source.slice(start, end);
  const boundaries = new Array<number>(rendered.length + 1).fill(start);
  let sourceOffset = 0;
  let renderedOffset = 0;

  for (const character of rendered) {
    let tokenStart = sourceOffset;
    let tokenEnd = sourceOffset;
    while (tokenStart < slice.length) {
      if (slice.startsWith(character, tokenStart)) {
        tokenEnd = tokenStart + character.length;
        break;
      }
      if (slice[tokenStart] === "\\" && slice.startsWith(character, tokenStart + 1)) {
        tokenEnd = tokenStart + 1 + character.length;
        break;
      }
      const entity = decodedEntity(slice.slice(tokenStart));
      if (entity === character) {
        tokenEnd = tokenStart + slice.slice(tokenStart).match(/^&(?:#x[\da-f]+|#\d+|[a-z][\da-z]+);/i)![0].length;
        break;
      }
      tokenStart += slice.codePointAt(tokenStart)! > 0xffff ? 2 : 1;
    }

    if (tokenEnd === sourceOffset) {
      tokenStart = sourceOffset;
      tokenEnd = Math.min(sourceOffset + character.length, slice.length);
    }
    boundaries[renderedOffset] = start + tokenStart;
    for (let index = 1; index <= character.length; index += 1) {
      boundaries[renderedOffset + index] = start + tokenEnd;
    }
    sourceOffset = tokenEnd;
    renderedOffset += character.length;
  }

  return boundaries;
}

/** Identity of the annotation set covering a run, used only to decide where to
 *  cut spans. Two runs with the same key are rendered as one span. */
function annotationKey(start: number, end: number, annotations: TextAnnotation[]): string {
  return annotations
    .filter((annotation) => annotation.range.start < end && annotation.range.end > start)
    .map((annotation) => annotation.id)
    .join(",");
}

/** UTF-16 offset → UTF-8 byte offset for every boundary in `content`. Document
 *  coordinates are bytes; the DOM's are UTF-16, and the table is what carries a
 *  run from one to the other without re-encoding per character. */
function sourceByteBoundaries(content: string): number[] {
  const boundaries = new Array<number>(content.length + 1).fill(0);
  const encoder = new TextEncoder();
  let utf16Offset = 0;
  let byteOffset = 0;
  for (const character of content) {
    boundaries[utf16Offset] = byteOffset;
    byteOffset += encoder.encode(character).length;
    utf16Offset += character.length;
    boundaries[utf16Offset] = byteOffset;
  }
  return boundaries;
}

/**
 * A copy of a hast tree in which every positioned text node has become spans
 * carrying the source bytes it came from, cut at the boundaries between
 * annotation sets.
 *
 * This is the whole of how a rendered document stays addressable: a host anchors
 * a bookmark to bytes, a selection has to come back as bytes, and the DOM in
 * between knows neither. Markdown and HTML differ only in what produced the tree
 * and in what a newline means, so they share this.
 *
 * A copy rather than a rewrite because annotations change far more often than
 * documents do -- a bookmark added, a search hit moved -- and a reader that
 * rewrote the tree in place would have to re-parse the file to get an unmarked
 * one back. The tree it is given is left untouched, so it can be parsed once
 * and marked as many times as the host asks.
 */
export function withSourceRuns<Node extends HastNode>(
  tree: Node,
  content: string,
  annotations: TextAnnotation[],
  softBreaks: SoftBreaks,
): Node {
  const annotationsById = new Map(annotations.map((annotation) => [annotation.id, annotation]));
  const byteBoundariesForSource = sourceByteBoundaries(content);
  const contentBytes = byteBoundariesForSource[content.length] ?? 0;

  const visit = <Current extends HastNode>(node: Current, inPre: boolean): Current => {
    if (!node.children) return node;
    // Newlines inside <pre>/<code> are literal content; only newlines in
    // flowing text are candidates for a break.
    const childInPre = inPre || node.tagName === "pre" || node.tagName === "code";
    const children = node.children.flatMap((child): HastNode[] => {
      if (
        child.type !== "text" ||
        !child.value ||
        child.position?.start.offset == null ||
        child.position.end.offset == null
      ) {
        return [visit(child, childInPre)];
      }

      const value = child.value;
      const boundaries = renderedBoundaries(
        content,
        value,
        child.position.start.offset,
        child.position.end.offset,
      );
      const byteBoundaries = boundaries.map((offset) => byteBoundariesForSource[offset] ?? contentBytes);
      const characterBoundaries = [0];
      let characterOffset = 0;
      for (const character of child.value) {
        characterOffset += character.length;
        characterBoundaries.push(characterOffset);
      }
      const runs: HastNode[] = [];
      let runStart = 0;
      let key = annotationKey(
        byteBoundaries[0],
        byteBoundaries[characterBoundaries[1] ?? 0],
        annotations,
      );

      for (let characterIndex = 1; characterIndex < characterBoundaries.length; characterIndex += 1) {
        const index = characterBoundaries[characterIndex];
        const nextBoundary = characterBoundaries[characterIndex + 1];
        const nextKey = nextBoundary != null
          ? annotationKey(byteBoundaries[index], byteBoundaries[nextBoundary], annotations)
          : null;
        if (nextKey === key) continue;
        const ids = key ? key.split(",") : [];
        const classes = [
          SOURCE_RUN_CLASS,
          ...new Set(
            ids
              .map((id) => annotationsById.get(id)?.className)
              .filter((className): className is string => Boolean(className)),
          ),
        ];
        const span = (from: number, to: number): HastNode => ({
          type: "element",
          tagName: "span",
          properties: {
            className: classes,
            dataSourceBoundaries: byteBoundaries.slice(from, to + 1).join(","),
            ...(key ? { dataDecorationIds: key } : {}),
          },
          children: [{ type: "text", value: value.slice(from, to) }],
        });
        if (childInPre || softBreaks === "collapse") {
          runs.push(span(runStart, index));
        } else {
          // A soft break (`\n`) renders as <br>; the newline itself carries no
          // visible glyph, so it is dropped from the addressable spans.
          let segmentStart = runStart;
          for (let offset = runStart; offset < index; offset += 1) {
            if (value[offset] !== "\n") continue;
            if (offset > segmentStart) runs.push(span(segmentStart, offset));
            runs.push({ type: "element", tagName: "br", properties: {}, children: [] });
            segmentStart = offset + 1;
          }
          if (segmentStart < index) runs.push(span(segmentStart, index));
        }
        runStart = index;
        key = nextKey ?? "|";
      }
      return runs;
    });
    return { ...node, children };
  };
  return visit(tree, false);
}

/** The source byte offset a DOM point sits at, or null outside any run. */
export function sourceBoundaryForDomPoint(node: Node, offset: number): number | null {
  const element = (node instanceof Element ? node : node.parentElement)?.closest<HTMLElement>(
    `.${SOURCE_RUN_CLASS}`,
  );
  if (!element) return null;
  const boundaries = element.dataset.sourceBoundaries?.split(",").map(Number);
  if (!boundaries || boundaries.some(Number.isNaN)) return null;
  const textOffset = node instanceof Element ? (offset === 0 ? 0 : boundaries.length - 1) : offset;
  return boundaries[Math.max(0, Math.min(textOffset, boundaries.length - 1))] ?? null;
}

/**
 * A DOM selection over source runs, in the document's own coordinates.
 *
 * Shared by every reader that renders a text document through the DOM: the
 * selection a host is handed must not say which reader produced it, and a
 * line/column derived twice is a line/column that can disagree with itself.
 */
export function sourceRunSelection(
  content: string,
  range: Range,
  selection: Selection,
): DocumentSelection | null {
  const start = sourceBoundaryForDomPoint(range.startContainer, range.startOffset);
  const end = sourceBoundaryForDomPoint(range.endContainer, range.endOffset);
  if (start == null || end == null || end <= start) return null;
  const prefix = content.slice(0, utf8ByteOffsetToUtf16Offset(content, start));
  const lineStart = prefix.lastIndexOf("\n") + 1;
  return {
    quote: selection.toString().trim(),
    origin: {
      TextFile: {
        line: prefix.split("\n").length,
        col: start - new TextEncoder().encode(content.slice(0, lineStart)).length,
      },
    },
    text_range: { start, end },
    rects: [],
  };
}
