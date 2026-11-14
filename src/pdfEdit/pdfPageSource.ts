import { AnnotationMode, Util } from "../pdfjs.js";
import type { PDFDocumentProxy, PDFPageProxy } from "../pdfjs.js";
import { installReadableStreamAsyncIterator } from "../readableStreamAsyncIterator.js";
import { inkGridFromImage } from "./inkGrid.js";
import { layoutFromInk, type PageLayout } from "./pageLayout.js";
import type { TextRun } from "./paragraphs.js";

/**
 * Everything the editor takes from pdf.js: a page's raster, its analysis, and
 * its text. Nothing else under `pdfEdit/` touches the library, so the flow and
 * the reflow can be reasoned about -- and tested -- as plain data.
 */

/** How a run's embedded font should be asked for in CSS. */
export interface FontInfo {
  /** The font's own name in the file, without a subset's random prefix. */
  name: string;
  /** The generic family pdf.js would fall back to. */
  fallback: string;
  bold: boolean;
  italic: boolean;
}

export interface PageAnalysis {
  layout: PageLayout;
  runs: TextRun[];
  fonts: Map<string, FontInfo>;
}

/** Pixels per page unit the layout is read at. Fixed, so a page's analysis is
 *  a property of the page and does not change with the reader's zoom. Two is
 *  the coarsest grid that still resolves the gap between tightly set lines. */
const ANALYSIS_SCALE = 2;

async function renderPage(
  page: PDFPageProxy,
  pixelsPerUnit: number,
  readBack: boolean,
): Promise<{ canvas: HTMLCanvasElement; context: CanvasRenderingContext2D }> {
  const viewport = page.getViewport({ scale: pixelsPerUnit });
  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const context = canvas.getContext("2d", { alpha: false, willReadFrequently: readBack });
  if (!context) throw new Error("PDF edit: no 2D canvas context is available");
  // The same choices `PdfPageCanvas` makes, for the same reasons: an opaque
  // white sheet, with annotation appearances baked in.
  await page.render({
    annotationMode: AnnotationMode.ENABLE,
    canvas,
    canvasContext: context,
    viewport,
    background: "white",
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
  return {
    name,
    fallback: loaded?.fallbackName ?? fallback ?? "serif",
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

  get(pageNumber: number, pixelsPerUnit: number): Promise<HTMLCanvasElement> {
    const key = `${pageNumber}@${pixelsPerUnit}`;
    const cached = this.entries.get(key);
    if (cached) {
      // Re-inserted, so the map's order is recency.
      this.entries.delete(key);
      this.entries.set(key, cached);
      return cached;
    }
    const raster = this.pdf
      .getPage(pageNumber)
      .then((page) => renderPage(page, pixelsPerUnit, false))
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
