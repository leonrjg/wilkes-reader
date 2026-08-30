import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type Ref,
} from "react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { toJsxRuntime } from "hast-util-to-jsx-runtime";
import type { ByteRange } from "./documentCoordinates.js";
import SelectionLayer from "./SelectionLayer.js";
import FindBar from "./FindBar.js";
import ZoomControls, { ZOOM_STEP } from "./ZoomControls.js";
import { useDocumentFind } from "./useDocumentFind.js";
import { useDomTextFind } from "./useDomTextFind.js";
import { useReaderHost } from "./ReaderHost.js";
import { LOCAL_LINK_ATTRIBUTE, markHtmlDocument, parseHtmlDocument } from "./htmlDocument.js";
import { sourceRunSelection, type TextAnnotation } from "./sourceRuns.js";
import {
  readTextScrollPosition,
  saveTextScrollPosition,
  readTextZoom,
  saveTextZoom,
  TEXT_MIN_ZOOM,
  TEXT_MAX_ZOOM,
} from "./textScrollMemory.js";
import { useDomDocumentSelection } from "./useDomDocumentSelection.js";
import { elementAnchor, rangeDecorations, type Decoration } from "./decorations.js";
import type { ReaderSlots } from "./slots.js";
import type { FindableReaderHandle, ZoomableReaderHandle } from "./readerHandle.js";

/** The reader's own emphasis for the navigation target. Kept distinct from the
 *  host's decorations: where a document opens is the reader's business. */
const SEARCH_DECORATION_ID = "reader:search";

/** Sanitizing prefixes every `id` in the document, so that a document cannot
 *  put an element where one of the application's own ids used to resolve. An
 *  in-document link has to be resolved through the same prefix. */
const ID_PREFIX = "user-content-";

export interface HtmlReaderHandle extends FindableReaderHandle, ZoomableReaderHandle {}

export interface HtmlViewerProps {
  content: string;
  documentPath: string;
  restoreScrollPosition?: boolean;
  highlightRange: ByteRange;
  /** Host-owned marks. Only `range`-anchored decorations are placeable here;
   *  `rects` anchors belong to the PDF reader and are ignored. */
  decorations?: Decoration[];
  slots?: ReaderSlots;
  ref?: Ref<HtmlReaderHandle>;
}

/**
 * An HTML file, read as a document.
 *
 * A browser would give the file its own stylesheet, its scripts and the
 * network; this gives it the reader's typography and nothing else, because
 * what is being opened is a file from a corpus rather than a page from a site.
 * What it does give it is everything the other readers give a document:
 * selections and bookmarks in the file's own bytes, the same find bar, the same
 * zoom, and the host's chrome in the same slots.
 */
export default function HtmlViewer({
  content,
  documentPath,
  restoreScrollPosition = true,
  highlightRange,
  decorations = [],
  slots,
  ref,
}: HtmlViewerProps) {
  const { openExternal, resolveLocalAsset } = useReaderHost();
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const annotations = useMemo<TextAnnotation[]>(() => [
    ...(highlightRange.end > highlightRange.start
      ? [{ id: SEARCH_DECORATION_ID, className: "rendered-search-highlight", range: highlightRange }]
      : []),
    ...rangeDecorations(decorations),
  ], [decorations, highlightRange]);

  // Parsing and marking are separate memos because they change on different
  // things: the file is parsed when the file changes, and marked again whenever
  // the host moves a bookmark or the search target, which is far more often.
  const parsed = useMemo(
    () => parseHtmlDocument(content, { documentPath, resolveLocalAsset }),
    [content, documentPath, resolveLocalAsset],
  );
  const rendered = useMemo(
    () => toJsxRuntime(markHtmlDocument(parsed, content, annotations), { Fragment, jsx, jsxs }),
    [parsed, content, annotations],
  );

  const mapSelection = useCallback(
    (range: Range, selection: Selection) => sourceRunSelection(content, range, selection),
    [content],
  );
  const domSelection = useDomDocumentSelection({
    rootRef,
    mapSelection,
    dismissOnCollapsedSelection: true,
  });

  const [zoom, setZoom] = useState(() => readTextZoom(documentPath));
  const changeZoom = useCallback((next: (zoom: number) => number) => {
    setZoom((current) => {
      const clamped = Math.min(Math.max(+next(current).toFixed(2), TEXT_MIN_ZOOM), TEXT_MAX_ZOOM);
      saveTextZoom(documentPath, clamped);
      return clamped;
    });
  }, [documentPath]);

  // The viewer stays mounted across documents, so pick up the newly opened
  // file's remembered zoom the same way the scroll effect re-reads its position.
  useEffect(() => setZoom(readTextZoom(documentPath)), [documentPath]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key === "=" || event.key === "+") {
        event.preventDefault();
        changeZoom((z) => z + ZOOM_STEP);
      } else if (event.key === "-") {
        event.preventDefault();
        changeZoom((z) => z - ZOOM_STEP);
      } else if (event.key === "0") {
        event.preventDefault();
        changeZoom(() => 1);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [changeZoom]);

  const [matchCount, setMatchCount] = useState(0);
  const find = useDocumentFind(matchCount);
  useDomTextFind({
    rootRef: scrollRef,
    content,
    query: find.query,
    isOpen: find.isOpen,
    currentIdx: find.currentIdx,
    onMatchCount: setMatchCount,
  });

  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;

    const savePosition = () => {
      const maximum = scroll.scrollHeight - scroll.clientHeight;
      saveTextScrollPosition(documentPath, "rendered", maximum > 0 ? scroll.scrollTop / maximum : 0);
    };
    const onScroll = () => savePosition();
    scroll.addEventListener("scroll", onScroll, { passive: true });

    let frame: number | null = null;
    if (restoreScrollPosition) {
      const position = readTextScrollPosition(documentPath, "rendered");
      if (position !== null) {
        frame = window.requestAnimationFrame(() => {
          scroll.scrollTop = position * Math.max(scroll.scrollHeight - scroll.clientHeight, 0);
        });
      }
    }

    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      savePosition();
      scroll.removeEventListener("scroll", onScroll);
    };
  }, [content, documentPath, restoreScrollPosition]);

  useImperativeHandle(
    ref,
    (): HtmlReaderHandle => ({
      scrollToDecoration: (id) => {
        const element = rootRef.current?.querySelector<HTMLElement>(
          `[data-decoration-ids~="${id}"], [data-decoration-ids^="${id},"], [data-decoration-ids*=",${id},"], [data-decoration-ids$=",${id}"]`,
        );
        element?.scrollIntoView?.({ block: "center" });
      },
      openFind: (query) => {
        if (query !== undefined) find.setQuery(query);
        find.open();
      },
      closeFind: find.close,
      getZoom: () => zoom,
      setZoom: (next) => changeZoom(() => next),
    }),
    [ref, find, zoom, changeZoom],
  );

  useEffect(() => {
    if (restoreScrollPosition || highlightRange.end <= highlightRange.start) return;
    const highlighted = rootRef.current?.querySelector<HTMLElement>(".rendered-search-highlight");
    highlighted?.scrollIntoView?.({ block: "center" });
  }, [highlightRange, restoreScrollPosition, content]);

  /** A link in a document is a destination, never a navigation: the reader is
   *  the application's own window, and letting a document replace it is how a
   *  file becomes the last thing the application ever shows. Within the
   *  document it scrolls; anywhere else the host is asked to open it. */
  const followLink = (anchor: HTMLAnchorElement) => {
    const href = anchor.getAttribute("href");
    if (!href) return;
    if (href.startsWith("#")) {
      const id = href.slice(1);
      const target =
        rootRef.current?.querySelector<HTMLElement>(`[id="${CSS.escape(ID_PREFIX + id)}"]`) ??
        rootRef.current?.querySelector<HTMLElement>(`[id="${CSS.escape(id)}"]`);
      target?.scrollIntoView?.({ block: "start" });
      return;
    }
    openExternal(anchor.hasAttribute(LOCAL_LINK_ATTRIBUTE) ? href : anchor.href);
  };

  return (
    <div
      ref={rootRef}
      onClick={(event) => {
        if (!(event.target instanceof Element)) return;
        const anchor = event.target.closest<HTMLAnchorElement>("a[href]");
        if (anchor) {
          event.preventDefault();
          followLink(anchor);
          return;
        }
        const marked = event.target.closest<HTMLElement>("[data-decoration-ids]");
        const ids = marked?.dataset.decorationIds?.split(",") ?? [];
        if (!marked) return;
        // Overlapping decorations produce one span carrying every id. Activate
        // the first that actually wants activation rather than the first id,
        // which may belong to a purely visual mark.
        for (const id of ids) {
          const decoration = decorations.find((candidate) => candidate.id === id);
          if (decoration?.onActivate) {
            decoration.onActivate(id, elementAnchor(marked));
            return;
          }
        }
      }}
      onMouseUp={domSelection.readSelection}
      className="relative h-full overflow-hidden"
    >
      <div ref={scrollRef} className="h-full overflow-auto px-6 py-5 text-sm text-[var(--text-main)]">
        <article className="prose prose-document prose-html" style={{ fontSize: `${zoom}rem` }}>
          {rendered}
        </article>
      </div>
      <SelectionLayer
        positioned={domSelection.positioned}
        api={domSelection.slotApi}
        slot={slots?.selectionActions}
      />
      {find.isOpen && (
        <div className="absolute top-4 right-4 z-20">
          <FindBar find={find} matchCount={matchCount} />
        </div>
      )}
      <div className="absolute bottom-4 right-4 z-20 flex flex-col gap-2 items-end">
        <div className="flex items-center gap-1.5 bg-[var(--bg-app)] border border-[var(--border-main)] rounded-lg shadow-lg px-2.5 py-1.5 text-sm text-[var(--text-main)]">
          {slots?.toolbar}
          <ZoomControls
            zoom={zoom}
            onZoomIn={() => changeZoom((z) => z + ZOOM_STEP)}
            onZoomOut={() => changeZoom((z) => z - ZOOM_STEP)}
          />
        </div>
      </div>
    </div>
  );
}
