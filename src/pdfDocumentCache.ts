import { useEffect, useRef, useState } from "react";
import { getDocument } from "pdfjs-dist";
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist";
import { pdfjsAssetUrls } from "./pdfjsAssetUrls.js";

/**
 * What identifies a PDF document, and where its bytes come from.
 *
 * A URL is both at once -- the webview can fetch it, and two loads of the same
 * URL are the same document -- so the ordinary case stays a bare string.
 *
 * A host that cannot hand the webview a fetchable URL supplies the two halves
 * separately. That is not a corner case: a document dropped as a `File`, one
 * read out of an archive, or one whose path the window is deliberately not
 * allowed to name all arrive as bytes the host already holds, with an identity
 * that is the host's own (a record id, a hash) rather than a location. Bytes
 * with no key would make every mount a cache miss and re-parse the file.
 */
export type PdfDocumentSource = string | { key: string; bytes: ArrayBuffer };

/** The cache identity of a source: two sources with the same key are the same
 *  document, and only one of them is ever parsed. */
export function pdfDocumentKey(source: PdfDocumentSource): string {
  return typeof source === "string" ? source : source.key;
}

/** The half of `getDocument`'s parameters that says where to read from.
 *
 *  The bytes are copied because pdf.js takes ownership of the buffer it is
 *  handed and detaches it. Without the copy the host's own ArrayBuffer becomes
 *  unusable the moment the document loads, and a second load of the same bytes
 *  after an eviction reads a detached buffer. */
function pdfjsReadFrom(source: PdfDocumentSource) {
  return typeof source === "string" ? { url: source } : { data: source.bytes.slice(0) };
}

// The parsed PDF documents (`PDFDocumentProxy`) for the N most-recently opened
// files are kept alive here so switching back to a recent document is instant.
// This module is the single owner of the document lifecycle: proxies are
// destroyed only on eviction, never on component unmount. A per-component
// lifecycle (destroying the loading task when the viewer unmounts) would force
// a full re-fetch and re-parse every time the reader navigates back and forth.
const MAX_CACHED_DOCUMENTS = 3;

interface CacheEntry {
  /** Resolves to the proxy; shared so concurrent mounts don't double-load. */
  promise: Promise<PDFDocumentProxy>;
  /** The resolved proxy once available, for synchronous revisit rendering. */
  proxy: PDFDocumentProxy | null;
  /** Teardown lives on the loading task, not the proxy: pdf.js 6 removed
   *  `PDFDocumentProxy.destroy()`, leaving the task as the single owner of the
   *  worker and the network requests it started. */
  loadingTask: PDFDocumentLoadingTask;
}

// Insertion order in a Map is its LRU order: the first key is least-recently
// used, the last is most-recently used.
const cache = new Map<string, CacheEntry>();

function touch(key: string, entry: CacheEntry) {
  cache.delete(key);
  cache.set(key, entry);
}

function evictExcess() {
  while (cache.size > MAX_CACHED_DOCUMENTS) {
    const oldestKey = cache.keys().next().value as string;
    const oldest = cache.get(oldestKey);
    cache.delete(oldestKey);
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
export function peekCachedPdfDocument(source: PdfDocumentSource): PDFDocumentProxy | null {
  return cache.get(pdfDocumentKey(source))?.proxy ?? null;
}

/** Load a PDF, reusing the cached proxy when present. */
export function loadPdfDocument(source: PdfDocumentSource): Promise<PDFDocumentProxy> {
  const key = pdfDocumentKey(source);
  const existing = cache.get(key);
  if (existing) {
    touch(key, existing);
    return existing.promise;
  }

  const loadingTask = getDocument({ ...pdfjsReadFrom(source), ...pdfjsAssetUrls() });
  const entry: CacheEntry = { proxy: null, promise: loadingTask.promise, loadingTask };
  entry.promise = loadingTask.promise.then(
    (proxy) => {
      entry.proxy = proxy;
      return proxy;
    },
    (error) => {
      // Drop the failed entry so a later open retries instead of replaying the
      // rejection forever.
      cache.delete(key);
      throw error;
    },
  );
  cache.set(key, entry);
  evictExcess();
  return entry.promise;
}

/** The cached-or-loading `PDFDocumentProxy` for `source`, or null while it
 *  loads.
 *
 *  `null` is a source in its own right, meaning "there is no document to show
 *  yet" -- a host whose bytes arrive over its own transport has a render pass
 *  before them, and that is not an error to report. */
export function usePdfDocument(
  source: PdfDocumentSource | null,
  loadAttempt = 0,
  onLoadError?: (error: unknown) => void,
): PDFDocumentProxy | null {
  // The identity is what the effect may depend on. An object source is a fresh
  // object on every render, so depending on the source itself would reload the
  // document once per render; depending on the key reloads it when it is a
  // different document, which is what the key means.
  const key = source === null ? null : pdfDocumentKey(source);
  const sourceRef = useRef(source);
  sourceRef.current = source;
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(() =>
    source === null ? null : peekCachedPdfDocument(source),
  );
  const onLoadErrorRef = useRef(onLoadError);

  useEffect(() => {
    onLoadErrorRef.current = onLoadError;
  }, [onLoadError]);

  useEffect(() => {
    const current = sourceRef.current;
    if (current === null) {
      setPdf(null);
      return;
    }

    const cached = peekCachedPdfDocument(current);
    if (cached) {
      setPdf(cached);
      return;
    }

    let cancelled = false;
    setPdf(null);
    loadPdfDocument(current)
      .then((proxy) => {
        if (!cancelled) setPdf(proxy);
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
  }, [key, loadAttempt]);

  return pdf;
}
