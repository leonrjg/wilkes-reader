import { useEffect, useState } from "react";
import { locatePdfSearchResult, } from "./pdfTextLocator";
/** Resolve a coarse indexed PDF origin to rendered PDF.js page geometry. */
export function usePdfSearchResult(pdf, coarsePage, locator) {
    const [match, setMatch] = useState(null);
    useEffect(() => {
        setMatch(null);
        if (!pdf || !locator?.matched_text.trim()) {
            return;
        }
        const abort = new AbortController();
        locatePdfSearchResult(pdf, coarsePage, locator, abort.signal)
            .then((located) => {
            if (!abort.signal.aborted)
                setMatch(located);
        })
            .catch((error) => {
            if (!abort.signal.aborted) {
                console.error("PDF search result localization failed:", error);
            }
        });
        return () => abort.abort();
    }, [
        pdf,
        coarsePage,
        locator?.matched_text,
        locator?.context_before,
        locator?.context_after,
    ]);
    return match;
}
//# sourceMappingURL=usePdfSearchResult.js.map