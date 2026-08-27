import { jsx as _jsx } from "react/jsx-runtime";
import { useEffect, useRef, useState } from "react";
import { AnnotationMode } from "pdfjs-dist";
function isCancellation(error) {
    const name = error?.name;
    return name === "AbortException" || name === "RenderingCancelledException";
}
export default function PdfPageCanvas({ pdf, pageNumber, width, canvasBackground, onRenderSuccess, onRenderError, }) {
    const [page, setPage] = useState(null);
    const [loadFailed, setLoadFailed] = useState(false);
    useEffect(() => {
        let cancelled = false;
        setPage(null);
        setLoadFailed(false);
        pdf.getPage(pageNumber).then((nextPage) => {
            if (!cancelled)
                setPage(nextPage);
        }, (error) => {
            if (cancelled)
                return;
            console.error(`PDF page ${pageNumber} failed to load:`, error);
            setLoadFailed(true);
        });
        return () => {
            cancelled = true;
        };
    }, [pdf, pageNumber]);
    const rotate = page?.rotate ?? 0;
    const scale = page ? width / page.getViewport({ scale: 1, rotation: rotate }).width : 1;
    return (_jsx("div", { 
        // Deliberately not `data-page-number`: the reader's virtualized wrapper
        // carries that, and it is the element every geometry reader in PdfViewer
        // actually resolves to -- `closest()` from the text layer, which is a
        // sibling of this element rather than a descendant, and `querySelector`,
        // which takes the first in document order. This element carried a second
        // copy only because react-pdf emitted one, leaving `querySelectorAll`
        // with two candidates per page whose centres differ by half the page gap.
        // The class is the styling hook (`.pdf-page canvas`, and the dark-mode
        // inversion); identity belongs to the wrapper.
        className: "pdf-page", style: {
            position: "relative",
            minWidth: "min-content",
            minHeight: "min-content",
        }, children: page ? (_jsx(PageCanvas, { page: page, scale: scale, rotate: rotate, canvasBackground: canvasBackground, onRenderSuccess: onRenderSuccess, onRenderError: onRenderError }, `${pageNumber}@${scale}/${rotate}`)) : (_jsx("div", { className: "pdf-page-message", children: loadFailed ? "Failed to load the page." : "Loading page…" })) }));
}
function PageCanvas({ page, scale, rotate, canvasBackground, onRenderSuccess, onRenderError, }) {
    const canvasElement = useRef(null);
    // Read from the render effect without making it re-run when a caller passes a
    // fresh closure; re-running would cancel and repaint the page for nothing.
    const callbacksRef = useRef({ onRenderSuccess, onRenderError });
    callbacksRef.current = { onRenderSuccess, onRenderError };
    // Release the backing surface when this canvas goes away. Zeroing the
    // dimensions makes browsers drop it immediately; without it, a document
    // scrolled end to end holds every canvas it ever painted, and at device
    // resolution those are megabytes each.
    //
    // The element is captured here at setup rather than read from the ref in the
    // cleanup, which is what react-pdf did: under React 19 the host ref is
    // already null by the time a passive cleanup runs, so reading it there finds
    // nothing and the release silently never happens.
    useEffect(() => {
        const canvas = canvasElement.current;
        return () => {
            if (!canvas)
                return;
            canvas.width = 0;
            canvas.height = 0;
        };
    }, []);
    useEffect(() => {
        const canvas = canvasElement.current;
        if (!canvas)
            return;
        // Start from scratch; otherwise prior page state (form data included)
        // survives into the new render.
        page.cleanup();
        const devicePixelRatio = window.devicePixelRatio || 1;
        const renderViewport = page.getViewport({
            scale: scale * devicePixelRatio,
            rotation: rotate,
        });
        const viewport = page.getViewport({ scale, rotation: rotate });
        canvas.width = renderViewport.width;
        canvas.height = renderViewport.height;
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;
        canvas.style.visibility = "hidden";
        const canvasContext = canvas.getContext("2d", { alpha: false });
        if (!canvasContext)
            return;
        let task = page.render({
            annotationMode: AnnotationMode.ENABLE,
            canvas,
            canvasContext,
            viewport: renderViewport,
            ...(canvasBackground ? { background: canvasBackground } : {}),
        });
        task.promise
            .then(() => {
            canvas.style.visibility = "";
            callbacksRef.current.onRenderSuccess?.();
        })
            .catch((error) => {
            // A cancelled render rejects; that is the normal path when the reader
            // scrolls a page out of view mid-paint, not a failure to report.
            if (isCancellation(error))
                return;
            console.error("PDF page render failed:", error);
            callbacksRef.current.onRenderError?.(error);
        });
        return () => {
            task?.cancel();
            task = null;
        };
    }, [page, scale, rotate, canvasBackground]);
    return (_jsx("canvas", { ref: canvasElement, dir: "ltr", style: { display: "block", userSelect: "none" } }));
}
//# sourceMappingURL=PdfPageCanvas.js.map