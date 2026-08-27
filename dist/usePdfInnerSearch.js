import { useEffect, useState } from "react";
import { findAllPdfTextMatches } from "./pdfTextLocator";
/**
 * Computes the PDF-specific match set for in-document find: it scans page text
 * for `query` and returns page-anchored bounding boxes. Find-bar state and match
 * navigation are owned by the shared {@link useDocumentFind} controller.
 */
export function usePdfInnerSearch(pdf, query, isEnabled) {
    const [matches, setMatches] = useState([]);
    const [isSearching, setIsSearching] = useState(false);
    useEffect(() => {
        if (!isEnabled || !query.trim() || !pdf) {
            setMatches([]);
            setIsSearching(false);
            return;
        }
        const abort = new AbortController();
        const search = async () => {
            setIsSearching(true);
            try {
                const found = await findAllPdfTextMatches(pdf, query, abort.signal);
                if (!abort.signal.aborted) {
                    setMatches(found.map(({ page, bbox }) => ({ page, bbox })));
                }
            }
            catch (e) {
                console.error("PDF inner search failed:", e);
            }
            finally {
                if (!abort.signal.aborted)
                    setIsSearching(false);
            }
        };
        const timeout = setTimeout(search, 300);
        return () => {
            abort.abort();
            clearTimeout(timeout);
        };
    }, [query, isEnabled, pdf]);
    return { matches, isSearching };
}
//# sourceMappingURL=usePdfInnerSearch.js.map