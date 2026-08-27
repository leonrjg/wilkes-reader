import { jsx as _jsx } from "react/jsx-runtime";
import { useEffect, useRef } from "react";
import * as pdfjsLib from "pdfjs-dist";
import { attachWebkitMarginSelection } from "./pdfWebkitSelection";
// pdf.js' viewer-components build (`web/pdf_viewer.mjs`) reads the core library
// off `globalThis.pdfjsLib` at module-evaluation time. We must publish it there
// before that module is ever evaluated, then load the bundle lazily so the
// assignment is guaranteed to run first.
globalThis.pdfjsLib ??= pdfjsLib;
let textLayerBuilderPromise = null;
function loadTextLayerBuilder() {
    textLayerBuilderPromise ??= import("pdfjs-dist/web/pdf_viewer.mjs").then((m) => m.TextLayerBuilder);
    return textLayerBuilderPromise;
}
/**
 * Renders the selectable text overlay for a single page using pdf.js' own
 * `TextLayerBuilder` — the exact component the pdf.js viewer (and Zotero) use.
 *
 * Hand-rolling this layer is a trap: the `selectionchange`-driven
 * `endOfContent` management is what keeps a selection from ballooning to the
 * whole paragraph or page, and `TextLayerBuilder` owns it (its static global
 * selection listener spans every mounted page, virtualized ones included) and
 * is maintained upstream. The canvas beside it is drawn by `PdfPageCanvas`.
 */
export default function PdfTextLayer({ pdf, pageNumber, scale }) {
    const wrapperRef = useRef(null);
    useEffect(() => {
        const wrapper = wrapperRef.current;
        if (!wrapper)
            return;
        let cancelled = false;
        let builder = null;
        let detachWebkitFix = null;
        Promise.all([loadTextLayerBuilder(), pdf.getPage(pageNumber)])
            .then(async ([TextLayerBuilderCtor, page]) => {
            if (cancelled)
                return;
            const viewport = page.getViewport({ scale });
            builder = new TextLayerBuilderCtor({ pdfPage: page });
            // pdf.js 5.x positions every span via calc(var(--total-scale-factor) * …px)
            // (4.x used --scale-factor); the viewer normally sets these on the page
            // div, so we set both here. --user-unit defaults to 1, so total == scale.
            builder.div.style.setProperty("--scale-factor", String(scale));
            builder.div.style.setProperty("--total-scale-factor", String(scale));
            // `images` drives pdf.js 6's right-click-to-extract-image placeholders,
            // which this reader does not offer. `TextLayer` guards it
            // (`if (this.#imagesHandler)`), so omitting it is supported; only the
            // published type declares it required.
            await builder.render({ viewport });
            if (cancelled) {
                builder.cancel();
                return;
            }
            wrapper.append(builder.div);
            detachWebkitFix = attachWebkitMarginSelection(builder.div);
        })
            .catch((e) => {
            if (!cancelled)
                console.error(`PDF text layer (page ${pageNumber}) failed:`, e);
        });
        return () => {
            cancelled = true;
            detachWebkitFix?.();
            builder?.cancel();
            builder?.div.remove();
        };
    }, [pdf, pageNumber, scale]);
    return _jsx("div", { ref: wrapperRef, className: "absolute inset-0" });
}
//# sourceMappingURL=PdfTextLayer.js.map