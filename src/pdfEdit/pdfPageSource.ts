import { AnnotationMode, OPS, Util } from "../pdfjs.js";
import type { PDFDocumentProxy, PDFPageProxy } from "../pdfjs.js";
import { installReadableStreamAsyncIterator } from "../readableStreamAsyncIterator.js";
import { faceFromName } from "./fontNames.js";
import type { PdfFontRequest } from "./hostFonts.js";
import { inkGridFromImage } from "./inkGrid.js";
import { ownFaceOf, type LoadedFontFile, type OwnFace } from "./ownFaces.js";
import { layoutFromInk, type PageLayout } from "./pageLayout.js";
import type { TextRun } from "./paragraphs.js";

/**
 * Everything the editor takes from pdf.js: a page's raster, its analysis, and
 * its text. Nothing else under `pdfEdit/` touches the library, so the flow and
 * the reflow can be reasoned about -- and tested -- as plain data.
 */

/** What is known of a font a document uses: what a host is asked to find a
 *  whole font by, and the family pdf.js registered its embedded face as. That
 *  family is made up when the document is opened and is good until it is
 *  closed; nothing kept longer may name a font by it. */
export interface FontInfo extends PdfFontRequest {
  face: string;
}

export interface PageAnalysis {
  layout: PageLayout;
  runs: TextRun[];
  /** The fonts the page's runs are in, by the name each run has for its. */
  fonts: Map<string, FontInfo>;
  /** Those of them that can be typed in as they are (`ownFaces`), by the
   *  same name. */
  faces: Map<string, OwnFace>;
}

/** Pixels per page unit the layout is read at. Fixed, so a page's analysis is
 *  a property of the page and does not change with the reader's zoom. Two is
 *  the coarsest grid that still resolves the gap between tightly set lines. */
const ANALYSIS_SCALE = 2;

/** What of a page a raster shows: everything, or everything but its text --
 *  the paper, with whatever is printed on it that is not writing. */
export type RasterLayer = "page" | "paper";

const TEXT_OPERATIONS: ReadonlySet<number> = new Set([
  OPS.showText,
  OPS.showSpacedText,
  OPS.nextLineShowText,
  OPS.nextLineSetSpacingShowText,
]);

/** The list of operations a render walks. pdf.js keeps it on the task and
 *  offers no other way to it: `getOperatorList()` answers with a differently
 *  optimised list, whose places are not the ones a render's filter is asked
 *  about -- a page set one glyph at a time has its text operations merged in
 *  one list and not in the other. */
export interface WalkedOperations {
  fnArray: number[];
  argsArray: unknown[];
}

function operationsOf(task: unknown): WalkedOperations {
  const list = (task as { _internalRenderTask?: { operatorList?: WalkedOperations } })
    ._internalRenderTask?.operatorList;
  if (!list || !Array.isArray(list.fnArray)) {
    throw new Error("PDF edit: this build of pdf.js does not expose the operations a render walks");
  }
  return list;
}

async function renderPage(
  page: PDFPageProxy,
  pixelsPerUnit: number,
  readBack: boolean,
  layer: RasterLayer = "page",
): Promise<{ canvas: HTMLCanvasElement; context: CanvasRenderingContext2D; operations: WalkedOperations }> {
  const viewport = page.getViewport({ scale: pixelsPerUnit });
  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const context = canvas.getContext("2d", { alpha: false, willReadFrequently: readBack });
  if (!context) throw new Error("PDF edit: no 2D canvas context is available");
  // The same choices `PdfPageCanvas` makes, for the same reasons: an opaque
  // white sheet, with annotation appearances baked in.
  let walked: WalkedOperations | null = null;
  const task = page.render({
    annotationMode: AnnotationMode.ENABLE,
    canvas,
    canvasContext: context,
    viewport,
    background: "white",
    // The paper is the page without the operations that draw text. Asked of
    // the list being walked, as it is walked: the list arrives in pieces.
    ...(layer === "paper"
      ? {
          operationsFilter: (index: number) => {
            walked ??= operationsOf(task);
            return !TEXT_OPERATIONS.has(walked.fnArray[index]);
          },
        }
      : {}),
  });
  await task.promise;
  return { canvas, context, operations: operationsOf(task) };
}

async function imageOf(
  page: PDFPageProxy,
  layer: RasterLayer,
): Promise<{ image: ImageData; operations: WalkedOperations }> {
  const { canvas, context, operations } = await renderPage(page, ANALYSIS_SCALE, true, layer);
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  // Release the surface now rather than at collection: these are megabytes.
  canvas.width = 0;
  canvas.height = 0;
  return { image, operations };
}

export async function analysePage(pdf: PDFDocumentProxy, pageNumber: number): Promise<PageAnalysis> {
  const page = await pdf.getPage(pageNumber);
  const { image, operations } = await imageOf(page, "page");
  // The same page without its text: where the two differ is the text's ink.
  const { image: paper } = await imageOf(page, "paper");
  const layout = layoutFromInk(inkGridFromImage(image, ANALYSIS_SCALE));
  const spacingOf = characterSpacing(operations);

  installReadableStreamAsyncIterator();
  const content = await page.getTextContent();
  const toPage = page.getViewport({ scale: 1 }).transform;
  const runs: TextRun[] = [];
  const fonts = new Map<string, FontInfo>();
  const faces = new Map<string, OwnFace>();
  // pdf.js's name for each font, to the name the runs are given for it.
  const named = new Map<string, string>();
  for (const item of content.items) {
    if (!("str" in item) || item.str.length === 0) continue;
    const transform = Util.transform(toPage, item.transform);
    // Text set at an angle is not a line of a paragraph; leave it to the page.
    if (Math.abs(transform[1]) > 0.01 * Math.abs(transform[0])) continue;
    const fontSize = Math.hypot(transform[2], transform[3]);
    let fontName = named.get(item.fontName);
    if (fontName === undefined) {
      const font = fontOf(page, item.fontName, content.styles[item.fontName]?.fontFamily);
      fontName = font.name;
      named.set(item.fontName, fontName);
      if (!fonts.has(fontName)) fonts.set(fontName, font.info);
      if (font.own && !faces.has(fontName)) faces.set(fontName, font.own);
    }
    runs.push({
      text: item.str,
      x: transform[4],
      width: item.width,
      baseline: transform[5],
      fontSize,
      fontName,
      spacing: spacingOf(item.str),
      color: inkColour(image, paper, {
        x: transform[4] * ANALYSIS_SCALE,
        y: (transform[5] - fontSize * 0.75) * ANALYSIS_SCALE,
        width: item.width * ANALYSIS_SCALE,
        height: fontSize * 0.95 * ANALYSIS_SCALE,
      }),
    });
  }
  if (spacingOf.unread > 0) {
    console.warn(
      `PDF edit: page ${pageNumber} has ${spacingOf.unread} piece(s) of text not found among the glyphs it draws; they are set without character spacing`,
    );
  }
  return { layout, runs, fonts, faces };
}

/** A glyph in the operations, as far as it is read here. */
interface DrawnGlyph {
  unicode?: string;
}

/** Text as it is matched between the operations and the text layer: without
 *  its spaces, which the text layer adds and drops as gaps suggest, and with
 *  ligatures and the like taken apart, as the text layer gives them. */
const comparable = (text: string) => text.normalize("NFKC").replace(/\s+/g, "");

/**
 * The character spacing each piece of a page's text is set with, in ems of
 * its font: what is added after every glyph -- `Tc`, times the horizontal
 * scaling, over the font size. A headline is often set tighter than its
 * font's own advances, and set again without that it would be wider than the
 * page has it, and break its lines elsewhere.
 *
 * The text layer does not say; the operations the page was drawn with do,
 * glyph by glyph. Each piece of the text layer, asked for in the order the
 * text layer gives them, is found among the glyphs by what it says, from
 * where the piece before it was found. One that is not there -- text a
 * document gives in place of what it draws, or set right to left -- is set
 * with none, and is counted in `unread`.
 */
export function characterSpacing(operations: WalkedOperations): ((text: string) => number) & { unread: number } {
  let drawn = "";
  const spacingAt: number[] = [];
  let state = { charSpacing: 0, scaling: 1, size: 1 };
  const saved: Array<typeof state> = [];
  const { fnArray, argsArray } = operations;
  for (let index = 0; index < fnArray.length; index++) {
    const args = (argsArray[index] ?? []) as unknown[];
    let glyphs: unknown = null;
    switch (fnArray[index]) {
      case OPS.save:
        saved.push({ ...state });
        break;
      case OPS.restore:
        state = saved.pop() ?? state;
        break;
      case OPS.setCharSpacing:
        state.charSpacing = Number(args[0]);
        break;
      case OPS.setHScale:
        state.scaling = Number(args[0]) / 100;
        break;
      case OPS.setFont:
        state.size = Number(args[1]);
        break;
      case OPS.nextLineSetSpacingShowText:
        state.charSpacing = Number(args[1]);
        glyphs = args[2];
        break;
      case OPS.showText:
      case OPS.showSpacedText:
      case OPS.nextLineShowText:
        glyphs = args[0];
        break;
    }
    if (!Array.isArray(glyphs)) continue;
    const spacing = state.size === 0 ? 0 : (state.charSpacing * state.scaling) / state.size;
    for (const glyph of glyphs) {
      // The rest are numbers: a nudge between two glyphs, not a glyph.
      const text = typeof glyph === "object" && glyph !== null ? (glyph as DrawnGlyph).unicode : undefined;
      if (!text) continue;
      const kept = comparable(text);
      drawn += kept;
      for (let unit = 0; unit < kept.length; unit++) spacingAt.push(spacing);
    }
  }

  let from = 0;
  const spacingOf = Object.assign(
    (text: string): number => {
      const wanted = comparable(text);
      // A space alone is set with what was set before it.
      if (wanted === "") return spacingAt[from - 1] ?? 0;
      const at = drawn.indexOf(wanted, from);
      if (at < 0) {
        spacingOf.unread++;
        return 0;
      }
      from = at + wanted.length;
      return spacingAt[at];
    },
    { unread: 0 },
  );
  return spacingOf;
}

/** A raster's pixels, row by row, four bytes to a pixel. */
interface Pixels {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** How far apart, summed over the channels, the page and its paper may be and
 *  the text still have drawn nothing there. */
const NO_INK = 8;

/**
 * The colour a run is set in, read from the rasters because the text layer
 * does not carry fill colours.
 *
 * It is the colour of what the text drew: the page where it differs most from
 * the page without its text, which is the middle of a stroke, where nothing of
 * what lies under the text shows through its edges. Not the darkest thing
 * there, which on a dark ground is the ground: white set on green would be
 * read as green. Text that drew nothing -- the invisible text an OCR program
 * lays over a scan -- has no colour of its own, and is given that of the
 * darkest thing under it: the scanned words it stands for.
 */
export function inkColour(
  page: Pixels,
  paper: Pixels,
  area: { x: number; y: number; width: number; height: number },
): string {
  const left = Math.max(0, Math.floor(area.x));
  const top = Math.max(0, Math.floor(area.y));
  const right = Math.min(page.width, Math.ceil(area.x + area.width));
  const bottom = Math.min(page.height, Math.ceil(area.y + area.height));
  const { data } = page;
  let inked = -1;
  let difference = NO_INK;
  let darkest = -1;
  let luminance = Infinity;
  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) {
      const offset = (y * page.width + x) * 4;
      const apart =
        Math.abs(data[offset] - paper.data[offset]) +
        Math.abs(data[offset + 1] - paper.data[offset + 1]) +
        Math.abs(data[offset + 2] - paper.data[offset + 2]);
      if (apart > difference) {
        difference = apart;
        inked = offset;
      }
      const value = data[offset] * 0.299 + data[offset + 1] * 0.587 + data[offset + 2] * 0.114;
      if (value < luminance) {
        luminance = value;
        darkest = offset;
      }
    }
  }
  const at = inked >= 0 ? inked : darkest;
  if (at < 0) return "black";
  return `rgb(${data[at]}, ${data[at + 1]}, ${data[at + 2]})`;
}

/** What pdf.js exposes of a font it loaded. */
interface LoadedFont extends LoadedFontFile {
  name?: string;
  fallbackName?: string;
  bold?: boolean;
  black?: boolean;
  italic?: boolean;
}

/** A font of a page: the name its runs are given for it, and what is known of
 *  it.
 *
 *  The name is the one the file gives the font, subset tag and all, because
 *  that is the same every time the file is opened -- which the name pdf.js
 *  registers the embedded face under is not: it counts fonts in the order
 *  pages happened to be read. An edit kept from one session to the next names
 *  its fonts, and so does a paragraph joined to one from another page. Only a
 *  font the file leaves nameless is known by pdf.js's name for it.
 *
 *  What pdf.js reports of a font's weight, slant and kind comes from the flags
 *  the file's producer set, which say less, and less reliably, than the
 *  font's own PostScript name. */
function fontOf(
  page: PDFPageProxy,
  face: string,
  fallback: string | undefined,
): { name: string; info: FontInfo; own: OwnFace | null } {
  const loaded = page.commonObjs.has(face) ? (page.commonObjs.get(face) as LoadedFont | null) : null;
  const fileName = loaded?.name ?? "";
  // A subset is named `ABCDEF+RealName`.
  const name = fileName.replace(/^[A-Z]{6}\+/, "");
  const named = faceFromName(name);
  const family = loaded?.fallbackName ?? fallback ?? "serif";
  return {
    name: fileName || face,
    own: loaded ? ownFaceOf(loaded) : null,
    info: {
      name,
      face,
      generic:
        named.generic ?? (family.includes("mono") ? "monospace" : family.includes("sans") ? "sans-serif" : "serif"),
      bold: Boolean(loaded?.bold || loaded?.black) || named.bold,
      italic: Boolean(loaded?.italic) || named.italic,
    },
  };
}

/**
 * Pages drawn at the reader's current scale, kept while they are being
 * composed from.
 *
 * In edit mode a page on screen is not one page's raster: it is strips of its
 * own and of the pages before it. Those strips are cut from whole-page rasters
 * held here, each rendered once per scale and shared by every page that draws
 * from it.
 */
export class PageRasters {
  private readonly entries = new Map<string, Promise<HTMLCanvasElement>>();

  constructor(
    private readonly pdf: PDFDocumentProxy,
    /** Each raster is a full page at device resolution; a handful covers the
     *  pages on screen and the ones their content was pushed from. */
    private readonly capacity = 8,
  ) {}

  get(pageNumber: number, pixelsPerUnit: number, layer: RasterLayer = "page"): Promise<HTMLCanvasElement> {
    const key = `${layer}:${pageNumber}@${pixelsPerUnit}`;
    const cached = this.entries.get(key);
    if (cached) {
      // Re-inserted, so the map's order is recency.
      this.entries.delete(key);
      this.entries.set(key, cached);
      return cached;
    }
    const raster = this.pdf
      .getPage(pageNumber)
      .then((page) => renderPage(page, pixelsPerUnit, false, layer))
      .then(({ canvas }) => canvas);
    raster.catch(() => this.entries.delete(key));
    this.entries.set(key, raster);
    this.evict();
    return raster;
  }

  private evict(): void {
    while (this.entries.size > this.capacity) {
      const [oldest, raster] = this.entries.entries().next().value as [
        string,
        Promise<HTMLCanvasElement>,
      ];
      this.entries.delete(oldest);
      release(raster);
    }
  }

  dispose(): void {
    for (const raster of this.entries.values()) release(raster);
    this.entries.clear();
  }
}

function release(raster: Promise<HTMLCanvasElement>): void {
  raster.then(
    (canvas) => {
      canvas.width = 0;
      canvas.height = 0;
    },
    // A raster that failed to render holds nothing to release, and its failure
    // was already reported to whoever asked for it.
    () => undefined,
  );
}
