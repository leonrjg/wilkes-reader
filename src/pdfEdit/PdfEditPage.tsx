import { useEffect, useRef, useState } from "react";
import type { BoundingBox } from "../documentCoordinates.js";
import type { PageView, ParagraphHit, PdfEditSession } from "./usePdfEditSession.js";

/**
 * One page in edit mode: the page's raster, cut into strips and put back where
 * the reflow says each one goes.
 *
 * A page no edit reaches is drawn whole, straight from its raster. A page one
 * does reach is composed: bare paper, then its fixed areas, then every strip
 * placed on it -- its own and any pushed onto it from the page before. Edited
 * paragraphs are not drawn here at all; they are live text laid over the gap
 * this leaves (`PdfEditBlocks`).
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
  const [hover, setHover] = useState<ParagraphHit | null>(null);
  const onRenderSuccessRef = useRef(onRenderSuccess);
  onRenderSuccessRef.current = onRenderSuccess;

  const scale = width / size.width;
  const pixelsPerUnit = scale * (window.devicePixelRatio || 1);
  const { rasters, requestAnalysis, documentPages } = session;
  const { flow, placements } = session.pageView(pageNumber);

  useEffect(() => requestAnalysis(pageNumber), [requestAnalysis, pageNumber]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;

    const sources = sourcePages({ flow, placements }, pageNumber, documentPages);
    const compose = async () => {
      const loaded = await Promise.all(
        sources.map(async (page) => [page, await rasters.get(page, pixelsPerUnit)] as const),
      );
      if (cancelled) return;
      // A raster can be evicted, and its surface released, between being
      // handed out and being drawn. Ask again rather than draw from nothing.
      if (loaded.some(([, raster]) => raster.width === 0)) return compose();
      draw(canvas, { flow, placements }, new Map(loaded), pageNumber, pixelsPerUnit);
      onRenderSuccessRef.current?.();
    };
    compose().catch((error) => {
      if (!cancelled) console.error(`PDF edit: drawing page ${pageNumber} failed:`, error);
    });

    return () => {
      cancelled = true;
    };
  }, [flow, placements, rasters, pageNumber, documentPages, pixelsPerUnit]);

  const pagePoint = (event: React.MouseEvent) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return { x: (event.clientX - bounds.left) / scale, y: (event.clientY - bounds.top) / scale };
  };

  return (
    <div
      className="pdf-page pdf-edit-page"
      style={{
        position: "relative",
        width: Math.floor(size.width * scale),
        cursor: hover ? "text" : "default",
      }}
      onMouseMove={(event) => {
        const { x, y } = pagePoint(event);
        const hit = session.paragraphAt(pageNumber, x, y);
        setHover((current) => (current?.paragraph === hit?.paragraph ? current : hit));
      }}
      onMouseLeave={() => setHover(null)}
      onClick={(event) => {
        const { x, y } = pagePoint(event);
        const hit = session.paragraphAt(pageNumber, x, y);
        const canvas = canvasRef.current;
        if (!hit || !canvas) return;
        const color = inkColour(canvas, hit.box, pixelsPerUnit);
        setHover(null);
        session.beginEdit(hit.paragraph, color, { clientX: event.clientX, clientY: event.clientY });
      }}
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
      {hover && (
        <div
          className="pdf-edit-target"
          style={{
            left: hover.box.x * scale,
            top: hover.box.y * scale,
            width: hover.box.width * scale,
            height: hover.box.height * scale,
          }}
        />
      )}
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

/** The colour a paragraph is set in: the darkest thing drawn in its box. Read
 *  from the canvas because the text layer does not carry fill colours. */
function inkColour(canvas: HTMLCanvasElement, box: BoundingBox, pixelsPerUnit: number): string {
  const context = canvas.getContext("2d");
  const left = Math.max(0, Math.floor(box.x * pixelsPerUnit));
  const top = Math.max(0, Math.floor(box.y * pixelsPerUnit));
  const width = Math.min(canvas.width - left, Math.ceil(box.width * pixelsPerUnit));
  const height = Math.min(canvas.height - top, Math.ceil(box.height * pixelsPerUnit));
  if (!context || width <= 0 || height <= 0) return "black";
  const { data } = context.getImageData(left, top, width, height);
  let darkest = 0;
  let luminance = Infinity;
  for (let offset = 0; offset < data.length; offset += 4) {
    const value = data[offset] * 0.299 + data[offset + 1] * 0.587 + data[offset + 2] * 0.114;
    if (value < luminance) {
      luminance = value;
      darkest = offset;
    }
  }
  return `rgb(${data[darkest]}, ${data[darkest + 1]}, ${data[darkest + 2]})`;
}
