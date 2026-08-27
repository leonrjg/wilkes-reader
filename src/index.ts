/**
 * The readers' public surface.
 *
 * Everything re-exported here is API: it is what a host is allowed to depend
 * on, and what cannot be changed without changing the host. Everything else in
 * this directory is internal and may be reshaped freely -- the text and link
 * layers, the find bar, the zoom cluster, the scroll memories, the WebKit
 * selection workaround, the markdown source map, the selection plumbing.
 *
 * Two tiers, because there are two ways to use these readers:
 *
 *   1. **Composed.** Mount a reader and drive it through the contract:
 *      `decorations` for host-owned marks, `slots` for host chrome, a `ref` for
 *      navigation, and `ReaderHostProvider` for the capabilities the readers
 *      need from the application around them.
 *
 *   2. **Headless.** Take the hooks and build your own surface. This is for a
 *      host whose reading surface is genuinely not a reader -- an annotated
 *      single-page stage, a thumbnail strip -- and which would otherwise
 *      reimplement document loading, page metrics and text location badly. It
 *      shares the engine without pretending to share the shell.
 */

// ── Tier 1: composed readers ────────────────────────────────────────────────

export { default as PdfViewer } from "./PdfViewer.js";
export type { PdfViewerProps, PdfReaderHandle, PdfSelection } from "./PdfViewer.js";

export { default as MarkdownViewer } from "./MarkdownViewer.js";
export type { MarkdownViewerProps, MarkdownReaderHandle } from "./MarkdownViewer.js";

export { default as CodeViewer, getLanguageExtension } from "./CodeViewer.js";
export type { CodeViewerProps, CodeReaderHandle } from "./CodeViewer.js";

// ── The contract ────────────────────────────────────────────────────────────

export { elementAnchor, rectDecorationsForPage, rangeDecorations, unionBox } from "./decorations.js";
export type {
  Decoration,
  DecorationAnchor,
  DecorationRenderContext,
  DecorationActivateHandler,
  ElementAnchor,
} from "./decorations.js";

export type {
  ReaderSlots,
  PdfReaderSlots,
  SelectionActionsSlot,
  PageGutter,
  PageGutterSlot,
  SelectionSlotApi,
} from "./slots.js";

export type { ReaderHandle, FindableReaderHandle, ZoomableReaderHandle } from "./readerHandle.js";

export type { DocumentSelection, PositionedSelection } from "./selection.js";

export type { BoundingBox, ByteRange, SourceOrigin } from "./documentCoordinates.js";

/** A leaf primitive the readers need and both applications use. It lives here
 *  because the PDF link preview depends on its `interactive` and `size`
 *  behaviour, so it is reader functionality rather than host chrome; shipping
 *  it from one place is what stops the two copies drifting. */
export { Tooltip } from "./Tooltip.js";

export { ReaderHostProvider, useReaderHost } from "./ReaderHost.js";
export type { ReaderHostServices, ColorScheme } from "./ReaderHost.js";

// ── Tier 2: headless ────────────────────────────────────────────────────────

export {
  usePdfDocument,
  loadPdfDocument,
  peekCachedPdfDocument,
  pdfDocumentKey,
} from "./pdfDocumentCache.js";
export type { PdfDocumentSource } from "./pdfDocumentCache.js";

/** One page, drawn. The composed readers stack a text layer, a link layer and
 *  the decoration overlays on this; a host whose surface is a single annotated
 *  page wants the raster and its own overlay, and would otherwise re-derive the
 *  device-pixel-ratio handling, the cancellation rules and the canvas release
 *  from scratch. */
export { default as PdfPageCanvas } from "./PdfPageCanvas.js";
export type { RenderedPageGeometry } from "./PdfPageCanvas.js";

export { usePdfPageMetrics, getScaledPageHeight } from "./usePdfPageMetrics.js";
export type { PdfPageMetric } from "./usePdfPageMetrics.js";
export { usePdfOutline } from "./usePdfOutline.js";
export type { PdfOutlineNode } from "./usePdfOutline.js";
export { usePdfInnerSearch } from "./usePdfInnerSearch.js";
export type { InnerMatch } from "./usePdfInnerSearch.js";
export { useDocumentFind } from "./useDocumentFind.js";
export type { DocumentFind } from "./useDocumentFind.js";
export { resolveDestination } from "./pdfDestinations.js";
export type { PdfDestination, ResolvedDestination } from "./pdfDestinations.js";
export {
  findAllPdfTextMatches,
  findPdfTextMatchesOnPage,
  locatePdfSearchResult,
} from "./pdfTextLocator.js";
export type { PdfSearchLocator, PdfTextMatch } from "./pdfTextLocator.js";
export {
  utf8ByteOffsetToUtf16Offset,
  utf8ByteRangeToUtf16Range,
  textSelectionFromUtf16Range,
} from "./textOffsets.js";

/** Which surface a text document was last read on. The readers persist and
 *  restore the scroll position per mode; a host that offers the choice needs
 *  the vocabulary. */
export type { TextViewerMode } from "./textScrollMemory.js";
