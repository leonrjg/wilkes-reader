import { useEffect, useRef, useState } from "react";
import { getDocument } from "pdfjs-dist";
import { pdfjsAssetUrls } from "./pdfjsAssetUrls";
// The parsed PDF documents (`PDFDocumentProxy`) for the N most-recently opened
// files are kept alive here so switching back to a recent document is instant.
// This module is the single owner of the document lifecycle: proxies are
// destroyed only on eviction, never on component unmount. A per-component
// lifecycle (destroying the loading task when the viewer unmounts) would force
// a full re-fetch and re-parse every time the reader navigates back and forth.
const MAX_CACHED_DOCUMENTS = 3;
// Insertion order in a Map is its LRU order: the first key is least-recently
// used, the last is most-recently used.
const cache = new Map();
function touch(url, entry) {
    cache.delete(url);
    cache.set(url, entry);
}
function evictExcess() {
    while (cache.size > MAX_CACHED_DOCUMENTS) {
        const oldestUrl = cache.keys().next().value;
        const oldest = cache.get(oldestUrl);
        cache.delete(oldestUrl);
        // The evicted document is, by definition, not the active one (the active
        // document is always the most-recently touched entry), so destroying it
        // cannot pull the rug from under a mounted viewer.
        oldest?.loadingTask.destroy().catch((error) => {
            console.error("Failed to destroy evicted PDF document:", error);
        });
    }
}
/** The parsed proxy if this document is currently cached, else null. Lets a
 *  revisited document render synchronously with no reload flash. */
export function peekCachedPdfDocument(url) {
    return cache.get(url)?.proxy ?? null;
}
/** Load a PDF, reusing the cached proxy when present. */
export function loadPdfDocument(url) {
    const existing = cache.get(url);
    if (existing) {
        touch(url, existing);
        return existing.promise;
    }
    const loadingTask = getDocument({ url, ...pdfjsAssetUrls() });
    const entry = { proxy: null, promise: loadingTask.promise, loadingTask };
    entry.promise = loadingTask.promise.then((proxy) => {
        entry.proxy = proxy;
        return proxy;
    }, (error) => {
        // Drop the failed entry so a later open retries instead of replaying the
        // rejection forever.
        cache.delete(url);
        throw error;
    });
    cache.set(url, entry);
    evictExcess();
    return entry.promise;
}
/** The cached-or-loading `PDFDocumentProxy` for `url`, or null while loading. */
export function usePdfDocument(url, loadAttempt = 0, onLoadError) {
    const [pdf, setPdf] = useState(() => peekCachedPdfDocument(url));
    const onLoadErrorRef = useRef(onLoadError);
    useEffect(() => {
        onLoadErrorRef.current = onLoadError;
    }, [onLoadError]);
    useEffect(() => {
        const cached = peekCachedPdfDocument(url);
        if (cached) {
            setPdf(cached);
            return;
        }
        let cancelled = false;
        setPdf(null);
        loadPdfDocument(url)
            .then((proxy) => {
            if (!cancelled)
                setPdf(proxy);
        })
            .catch((e) => {
            if (!cancelled) {
                console.error("PDF document load failed:", e);
                onLoadErrorRef.current?.(e);
            }
        });
        return () => {
            cancelled = true;
        };
    }, [url, loadAttempt]);
    return pdf;
}
//# sourceMappingURL=pdfDocumentCache.js.map