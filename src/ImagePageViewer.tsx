import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useReaderHost } from "./ReaderHost.js";
import { elementAnchor, rectDecorationsForPage, unionBox, type Decoration } from "./decorations.js";
import type { BoundingBox } from "./documentCoordinates.js";
import type { PdfScrollAnchor } from "./readerPositions.js";
import ZoomControls, { PAGE_MAX_ZOOM, PAGE_MIN_ZOOM, PageIndicator, ViewerToolbar, stepPageZoom } from "./ZoomControls.js";
import { pageStepKeyDown, steppedPage, useZoomShortcuts } from "./readerShortcuts.js";

export interface ImagePage {
  width: number;
  height: number;
  image: Blob;
}
export interface ImagePageSource {
  key: string;
  pageCount: number;
  loadPage: (page: number, signal: AbortSignal) => Promise<ImagePage>;
}
export interface ImagePageViewerProps {
  source: ImagePageSource;
  page: number;
  highlight_bbox?: BoundingBox | null;
  decorations?: Decoration[];
  onPageChange?: (page: number) => void;
  onRenderSuccess?: () => void;
}

/** A queue belongs to one open source. Aborted queued jobs never reach the host;
 * running jobs retain their slot until the transport settles (including IPC,
 * whose promise cannot itself be cancelled). Fast scrolling cannot fan out IO. */
export class ImagePageQueue {
  private active = 0;
  private waiting: Array<() => void> = [];
  constructor(private readonly load: ImagePageSource["loadPage"]) {}
  loadPage(page: number, signal: AbortSignal): Promise<ImagePage> {
    return new Promise((resolve, reject) => {
      const aborted = () => reject(new DOMException("Aborted", "AbortError"));
      if (signal.aborted) { aborted(); return; }
      const run = () => {
        signal.removeEventListener("abort", cancel);
        if (signal.aborted) { aborted(); return; }
        this.active++;
        this.load(page, signal).then(resolve, reject).finally(() => {
          this.active--;
          this.drain();
        });
      };
      const cancel = () => {
        this.waiting = this.waiting.filter(job => job !== run);
        signal.removeEventListener("abort", cancel);
        aborted();
      };
      signal.addEventListener("abort", cancel, { once: true });
      this.waiting.push(run);
      this.drain();
    });
  }
  private drain() {
    while (this.active < 2 && this.waiting.length) this.waiting.shift()!();
  }
}

const GAP = 12;
const clampZoom = (zoom: number) => Math.max(PAGE_MIN_ZOOM, Math.min(PAGE_MAX_ZOOM, zoom));
export function imagePageLayout(count: number, width: number, metrics: ReadonlyMap<number, {width: number; height: number}>) {
  const estimate = metrics.values().next().value;
  const ratio = estimate ? estimate.height / estimate.width : 1.4;
  let offset = GAP;
  return Array.from({ length: count }, (_, index) => {
    const metric = metrics.get(index + 1);
    const height = Math.max(1, width * (metric ? metric.height / metric.width : ratio));
    const entry = { top: offset, height, metric };
    offset += height + GAP;
    return entry;
  });
}

/** One page's slot. A page that cannot be loaded or decoded says so in its own
 * slot and nowhere else: the pages around it are still good, so one bad entry
 * in an archive never takes the document with it. A failed slot counts as
 * settled, because the reader has drawn all it can for that page. */
function ImageSurface({ page, queue, onMetric, onSettled }: {
  page: number; queue: ImagePageQueue;
  onMetric: (page: number, metric: ImagePage) => void;
  onSettled: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const callbacks = useRef({ onMetric, onSettled });
  callbacks.current = { onMetric, onSettled };
  const fail = (error: unknown) => {
    console.error(`Could not load page ${page}:`, error);
    setFailed(true);
    callbacks.current.onSettled();
  };
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | null = null;
    setUrl(null);
    setFailed(false);
    queue.loadPage(page, controller.signal).then(result => {
      if (controller.signal.aborted) return;
      callbacks.current.onMetric(page, result);
      objectUrl = URL.createObjectURL(result.image);
      setUrl(objectUrl);
    }).catch(error => {
      if (!controller.signal.aborted) fail(error);
    });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [page, queue]);
  if (failed) return <div className="pdf-page-message" role="alert">Could not load page {page}</div>;
  return url ? <img src={url} alt={`Page ${page}`} draggable={false}
    onLoad={() => callbacks.current.onSettled()}
    onError={() => fail(new Error(`Could not display page ${page}`))}
    style={{ width: "100%", height: "100%", display: "block", objectFit: "fill" }} />
    : <div className="pdf-page-message">Loading page…</div>;
}

/** Image documents share the host's page coordinates and position store, while
 * retaining only visible images and one neighbouring page on either side. */
export default function ImagePageViewer(props: ImagePageViewerProps) {
  return <ImagePageDocument key={props.source.key} {...props} />;
}

function ImagePageDocument({ source, page, highlight_bbox, decorations = [], onPageChange, onRenderSuccess }: ImagePageViewerProps) {
  const { positions, colorScheme } = useReaderHost();
  const remembered = useRef(positions.readPdf(source.key));
  const [zoom, setZoom] = useState(() => clampZoom(remembered.current?.zoom ?? 1));
  const [viewport, setViewport] = useState({ width: 600, height: 800, top: 0 });
  const [metrics, setMetrics] = useState(new Map<number, {width: number; height: number}>());
  const landing = Math.max(1, Math.min(source.pageCount,
    remembered.current && page === 1 && !highlight_bbox ? remembered.current.page : page));
  const [currentPage, setCurrentPage] = useState(landing);
  const container = useRef<HTMLDivElement>(null);
  const anchor = useRef<PdfScrollAnchor>(remembered.current && page === 1 && !highlight_bbox
    ? { ...remembered.current, page: landing } : { page: landing, offsetRatio: 0, horizontalRatio: 0.5 });
  const callbacks = useRef({ onPageChange, onRenderSuccess });
  callbacks.current = { onPageChange, onRenderSuccess };
  const queue = useMemo(() => new ImagePageQueue(source.loadPage), [source]);
  const width = Math.max(160, viewport.width) * zoom;
  const layout = useMemo(() => imagePageLayout(source.pageCount, width, metrics), [source.pageCount, width, metrics]);
  const virtualizer = useVirtualizer({
    count: source.pageCount,
    getScrollElement: () => container.current,
    estimateSize: index => layout[index].height + GAP,
    getItemKey: index => index + 1,
    paddingStart: GAP,
    overscan: 1,
    initialRect: { width: 600, height: 800 },
    initialOffset: () => layout[landing - 1].top + layout[landing - 1].height * anchor.current.offsetRatio,
  });
  const initialSignalled = useRef(false);
  const targetKey = `${page}:${highlight_bbox?.x}:${highlight_bbox?.y}:${highlight_bbox?.width}:${highlight_bbox?.height}`;
  const previousTarget = useRef(targetKey);
  const pendingReveal = useRef(highlight_bbox ?? null);
  const clampPage = (value: number) => Math.max(1, Math.min(source.pageCount, Math.trunc(value)));
  const navigate = (value: number, box?: BoundingBox | null) => {
    const target = clampPage(value);
    const metric = metrics.get(target);
    pendingReveal.current = box && !metric ? box : null;
    anchor.current = { page: target, offsetRatio: box && metric ? box.y / metric.height : 0, horizontalRatio: 0.5 };
    const item = layout[target - 1];
    if (container.current && item) {
      container.current.scrollTop = item.top + item.height * anchor.current.offsetRatio;
      setViewport(v => ({ ...v, top: container.current!.scrollTop }));
    }
    setCurrentPage(target);
  };
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      setViewport(v => ({ ...v, width: entry.contentRect.width, height: entry.contentRect.height }));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  // Restore the same page and fractional offset after a width, zoom, or lazy
  // metric correction, rather than retaining a pixel offset into a new layout.
  useLayoutEffect(() => {
    virtualizer.measure();
    const element = container.current;
    const item = layout[clampPage(anchor.current.page) - 1];
    if (!element || !item) return;
    element.scrollTop = item.top + item.height * anchor.current.offsetRatio;
    element.scrollLeft = Math.max(0, width * anchor.current.horizontalRatio - viewport.width / 2);
    setViewport(v => ({ ...v, top: element.scrollTop }));
  }, [layout, width, viewport.width]);
  useEffect(() => {
    if (previousTarget.current === targetKey) return;
    previousTarget.current = targetKey;
    navigate(page, highlight_bbox);
  }, [targetKey]);
  useEffect(() => {
    const timer = setTimeout(() => callbacks.current.onPageChange?.(currentPage), 400);
    return () => clearTimeout(timer);
  }, [currentPage]);
  useEffect(() => () => {
    positions.savePdf(source.key, { ...anchor.current, zoom });
  }, [positions, source.key, zoom]);

  useZoomShortcuts({
    zoomIn: () => setZoom(v => stepPageZoom(v, 1)),
    zoomOut: () => setZoom(v => stepPageZoom(v, -1)),
    resetZoom: () => setZoom(1),
  });
  const onPageStepKeyDown = pageStepKeyDown(direction => navigate(steppedPage(anchor.current, direction, source.pageCount)));

  const onScroll = () => {
    const element = container.current!;
    const index = Math.max(0, layout.findIndex(item => item.top + item.height >= element.scrollTop));
    const item = layout[index];
    if (!item) return;
    anchor.current = { page: index + 1, offsetRatio: Math.max(0, (element.scrollTop - item.top) / item.height), horizontalRatio: (element.scrollLeft + element.clientWidth / 2) / width };
    positions.savePdf(source.key, { ...anchor.current, zoom });
    const center = element.scrollTop + element.clientHeight / 2;
    const centered = layout.findIndex(item => item.top + item.height >= center);
    setCurrentPage(centered < 0 ? layout.length : centered + 1);
    setViewport(v => ({ ...v, top: element.scrollTop }));
  };
  return <div className="relative flex h-full min-h-0 flex-col" onKeyDown={onPageStepKeyDown}>
    <ViewerToolbar>
      <PageIndicator page={currentPage} pageCount={source.pageCount} />
      <ZoomControls zoom={zoom} onZoomIn={() => setZoom(v => stepPageZoom(v, 1))} onZoomOut={() => setZoom(v => stepPageZoom(v, -1))} />
    </ViewerToolbar>
    <div ref={container} tabIndex={0} onScroll={onScroll} className={`relative min-h-0 flex-1 overflow-auto outline-none ${colorScheme === "dark" ? "pdf-dark-mode" : ""}`} style={{ overflowAnchor: "none" }}>
      <div style={{ position: "relative", width: Math.max(width, viewport.width), height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map(virtualItem => {
          const number = virtualItem.index + 1;
          const item = layout[virtualItem.index];
          const scale = item.metric ? width / item.metric.width : 1;
          return <div key={number} data-page-number={number} className="pdf-page" style={{ position: "absolute", top: item.top, left: Math.max(0, (viewport.width - width) / 2), width, height: item.height }}>
            <ImageSurface page={number} queue={queue} onMetric={(number, result) => {
              if (number === anchor.current.page && pendingReveal.current) {
                anchor.current = { ...anchor.current, offsetRatio: Math.max(0, Math.min(1, pendingReveal.current.y / result.height)) };
                pendingReveal.current = null;
              }
              setMetrics(previous => {
              if (previous.get(number)?.width === result.width && previous.get(number)?.height === result.height) return previous;
              const next = new Map(previous); next.set(number, { width: result.width, height: result.height }); return next;
            }); }} onSettled={() => {
              if (item.top + item.height > viewport.top && item.top < viewport.top + viewport.height && !initialSignalled.current) {
                initialSignalled.current = true; callbacks.current.onRenderSuccess?.();
              }
            }} />
            {item.metric && rectDecorationsForPage(decorations, number).map(decoration => {
              const box = unionBox(decoration.anchor.rects);
              return <div key={decoration.id} style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
                {decoration.anchor.rects.map((rect, index) => <div key={index}
                  role={decoration.onActivate ? "button" : undefined} tabIndex={decoration.onActivate ? 0 : undefined}
                  aria-label={decoration.ariaLabel} className={`pdf-highlight ${decoration.className ?? ""}`}
                  onClick={event => decoration.onActivate?.(decoration.id, elementAnchor(event.currentTarget))}
                  onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); decoration.onActivate?.(decoration.id, elementAnchor(event.currentTarget)); } }}
                  style={{ position: "absolute", left: rect.x * scale, top: rect.y * scale, width: rect.width * scale, height: rect.height * scale, pointerEvents: decoration.onActivate ? "auto" : "none" }} />)}
                {decoration.render && <div style={{ position: "absolute", left: box.x * scale, top: box.y * scale, width: box.width * scale, height: box.height * scale, pointerEvents: "auto" }}>{decoration.render({ scale, box, page: number })}</div>}
              </div>;
            })}
          </div>;
        })}
      </div>
    </div>
  </div>;
}
