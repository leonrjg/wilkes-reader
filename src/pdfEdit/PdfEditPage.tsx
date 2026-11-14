import { useEffect, useRef } from "react";
import type { BoundingBox } from "../documentCoordinates.js";
import type { PageView, PdfEditSession } from "./usePdfEditSession.js";

/**
 * One page in edit mode: the page's raster, cut into strips and put back where
 * the reflow says each one goes.
 *
 * A page no edit reaches is drawn whole, straight from its raster. A page one
 * does reach is composed: bare paper, then its fixed areas, then every strip
 * placed on it -- its own and any pushed onto it from the page before. Edited
 * paragraphs are not drawn here at all; they are live text laid over the gap
 * this leaves, and so is everything the reader does with the pointer and the
 * keyboard (`PdfEditBlocks`). This is only the paper.
 */

interface PdfEditPageProps {
  session: PdfEditSession;
  pageNumber: number;
  /** Target CSS width in px. */
  width: number;
  /** The page's size in its own units. */
  size: { width: number; height: number };
  onRenderSuccess?: () => void;
}

/** Drawn around each strip, in page units. The analysis reads the page at a
 *  coarser scale than it is drawn at and discounts near-paper pixels, so the
 *  antialiased edge of a glyph falls a little outside what it counted as ink.
 *  Sideways there is a margin or a gutter to spare; between lines there is not. */
const STRIP_MARGIN = { x: 1, y: 0.5 };

export default function PdfEditPage({
  session,
  pageNumber,
  width,
  size,
  onRenderSuccess,
}: PdfEditPageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onRenderSuccessRef = useRef(onRenderSuccess);
  onRenderSuccessRef.current = onRenderSuccess;

  const scale = width / size.width;
  const pixelsPerUnit = scale * (window.devicePixelRatio || 1);
  const { rasters, requestAnalysis, documentPages } = session;
  const { flow, placements, backdrops } = session.pageView(pageNumber);

  useEffect(() => requestAnalysis(pageNumber), [requestAnalysis, pageNumber]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;

    const view = { flow, placements, backdrops };
    const sources = sourcePages(view, pageNumber, documentPages);
    const paperSources = [...new Set(backdrops.map((backdrop) => backdrop.source.page))];
    const compose = async () => {
      const [loaded, paper] = await Promise.all([
        Promise.all(sources.map(async (page) => [page, await rasters.get(page, pixelsPerUnit)] as const)),
        Promise.all(
          paperSources.map(async (page) => [page, await rasters.get(page, pixelsPerUnit, "paper")] as const),
        ),
      ]);
      if (cancelled) return;
      // A raster can be evicted, and its surface released, between being
      // handed out and being drawn. Ask again rather than draw from nothing.
      if ([...loaded, ...paper].some(([, raster]) => raster.width === 0)) return compose();
      draw(canvas, view, new Map(loaded), new Map(paper), pageNumber, pixelsPerUnit);
      onRenderSuccessRef.current?.();
    };
    compose().catch((error) => {
      if (!cancelled) console.error(`PDF edit: drawing page ${pageNumber} failed:`, error);
    });

    return () => {
      cancelled = true;
    };
  }, [flow, placements, backdrops, rasters, pageNumber, documentPages, pixelsPerUnit]);

  return (
    <div
      className="pdf-page pdf-edit-page"
      style={{ position: "relative", width: Math.floor(size.width * scale) }}
    >
      <canvas
        ref={canvasRef}
        width={Math.floor(size.width * pixelsPerUnit)}
        height={Math.floor(size.height * pixelsPerUnit)}
        style={{
          display: "block",
          width: `${Math.floor(size.width * scale)}px`,
          height: `${Math.floor(size.height * scale)}px`,
        }}
      />
    </div>
  );
}

/** The pages whose rasters a view is cut from. */
function sourcePages(view: PageView, pageNumber: number, documentPages: number): number[] {
  const pages = new Set<number>();
  if (pageNumber <= documentPages && (!view.placements || (view.flow?.fixed.length ?? 0) > 0)) {
    pages.add(pageNumber);
  }
  for (const { item } of view.placements ?? []) {
    if (item.content.kind === "slice") pages.add(item.content.page);
  }
  return [...pages];
}

function draw(
  canvas: HTMLCanvasElement,
  view: PageView,
  rasters: Map<number, HTMLCanvasElement>,
  paper: Map<number, HTMLCanvasElement>,
  pageNumber: number,
  pixelsPerUnit: number,
): void {
  const context = canvas.getContext("2d");
  if (!context) throw new Error("PDF edit: no 2D canvas context is available");

  const own = rasters.get(pageNumber);
  if (!view.placements) {
    if (own) context.drawImage(own, 0, 0);
    return;
  }

  context.fillStyle = view.flow?.background ?? "white";
  context.fillRect(0, 0, canvas.width, canvas.height);
  if (own) {
    for (const rect of view.flow?.fixed ?? []) {
      copyStrip(context, own, rect, rect.x, rect.y, pixelsPerUnit, { x: 0, y: 0 });
    }
  }
  // Under everything else: what an edited paragraph stood on, without its
  // words. The words are live text, laid over this.
  for (const backdrop of view.backdrops) {
    const source = paper.get(backdrop.source.page);
    if (!source) continue;
    copyStrip(context, source, backdrop.source.rect, backdrop.x, backdrop.y, pixelsPerUnit, { x: 0, y: 0 });
  }
  for (const placement of view.placements) {
    const { content } = placement.item;
    if (content.kind !== "slice") continue;
    const source = rasters.get(content.page);
    if (!source) continue;
    copyStrip(context, source, content.rect, placement.x, placement.y, pixelsPerUnit, STRIP_MARGIN);
  }
}

/** Copy an area of a raster to a new position, pixel for pixel. The offset is
 *  rounded rather than the two corners, so a strip that did not move lands on
 *  exactly the pixels it came from. */
function copyStrip(
  context: CanvasRenderingContext2D,
  source: HTMLCanvasElement,
  rect: BoundingBox,
  x: number,
  y: number,
  pixelsPerUnit: number,
  margin: { x: number; y: number },
): void {
  const left = Math.max(0, Math.floor((rect.x - margin.x) * pixelsPerUnit));
  const top = Math.max(0, Math.floor((rect.y - margin.y) * pixelsPerUnit));
  const right = Math.min(source.width, Math.ceil((rect.x + rect.width + margin.x) * pixelsPerUnit));
  const bottom = Math.min(source.height, Math.ceil((rect.y + rect.height + margin.y) * pixelsPerUnit));
  if (right <= left || bottom <= top) return;
  context.drawImage(
    source,
    left,
    top,
    right - left,
    bottom - top,
    left + Math.round((x - rect.x) * pixelsPerUnit),
    top + Math.round((y - rect.y) * pixelsPerUnit),
    right - left,
    bottom - top,
  );
}
