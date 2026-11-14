import { splitRuns } from "./edits.js";
import type { PdfFontRequest } from "./hostFonts.js";
import { styleKey, type RunStyle, type StyledRun } from "./paragraphs.js";

/**
 * Setting a stretch of a paragraph in another face of its font.
 *
 * A style names the font the page used. Bold and italic are said *against*
 * that: "this font's family, but bold" -- a face the page may not use anywhere,
 * and which the host is then asked for by family. A style says so only where
 * it differs from what its font already is, so making a bold word bold changes
 * nothing, and taking the bold off again gives back the style the page had.
 */
export type TypeChange = "bold" | "italic";

/** Whether a style is bold, or italic: its own say, or else its font's. */
export function wears(style: RunStyle, change: TypeChange, font: PdfFontRequest): boolean {
  return style[change] ?? font[change];
}

/** The font to ask a host for to set a style in. */
export function fontRequestOf(style: RunStyle, font: PdfFontRequest): PdfFontRequest {
  const bold = wears(style, "bold", font);
  const italic = wears(style, "italic", font);
  if (bold === font.bold && italic === font.italic) return font;
  return { ...font, bold, italic, sibling: true };
}

/** Whether all of the text from one offset to another is bold, or italic. */
export function allWear(
  runs: readonly StyledRun[],
  styles: readonly RunStyle[],
  from: number,
  to: number,
  change: TypeChange,
  fontOf: (fontName: string) => PdfFontRequest,
): boolean {
  const [, rest] = splitRuns(runs, from);
  const [selected] = splitRuns(rest, to - from);
  return selected.every((run) => wears(styles[run.style], change, fontOf(styles[run.style].fontName)));
}

/** The runs with the text from one offset to another made bold or italic, or
 *  made not, and the table of styles they are then written against: the one
 *  given, with any style it lacked added at its end. */
export function retyped(
  runs: readonly StyledRun[],
  styles: readonly RunStyle[],
  from: number,
  to: number,
  change: TypeChange,
  value: boolean,
  fontOf: (fontName: string) => PdfFontRequest,
): { runs: StyledRun[]; styles: RunStyle[] } {
  const table = [...styles];
  const [before, rest] = splitRuns(runs, from);
  const [selected, after] = splitRuns(rest, to - from);
  const changed = selected.map((run) => {
    const { [change]: _was, ...plain } = table[run.style];
    // Said only where it is not what the font already is.
    const style: RunStyle =
      fontOf(plain.fontName)[change] === value ? plain : { ...plain, [change]: value };
    let index = table.findIndex((known) => styleKey(known) === styleKey(style));
    if (index < 0) index = table.push(style) - 1;
    return { text: run.text, style: index };
  });
  const joined: StyledRun[] = [];
  for (const run of [...before, ...changed, ...after]) {
    const last = joined[joined.length - 1];
    if (last && last.style === run.style) joined[joined.length - 1] = { ...last, text: last.text + run.text };
    else if (run.text !== "") joined.push(run);
  }
  return { runs: joined, styles: table };
}
