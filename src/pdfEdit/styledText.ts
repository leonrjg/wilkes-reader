import type { Paragraph, RunStyle, StyledRun } from "./paragraphs.js";
import { fontFace } from "./paragraphStyle.js";
import type { FontInfo } from "./pdfPageSource.js";

/**
 * A paragraph's styled runs, as DOM and back.
 *
 * Live text is written once and then belongs to the browser, so the runs go
 * in as `<span>`s that carry their style's index and come out by reading which
 * span each text node ended up in. Typing inside a span stays in its style,
 * which is all the formatting an editor without a toolbar needs to keep.
 *
 * Every size is in ems of the paragraph's own, so the reader can zoom without
 * anything here being written again.
 */

const STYLE_ATTRIBUTE = "data-style";

export function writeRuns(
  root: HTMLElement,
  runs: readonly StyledRun[],
  paragraph: Paragraph,
  fontOf: (fontName: string) => FontInfo,
): void {
  root.replaceChildren(
    ...runs.map((run) => {
      const span = document.createElement("span");
      span.setAttribute(STYLE_ATTRIBUTE, String(run.style));
      applyStyle(span, paragraph.styles[run.style], paragraph, fontOf);
      span.textContent = run.text;
      return span;
    }),
  );
}

/** Only what differs from the paragraph's base style is set: the rest is
 *  inherited from the block, which is where the reader's zoom reaches it. */
function applyStyle(
  span: HTMLElement,
  style: RunStyle,
  paragraph: Paragraph,
  fontOf: (fontName: string) => FontInfo,
): void {
  const base = paragraph.styles[paragraph.baseStyle];
  if (style.fontName !== base.fontName) {
    const face = fontFace(style.fontName, fontOf(style.fontName));
    span.style.fontFamily = face.fontFamily;
    span.style.fontWeight = face.fontWeight;
    span.style.fontStyle = face.fontStyle;
  }
  if (style.fontSize !== base.fontSize) span.style.fontSize = `${style.fontSize / base.fontSize}em`;
  if (style.color !== base.color) span.style.color = style.color;
  if (style.rise !== 0) {
    span.style.verticalAlign = `${style.rise / style.fontSize}em`;
    // A raised box would otherwise push its line taller than the others.
    span.style.lineHeight = "0";
  }
}

/** The text as it is now, in runs. Text the browser left outside any span --
 *  typed into a paragraph emptied of everything -- is in the base style. */
export function readRuns(root: HTMLElement, paragraph: Paragraph): StyledRun[] {
  const runs: StyledRun[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.nodeValue ?? "";
    if (text === "") continue;
    const marked = node.parentElement?.closest(`[${STYLE_ATTRIBUTE}]`);
    const index = marked && root.contains(marked) ? Number(marked.getAttribute(STYLE_ATTRIBUTE)) : NaN;
    const style = paragraph.styles[index] ? index : paragraph.baseStyle;
    const last = runs[runs.length - 1];
    if (last && last.style === style) last.text += text;
    else runs.push({ text, style });
  }
  return runs;
}

export const textOfRuns = (runs: readonly StyledRun[]) => runs.map((run) => run.text).join("");
