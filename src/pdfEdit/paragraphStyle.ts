import type { CSSProperties } from "react";
import type { LiveFont } from "./hostFonts.js";
import { runsBetween, type Paragraph, type StyledRun } from "./paragraphs.js";
import type { FontInfo } from "./pdfPageSource.js";

/** Layout engines keep lengths in 64ths of a pixel. A line height that is not
 *  a whole number of them is rounded per line, and forty lines of rounding is
 *  enough to put the last line of a page on the wrong side of a float. */
export const snapPx = (pixels: number) => Math.round(pixels * 64) / 64;

/** The height of one of a paragraph's line boxes on screen. */
export const lineHeightPx = (paragraph: Paragraph, scale: number) =>
  snapPx(paragraph.lineHeight * scale);

/** The scale live text is set at, near the page's: the one at which its lines
 *  are a whole number of pixels apart. WebKit puts a block's lines a whole
 *  number of pixels apart whatever line height it is asked for -- lines of
 *  29.44px stand 29px apart -- so a paragraph set at the page's own scale
 *  creeps up the page a little more with every line. Set at this one and
 *  scaled by the rest, its lines fall where the page's do. */
export function wholeLineScale(paragraph: Paragraph, scale: number): number {
  return Math.max(1, Math.round(paragraph.lineHeight * scale)) / paragraph.lineHeight;
}

/** One of a paragraph's lines as the page set it, measured in the type it is
 *  set in live, in CSS px at the scale it is set at. */
export interface MeasuredLine {
  /** Its text, unbroken, with no more than the type's own word spacing. */
  natural: number;
  /** The same with the space and the word that start the next line: what the
   *  line would have held had the page not broken it there. Absent on the
   *  last line. */
  withNext?: number;
  /** How many word spaces it has. */
  spaces: number;
  /** How wide the page has it. */
  page: number;
  /** How wide the live text box lets it be. */
  room: number;
}

/** The paragraph's lines as the page set them, measured as `MeasuredLine`s.
 *  `widthsOf` sets each list of runs it is given unbroken, in the faces the
 *  live text is in, and answers how wide each is in CSS px at `setAt` -- the
 *  scale the text is set at, whose box is `textWidth` wide. A line ended in a
 *  typesetter's hyphen is left out: live text has the whole word, and cannot
 *  break it there. */
export function measurePageLines(
  paragraph: Paragraph,
  widthsOf: (pieces: StyledRun[][]) => number[],
  setAt: number,
  textWidth: number,
): MeasuredLine[] {
  const { lines, text, runs } = paragraph;
  const measured = lines.flatMap((line, index) => {
    if (line.kept < line.text.length) return [];
    const end = line.start + line.kept;
    const next = lines[index + 1];
    const word = next?.text.search(/\s/) ?? -1;
    const nextEnd = next && next.start + (word < 0 ? next.kept : Math.min(word, next.kept));
    return [{ line, index, end, nextEnd }];
  });
  const widths = widthsOf(
    measured.flatMap(({ line, end, nextEnd }) => [
      runsBetween(runs, line.start, end),
      ...(nextEnd === undefined ? [] : [runsBetween(runs, line.start, nextEnd)]),
    ]),
  );
  let at = 0;
  return measured.map(({ line, index, end, nextEnd }) => ({
    natural: widths[at++],
    ...(nextEnd === undefined ? {} : { withNext: widths[at++] }),
    spaces: (text.slice(line.start, end).match(/[ \u00a0]/g) ?? []).length,
    page: line.width * setAt,
    room: textWidth - (index === 0 ? paragraph.indent * setAt : 0),
  }));
}

/** How far inside its limits the spacing is chosen: layout engines round
 *  widths to 64ths of a pixel, and a line that only just fits may not. */
const SPACING_MARGIN_PX = 0.1;

/**
 * What to add to every word space of a paragraph's live text for the browser
 * to break its lines where the page did.
 *
 * The page's word spaces are rarely the font's: a justified line's are
 * stretched or squeezed to fill it -- TeX squeezes them, where CSS can only
 * stretch -- and a printer may set every space wider than the font's own. The
 * browser fills each line with as many words as fit at the spacing it is
 * given. So that spacing has to let every line hold what the page put on it,
 * and no line hold the next one's first word too. Within those limits it is
 * the page's own: the gap the page left over the font's spaces, across all
 * its lines.
 *
 * Text broken for the best paragraph rather than line by line, as TeX breaks
 * it, can stretch one line and squeeze another so that no one spacing gives
 * both. Every line then still holds what the page put on it, and the one that
 * the page stretched takes a word from the next.
 */
export function pageWordSpacing(lines: readonly MeasuredLine[]): number {
  const spaced = lines.filter((line) => line.spaces > 0);
  if (spaced.length === 0) return 0;
  const most = Math.min(...spaced.map((line) => (line.room - line.natural - SPACING_MARGIN_PX) / line.spaces));
  const least = Math.max(
    ...lines.map((line) =>
      line.withNext === undefined ? -Infinity : (line.room - line.withNext + SPACING_MARGIN_PX) / (line.spaces + 1),
    ),
  );
  const own =
    spaced.reduce((sum, line) => sum + line.page - line.natural, 0) /
    spaced.reduce((sum, line) => sum + line.spaces, 0);
  return Math.min(most, Math.max(least, own));
}

/** A font, as the CSS that asks for it. */
export interface FaceStyle {
  fontFamily: string;
  fontWeight: "bold" | "normal";
  fontStyle: "italic" | "normal";
  /** Set where spaces come from another font than the text's own, to make
   *  them as wide as the text's own would be. */
  wordSpacing?: string;
}

/** The custom property live text is given the page's word spacing in
 *  (`pageWordSpacing`). Every face's own word spacing has it added, so it
 *  reaches the spaces of a phrase in another face as well as the paragraph's. */
export const WORD_SPACING_PROPERTY = "--pdf-edit-word-spacing";

/** A face's word spacing as CSS: its own, and the paragraph's on top. */
export const wordSpacingOf = (face: FaceStyle) =>
  `calc(${face.wordSpacing ?? "0px"} + var(${WORD_SPACING_PROPERTY}, 0px))`;

/** The size, leading and spacing of a paragraph's type, in a given face. */
export function paragraphTextStyle(paragraph: Paragraph, face: FaceStyle, scale: number): CSSProperties {
  const { spacing } = paragraph.styles[paragraph.baseStyle];
  return {
    ...face,
    wordSpacing: wordSpacingOf(face),
    fontSize: paragraph.fontSize * scale,
    lineHeight: `${lineHeightPx(paragraph, scale)}px`,
    ...(spacing ? { letterSpacing: `${spacing}em` } : {}),
  };
}

/** A font as the page draws it: the embedded face pdf.js registered. It is the
 *  face the page's own glyphs are in, so a caret laid over the page in it
 *  falls between the letters it appears to be between. A subset lacks glyphs;
 *  the generic family covers what it lacks -- and all of it, for a font of a
 *  page nothing is known about yet. */
export function pageFace(font: FontInfo): FaceStyle {
  return {
    fontFamily: font.face ? `"${font.face}", ${font.generic}` : font.generic,
    fontWeight: font.bold ? "bold" : "normal",
    fontStyle: font.italic ? "italic" : "normal",
  };
}

/** The fonts edited text is set in, each the file it will also be saved in:
 *  the browser takes each character from the first that has it, and so does
 *  the typesetter (`typeset`). Each is already the bold or the italic, so
 *  nothing is asked of the browser on top. Until any is known it is the
 *  page's face. */
export function liveFace(font: FontInfo, live: readonly LiveFont[]): FaceStyle {
  if (live.length === 0) return pageFace(font);
  const face: FaceStyle = {
    fontFamily: [...live.map((each) => `"${each.family}"`), font.generic].join(", "),
    fontWeight: "normal",
    fontStyle: "normal",
  };
  // A subset often has no space -- the document only ever left a gap -- and
  // the browser then takes one from the next font, at that font's width.
  const [own] = live;
  const drawn = live.find((each) => each.covers.has(0x20));
  if (!own.covers.has(0x20) && own.space !== undefined && drawn?.space !== undefined) {
    const difference = own.space - drawn.space;
    if (Math.abs(difference) > 0.001) face.wordSpacing = `${difference}em`;
  }
  return face;
}
