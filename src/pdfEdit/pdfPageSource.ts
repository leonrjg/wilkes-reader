import { AnnotationMode, OPS, Util } from "../pdfjs.js";
import type { PDFDocumentProxy, PDFPageProxy } from "../pdfjs.js";
import { installReadableStreamAsyncIterator } from "../readableStreamAsyncIterator.js";
import { faceFromName } from "./fontNames.js";
import type { PdfFontRequest } from "./hostFonts.js";
import { inkGridFromImage } from "./inkGrid.js";
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
interface WalkedOperations {
  fnArray: number[];
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
): Promise<{ canvas: HTMLCanvasElement; context: CanvasRenderingContext2D }> {
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
  return { canvas, context };
}

export async function analysePage(pdf: PDFDocumentProxy, pageNumber: number): Promise<PageAnalysis> {
  const page = await pdf.getPage(pageNumber);
  const { canvas, context } = await renderPage(page, ANALYSIS_SCALE, true);
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  // Release the surface now rather than at collection: these are megabytes.
  canvas.width = 0;
  canvas.height = 0;
  const layout = layoutFromInk(inkGridFromImage(image, ANALYSIS_SCALE));

  installReadableStreamAsyncIterator();
  const content = await page.getTextContent();
  const toPage = page.getViewport({ scale: 1 }).transform;
  const runs: TextRun[] = [];
  const fonts = new Map<string, FontInfo>();
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
    }
    runs.push({
      text: item.str,
      x: transform[4],
      width: item.width,
      baseline: transform[5],
      fontSize,
      fontName,
      color: inkColour(image, {
        x: transform[4] * ANALYSIS_SCALE,
        y: (transform[5] - fontSize * 0.75) * ANALYSIS_SCALE,
        width: item.width * ANALYSIS_SCALE,
        height: fontSize * 0.95 * ANALYSIS_SCALE,
      }),
    });
  }
  return { layout, runs, fonts };
}

/** The colour a run is set in: the darkest thing drawn where it sits. Read
 *  from the raster because the text layer does not carry fill colours. */
function inkColour(
  image: ImageData,
  area: { x: number; y: number; width: number; height: number },
): string {
  const left = Math.max(0, Math.floor(area.x));
  const top = Math.max(0, Math.floor(area.y));
  const right = Math.min(image.width, Math.ceil(area.x + area.width));
  const bottom = Math.min(image.height, Math.ceil(area.y + area.height));
  let darkest = -1;
  let luminance = Infinity;
  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) {
      const offset = (y * image.width + x) * 4;
      const value =
        image.data[offset] * 0.299 + image.data[offset + 1] * 0.587 + image.data[offset + 2] * 0.114;
      if (value < luminance) {
        luminance = value;
        darkest = offset;
      }
    }
  }
  if (darkest < 0) return "black";
  return `rgb(${image.data[darkest]}, ${image.data[darkest + 1]}, ${image.data[darkest + 2]})`;
}

/** What pdf.js exposes of a font it loaded. */
interface LoadedFont {
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
): { name: string; info: FontInfo } {
  const loaded = page.commonObjs.has(face) ? (page.commonObjs.get(face) as LoadedFont | null) : null;
  const fileName = loaded?.name ?? "";
  // A subset is named `ABCDEF+RealName`.
  const name = fileName.replace(/^[A-Z]{6}\+/, "");
  const named = faceFromName(name);
  const family = loaded?.fallbackName ?? fallback ?? "serif";
  return {
    name: fileName || face,
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
