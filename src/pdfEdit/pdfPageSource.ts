import { AnnotationMode, OPS, Util } from "../pdfjs.js";
import type { PDFDocumentProxy, PDFPageProxy } from "../pdfjs.js";
import { installReadableStreamAsyncIterator } from "../readableStreamAsyncIterator.js";
import type { PdfFontRequest } from "./hostFonts.js";
import { inkGridFromImage } from "./inkGrid.js";
import { layoutFromInk, type PageLayout } from "./pageLayout.js";
import type { TextRun } from "./paragraphs.js";

/**
 * Everything the editor takes from pdf.js: a page's raster, its analysis, and
 * its text. Nothing else under `pdfEdit/` touches the library, so the flow and
 * the reflow can be reasoned about -- and tested -- as plain data.
 */

/** What is known of a font a page uses: its own name in the file, its weight
 *  and slant, and the generic family it belongs to. The same four things a
 *  host is asked to find a whole font by. */
export type FontInfo = PdfFontRequest;

export interface PageAnalysis {
  layout: PageLayout;
  runs: TextRun[];
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

/** The operations of a page that draw text, by their place in its list. */
async function textOperations(page: PDFPageProxy): Promise<Set<number>> {
  const { fnArray } = await page.getOperatorList();
  const indices = new Set<number>();
  fnArray.forEach((operation, index) => {
    if (TEXT_OPERATIONS.has(operation)) indices.add(index);
  });
  return indices;
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
  const text = layer === "paper" ? await textOperations(page) : null;
  // The same choices `PdfPageCanvas` makes, for the same reasons: an opaque
  // white sheet, with annotation appearances baked in.
  await page.render({
    annotationMode: AnnotationMode.ENABLE,
    canvas,
    canvasContext: context,
    viewport,
    background: "white",
    ...(text ? { operationsFilter: (index: number) => !text.has(index) } : {}),
  }).promise;
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
  for (const item of content.items) {
    if (!("str" in item) || item.str.length === 0) continue;
    const transform = Util.transform(toPage, item.transform);
    // Text set at an angle is not a line of a paragraph; leave it to the page.
    if (Math.abs(transform[1]) > 0.01 * Math.abs(transform[0])) continue;
    const fontSize = Math.hypot(transform[2], transform[3]);
    runs.push({
      text: item.str,
      x: transform[4],
      width: item.width,
      baseline: transform[5],
      fontSize,
      fontName: item.fontName,
      color: inkColour(image, {
        x: transform[4] * ANALYSIS_SCALE,
        y: (transform[5] - fontSize * 0.75) * ANALYSIS_SCALE,
        width: item.width * ANALYSIS_SCALE,
        height: fontSize * 0.95 * ANALYSIS_SCALE,
      }),
    });
    if (!fonts.has(item.fontName)) {
      fonts.set(item.fontName, fontInfo(page, item.fontName, content.styles[item.fontName]?.fontFamily));
    }
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

/** pdf.js registers an embedded font under a generated name and with no weight
 *  or style, so the only record of either is the font's own PostScript name. */
function fontInfo(page: PDFPageProxy, fontName: string, fallback: string | undefined): FontInfo {
  const loaded = page.commonObjs.has(fontName)
    ? (page.commonObjs.get(fontName) as LoadedFont | null)
    : null;
  // A subset is named `ABCDEF+RealName`.
  const name = (loaded?.name ?? "").replace(/^[A-Z]{6}\+/, "");
  const family = loaded?.fallbackName ?? fallback ?? "serif";
  return {
    name,
    generic: family.includes("mono") ? "monospace" : family.includes("sans") ? "sans-serif" : "serif",
    bold: Boolean(loaded?.bold || loaded?.black) || /bold|black|heavy|semibold|demi|^cmbx/i.test(name),
    italic: Boolean(loaded?.italic) || /italic|oblique|^cm(?:ti|sl)/i.test(name),
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
