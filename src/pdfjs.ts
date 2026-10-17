/**
 * The one place this package names a pdf.js build. Everything else imports
 * pdf.js through here.
 *
 * The library, the viewer components and the worker must come from the same
 * build. The worker is a separate global scope, so whatever the page has --
 * polyfills included -- the worker does not; and the viewer components read
 * the library off a global, so two builds in one bundle would mean two pdf.js
 * instances with nothing to say which one a page came from.
 *
 * The build is pdf.js' `legacy/` one. The modern build calls JavaScript
 * features that are newer than the webviews the hosts ship into:
 * `Map.prototype.getOrInsertComputed` in the library (a blank page on Windows'
 * WebView2, thrown from `getOptionalContentConfig`) and `Math.sumPrecise` in
 * the worker. The legacy build carries pdf.js' own polyfills for both, in
 * both realms, and each one installs only where the engine has no native
 * implementation.
 */
export * from "pdfjs-dist/legacy/build/pdf.mjs";

/** The worker built alongside the library above. Spelled as a literal so a
 *  host's bundler sees the `new URL(…, import.meta.url)` and emits the file. */
export const PDFJS_WORKER_SRC = new URL(
  "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

/** pdf.js' viewer components, from the same build as the library. They read
 *  the library off `globalThis.pdfjsLib` when evaluated, so the caller must
 *  publish it there first. */
export function loadPdfViewerComponents() {
  return import("pdfjs-dist/legacy/web/pdf_viewer.mjs");
}
export type { TextLayerBuilder } from "pdfjs-dist/legacy/web/pdf_viewer.mjs";
