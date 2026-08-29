import type { BoundingBox } from "./documentCoordinates.js";

/**
 * What the host's reading says a page area holds, in place of the glyphs the
 * page draws there.
 *
 * The reader does not decide this and cannot check it: a host supplies these
 * because *its* extraction already settled who owns those bytes -- typically a
 * recognizer that read a display formula or a ruled table the page typeset,
 * whose flattened glyph run (`ci = ai ⊕bi`, which is not mathematics) the
 * reading dropped in favour of the transcription. The page keeps drawing what
 * it always drew; only what the area *says*, when text is taken out of it,
 * changes.
 */
export interface TextSubstitution {
  page: number;
  /** The area whose glyph run the reading replaced, in the page's own units. */
  bbox: BoundingBox;
  /** The reading's account of that area. Newlines are significant. */
  text: string;
}

/** Marks a span this module put in place of a page's own glyph runs. */
export const SUBSTITUTED_ATTRIBUTE = "data-substituted";

/** How far left of a region a glyph run may start and still belong to it,
 *  as a fraction of the run's own font height. A hull is the union of the
 *  lines it covers, so a run begins inside it; this absorbs the rounding in
 *  pdf.js' two-decimal percentages and the recognizer's polygon. */
const LEFT_TOLERANCE = 0.25;

/** The geometry pdf.js writes onto one text-layer span, read back in the
 *  page's own units. Read from the inline styles rather than measured:
 *  `getBoundingClientRect` forces layout, needs the layer to be in the
 *  document, and returns zeroes under jsdom -- which would make every rule
 *  here untestable. */
interface SpanGeometry {
  span: HTMLElement;
  x: number;
  y: number;
  height: number;
}

function percentage(value: string): number | null {
  if (!value.endsWith("%")) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function pixels(value: string): number | null {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** The spans a substitution may claim: pdf.js' own text runs, each a single
 *  text node. `.markedContent` wrappers hold no text of their own. */
function textSpans(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>("span")].filter(
    (span) =>
      !span.classList.contains("markedContent") &&
      span.childNodes.length === 1 &&
      span.firstChild?.nodeType === Node.TEXT_NODE,
  );
}

function geometryOf(
  span: HTMLElement,
  pageWidth: number,
  pageHeight: number,
): SpanGeometry | null {
  const left = percentage(span.style.left);
  const top = percentage(span.style.top);
  const height = pixels(span.style.getPropertyValue("--font-height"));
  if (left === null || top === null || height === null) return null;
  return {
    span,
    x: (left / 100) * pageWidth,
    y: (top / 100) * pageHeight,
    height,
  };
}

/** Whether a glyph run belongs to the area a substitution speaks for.
 *
 *  The run's left edge at its vertical middle, which is stable against the
 *  ascent pdf.js builds into `top` and against a hull drawn tight around ink.
 *  Whole-line granularity upstream is what makes a point test enough: a
 *  typeset region is built from whole surveyed lines, so a run is either one
 *  of the region's own or nowhere near it. */
function isInside(geometry: SpanGeometry, bbox: BoundingBox): boolean {
  const middle = geometry.y + geometry.height / 2;
  return (
    geometry.x >= bbox.x - geometry.height * LEFT_TOLERANCE &&
    geometry.x <= bbox.x + bbox.width &&
    middle >= bbox.y &&
    middle <= bbox.y + bbox.height
  );
}

/** Width of `text` at `fontSize` in the page's units, or 0 when the
 *  environment cannot measure (jsdom has no text metrics). Mirrors pdf.js'
 *  own `TextLayer.#layout`, including its `width > 0` guard. */
let measuringContext: CanvasRenderingContext2D | null | undefined;
function naturalWidth(text: string, fontSize: number): number {
  if (measuringContext === undefined) {
    measuringContext = document.createElement("canvas").getContext("2d");
  }
  if (!measuringContext || fontSize <= 0) return 0;
  measuringContext.font = `${fontSize}px sans-serif`;
  let widest = 0;
  for (const line of text.split("\n")) {
    const measured = measuringContext.measureText(line).width;
    if (Number.isFinite(measured)) widest = Math.max(widest, measured);
  }
  return widest;
}

/**
 * The span that carries a substitution's text, built in pdf.js' own idiom.
 *
 * Every dimension is expressed the way `TextLayer` expresses it -- percentage
 * offsets, `--font-height` for the size, `--scale-x` for the horizontal fit --
 * so the copied stylesheet computes this span exactly as it computes the ones
 * it replaces, at every zoom and under a browser minimum font size. Setting a
 * width or a font-size directly would fight that chain: the stylesheet's
 * `transform` scales the border box, so an explicit width is not a fixed one.
 *
 * `user-select: all` is the claim being made, in the browser's own vocabulary:
 * this area's text is one indivisible thing. It has to be, because there is no
 * correspondence between an offset in this string and the glyphs painted under
 * it -- the two differ in content and in length -- so a partial selection could
 * only cut somewhere arbitrary. Inline, because the copied stylesheet says
 * `user-select: text` for every span and inline specificity is what beats it.
 */
function substitutionSpan(
  substitution: TextSubstitution,
  pageWidth: number,
  pageHeight: number,
): HTMLElement {
  const span = document.createElement("span");
  span.setAttribute("role", "presentation");
  span.setAttribute(SUBSTITUTED_ATTRIBUTE, "");
  span.dir = "ltr";
  span.textContent = substitution.text;

  const { bbox } = substitution;
  const lines = substitution.text.split("\n").length;
  const fontHeight = bbox.height / lines;
  const { style } = span;
  style.left = `${((100 * bbox.x) / pageWidth).toFixed(2)}%`;
  style.top = `${((100 * bbox.y) / pageHeight).toFixed(2)}%`;
  style.setProperty("--font-height", `${fontHeight.toFixed(2)}px`);
  const width = naturalWidth(substitution.text, fontHeight);
  if (width > 0) {
    style.setProperty("--scale-x", String(bbox.width / width));
  }
  style.setProperty("-webkit-user-select", "all");
  style.setProperty("user-select", "all");
  return span;
}

/** The `<br>`s pdf.js emits for line ends, among the nodes being removed.
 *
 *  A break is the region's own only when nothing that survives sits on either
 *  side of it: dropping the spans but keeping their breaks would leave phantom
 *  newlines in the copied text, and dropping a break between two survivors
 *  would run a neighbour's two lines together. */
function claimedBreaks(claimed: Set<HTMLElement>): HTMLElement[] {
  const breaks: HTMLElement[] = [];
  for (const span of claimed) {
    for (const sibling of [span.previousElementSibling, span.nextElementSibling]) {
      if (!(sibling instanceof HTMLElement) || sibling.tagName !== "BR") continue;
      const neighbours = [sibling.previousElementSibling, sibling.nextElementSibling];
      const survives = neighbours.some(
        (node) => node instanceof HTMLElement && node.tagName !== "BR" && !claimed.has(node),
      );
      if (!survives && !breaks.includes(sibling)) breaks.push(sibling);
    }
  }
  return breaks;
}

/**
 * Hand the areas a host's reading owns over to that reading, in one rendered
 * text layer.
 *
 * This is the reading surface's half of a decision the extraction already
 * made. Where a recognizer's transcription replaced a page's glyph run, the
 * reading holds no account of those glyphs at all -- so a reader that still
 * offered them for selection would be serving a claim its own document
 * dropped, and copying a formula would yield `yB = wxB mod q` while everything
 * else about the document said `y_{B} = w^{x_{B}} \bmod q`. One owner per
 * area: the glyph runs go, the reading's bytes take their place.
 *
 * Only selection is affected. The canvas beside this still paints what the
 * page draws, and find-in-page still searches it, because "where is the shape
 * I am looking at" is a question about the page while "what does this area
 * say" is a question about the reading.
 *
 * An area with no glyph runs under it is left alone. Nothing is being
 * superseded there -- it is a picture -- and inserting text over one would be
 * adding selectable text to a figure rather than settling a competing claim.
 */
export function substitutePageText(
  container: HTMLElement,
  substitutions: readonly TextSubstitution[],
  pageWidth: number,
  pageHeight: number,
): void {
  if (substitutions.length === 0 || pageWidth <= 0 || pageHeight <= 0) return;

  const geometries = textSpans(container)
    .map((span) => geometryOf(span, pageWidth, pageHeight))
    .filter((geometry): geometry is SpanGeometry => geometry !== null);
  const spoken = new Set<HTMLElement>();

  for (const substitution of substitutions) {
    const { bbox } = substitution;
    if (bbox.width <= 0 || bbox.height <= 0) continue;

    const claimed = new Set<HTMLElement>();
    for (const geometry of geometries) {
      if (spoken.has(geometry.span)) continue;
      if (isInside(geometry, bbox)) claimed.add(geometry.span);
    }
    // Nothing under it: a figure, not a superseded glyph run.
    if (claimed.size === 0) continue;

    const first = [...claimed].reduce((earliest, span) =>
      earliest.compareDocumentPosition(span) & Node.DOCUMENT_POSITION_PRECEDING ? span : earliest,
    );
    // Read the breaks before anything is inserted: the replacement lands
    // beside them, and a span that is not yet there cannot be mistaken for a
    // survivor holding one of them in place.
    const breaks = claimedBreaks(claimed);
    first.before(substitutionSpan(substitution, pageWidth, pageHeight));
    for (const node of breaks) node.remove();
    for (const span of claimed) {
      spoken.add(span);
      span.remove();
    }
  }
}
