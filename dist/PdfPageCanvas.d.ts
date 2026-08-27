import type { PDFDocumentProxy } from "pdfjs-dist";
/**
 * Renders one page's canvas.
 *
 * This is a deliberate transcription of what `react-pdf`'s `<Page>` did with
 * the props this reader passed it, not a fresh design: the reader's current
 * rendering *is* the specification, so every quirk below is load-bearing until
 * someone changes it on purpose.
 *
 * What is preserved, and why each matters:
 *
 *   * **The device-pixel-ratio is not capped.** `window.devicePixelRatio || 1`,
 *     exactly as before. Capping it (at 2, say) is defensible for memory, but
 *     it would soften every page on a 3x display -- a visible change, not a
 *     cleanup.
 *   * **`alpha: false` plus an explicit white `background`.** An opaque canvas
 *     keeps PDF composition stable; a transparent one lets blend modes
 *     composite against whatever is behind the canvas.
 *   * **`annotationMode: ENABLE`.** The reader turns off the *DOM* annotation
 *     layer and draws its own links, but annotation appearances are still
 *     baked into the canvas. Passing DISABLE here would silently drop stamps,
 *     highlights and form field appearances from rendered pages.
 *   * **Hidden until rendered.** The canvas is sized, hidden, drawn, then
 *     revealed, so a partially painted page is never shown. `canvasBackground`
 *     is the *render* background, not the wrapper's: the wrapper is transparent
 *     (see `.pdf-page` in the app stylesheet), so what shows through meanwhile
 *     is the reader's own background, as it always did.
 *   * **Remount on scale change.** The canvas element is keyed by scale, so a
 *     zoom discards the old element rather than redrawing into it.
 *   * **`page.cleanup()` before each render**, so a re-render starts from
 *     scratch rather than inheriting prior state.
 *
 * Dropped deliberately: react-pdf set `--scale-factor`, `--total-scale-factor`
 * and `--user-unit` on the page wrapper. Nothing reads them -- the text layer
 * sets its own on the builder's div, which is not a descendant of this element.
 */
interface PdfPageCanvasProps {
    pdf: PDFDocumentProxy;
    pageNumber: number;
    /** Target CSS width in px. The page is scaled to meet it. */
    width: number;
    canvasBackground?: string;
    onRenderSuccess?: () => void;
    onRenderError?: (error: unknown) => void;
}
export default function PdfPageCanvas({ pdf, pageNumber, width, canvasBackground, onRenderSuccess, onRenderError, }: PdfPageCanvasProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=PdfPageCanvas.d.ts.map