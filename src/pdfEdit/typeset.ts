import { lineRects } from "./editableText.js";
import type { EditFragment } from "./edits.js";
import type { TypesetText } from "./editExport.js";
import type { LiveFont } from "./hostFonts.js";
import type { Paragraph, RunStyle } from "./paragraphs.js";

/**
 * Reading an edited paragraph back off the screen, word by word.
 *
 * The browser broke the lines and spaced the words; a saved file has to put
 * each word where the browser did, or it is a different paragraph. So nothing
 * is recomputed: every word is asked where it is, and that is what is written
 * down. Words, because a justified line's spaces are stretched and its words
 * are not -- within a word the font's own advances are what both sides use.
 *
 * And by font within a word: a paragraph's text is set in a stack of fonts,
 * the document's own first, and the browser takes each character from the
 * first font that has it. A word with a character the document's font lacks
 * is in two fonts, and is written down as two runs, each where the browser
 * put it and in the font it drew it in.
 */

interface TypesetInput {
  /** The live text element. */
  text: HTMLElement;
  paragraph: Paragraph;
  /** Where the paragraph's line boxes were placed, in page units. */
  fragments: readonly EditFragment[];
  /** A line box's top to its baseline, in page units. */
  ascent: number;
  /** The fonts a style's text is set in, first choice first. */
  fontsOf: (style: RunStyle) => readonly LiveFont[];
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
    const fonts = input.fontsOf(style);
    const value = node.data;
    for (const word of value.matchAll(/\S+/g)) {
      if (fonts.length === 0) {
        throw new Error(`This document's font "${style.fontName}" has no font to be saved in.`);
      }
      const start = word.index;
      const end = start + word[0].length;
      // A word too long for its line is broken across two; each piece is then
      // its own run. One character at a time finds the break without guessing.
      // So is a word set with character spacing: a saved file sets a run in
      // its font's own advances, so each character is put where it is here.
      range.setStart(node, start);
      range.setEnd(node, end);
      const pieces: Array<[number, number]> =
        inked(range.getClientRects()).length > 1 || style.spacing
          ? characterSpans(value, start, end)
          : [[start, end]];
      for (const [pieceStart, pieceEnd] of pieces) {
        for (const [from, to, font] of runsByFont(value, pieceStart, pieceEnd, fonts)) {
          range.setStart(node, from);
          range.setEnd(node, to);
          const [rect] = inked(range.getClientRects());
          if (!rect) continue;
          const at = placed(nearestLine(lines, rect));
          if (!at) continue;
          // The space after a word is written with it, so text taken out of
          // the saved file has its spaces. It draws nothing -- but in a font
          // without one it would draw the missing glyph, so it is then a run
          // of its own, in a font of the stack that has it.
          const spaced = to === end && /\s/.test(value[end] ?? "");
          const own = spaced && font.covers.has(0x20);
          const chunk = {
            page: at.page,
            baseline: at.top + input.ascent - style.rise,
            size: style.fontSize,
            color: rgb(style.color),
          };
          chunks.push({
            ...chunk,
            x: input.toPage(at.page, rect.left),
            text: value.slice(from, to) + (own ? " " : ""),
            font: font.id,
          });
          const spacer = spaced && !own ? fonts.find((candidate) => candidate.covers.has(0x20)) : undefined;
          if (spacer) chunks.push({ ...chunk, x: input.toPage(at.page, rect.right), text: " ", font: spacer.id });
        }
      }
    }
  }
  return chunks;
}

/** Each character from `start` to `end` on its own -- a character, not a UTF-16
 *  unit: one beyond the basic plane is two. */
function characterSpans(text: string, start: number, end: number): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  for (let at = start; at < end; ) {
    const next = at + (text.codePointAt(at)! > 0xffff ? 2 : 1);
    spans.push([at, next]);
    at = next;
  }
  return spans;
}

/** The text from `start` to `end` in runs of one font each: every character in
 *  the first font that has it, or the last font if none does -- which is how
 *  the browser chose, as far as these fonts go. */
export function runsByFont(
  text: string,
  start: number,
  end: number,
  fonts: readonly LiveFont[],
): Array<[number, number, LiveFont]> {
  const runs: Array<[number, number, LiveFont]> = [];
  for (const [from, to] of characterSpans(text, start, end)) {
    const character = text.codePointAt(from)!;
    const font = fonts.find((candidate) => candidate.covers.has(character)) ?? fonts[fonts.length - 1];
    const last = runs[runs.length - 1];
    if (last && last[2] === font && last[1] === from) last[1] = to;
    else runs.push([from, to, font]);
  }
  return runs;
}

const inked = (rects: DOMRectList) => [...rects].filter((rect) => rect.width > 0 && rect.height > 0);

/** The line a word is on: of those it is within the width of, the one its box
 *  overlaps most. A raised word's box sits high, and can reach into the line
 *  above; and a line in the next column can be level with this one. */
function nearestLine(lines: DOMRect[], rect: DOMRect): number {
  const centre = (rect.left + rect.right) / 2;
  let best = 0;
  let bestOverlap = -Infinity;
  lines.forEach((line, index) => {
    if (centre < line.left || centre > line.right) return;
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
