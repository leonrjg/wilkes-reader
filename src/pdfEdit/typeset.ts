import { lineRects } from "./editableText.js";
import type { EditFragment } from "./edits.js";
import type { TypesetText } from "./editExport.js";
import type { Paragraph } from "./paragraphs.js";

/**
 * Reading an edited paragraph back off the screen, word by word.
 *
 * The browser broke the lines and spaced the words; a saved file has to put
 * each word where the browser did, or it is a different paragraph. So nothing
 * is recomputed: every word is asked where it is, and that is what is written
 * down. Words, because a justified line's spaces are stretched and its words
 * are not -- within a word the font's own advances are what both sides use.
 */

interface TypesetInput {
  /** The live text element. */
  text: HTMLElement;
  paragraph: Paragraph;
  /** Where the paragraph's line boxes were placed, in page units. */
  fragments: readonly EditFragment[];
  /** A line box's top to its baseline, in page units. */
  ascent: number;
  /** The id a style's font was resolved to, or null if it was not. */
  fontId: (fontName: string) => string | null;
  /** The style index a text node is in. */
  styleOf: (node: Text) => number;
  /** A screen position on a given page, in that page's units. */
  toPage: (page: number, clientX: number) => number;
}

export function typesetText(input: TypesetInput): TypesetText[] {
  const { text, paragraph, fragments } = input;
  const lines = lineRects(text);
  const placed = (line: number) => {
    let remaining = line;
    for (const fragment of fragments) {
      if (remaining < fragment.lines) {
        return { page: fragment.page, top: fragment.y + remaining * paragraph.lineHeight };
      }
      remaining -= fragment.lines;
    }
    return null;
  };

  const chunks: TypesetText[] = [];
  const range = document.createRange();
  const walker = document.createTreeWalker(text, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    const style = paragraph.styles[input.styleOf(node)];
    const font = input.fontId(style.fontName);
    const value = node.data;
    for (const word of value.matchAll(/\S+/g)) {
      if (font === null) {
        throw new Error(
          `This document's font "${style.fontName}" has no installed font to be saved in.`,
        );
      }
      const start = word.index;
      const end = start + word[0].length;
      // A word too long for its line is broken across two; each piece is then
      // its own run. One character at a time finds the break without guessing.
      range.setStart(node, start);
      range.setEnd(node, end);
      const pieces: Array<[number, number]> =
        inked(range.getClientRects()).length > 1
          ? Array.from({ length: end - start }, (_, index) => [start + index, start + index + 1])
          : [[start, end]];
      for (const [from, to] of pieces) {
        range.setStart(node, from);
        range.setEnd(node, to);
        const [rect] = inked(range.getClientRects());
        if (!rect) continue;
        const at = placed(nearestLine(lines, rect));
        if (!at) continue;
        // The space after a word is written with it, so text taken out of the
        // saved file has its spaces. It draws nothing.
        const spaced = to === end && /\s/.test(value[end] ?? "");
        chunks.push({
          page: at.page,
          x: input.toPage(at.page, rect.left),
          baseline: at.top + input.ascent - style.rise,
          text: value.slice(from, to) + (spaced ? " " : ""),
          font,
          size: style.fontSize,
          color: rgb(style.color),
        });
      }
    }
  }
  return chunks;
}

const inked = (rects: DOMRectList) => [...rects].filter((rect) => rect.width > 0 && rect.height > 0);

/** The line a word is on: the one its box overlaps most. A raised word's box
 *  sits high, and can reach into the line above. */
function nearestLine(lines: DOMRect[], rect: DOMRect): number {
  let best = 0;
  let bestOverlap = -Infinity;
  lines.forEach((line, index) => {
    const overlap = Math.min(line.bottom, rect.bottom) - Math.max(line.top, rect.top);
    if (overlap > bestOverlap) {
      best = index;
      bestOverlap = overlap;
    }
  });
  return best;
}

/** A colour the analysis produced, as channels. It only ever writes `rgb()`. */
function rgb(color: string): [number, number, number] {
  const channels = color.match(/\d+/g)?.map(Number) ?? [];
  return [channels[0] ?? 0, channels[1] ?? 0, channels[2] ?? 0];
}
