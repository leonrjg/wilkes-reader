import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * pdf.js' modern build calls JavaScript features newer than the webviews the
 * hosts ship into. On Windows' WebView2 that was a blank page:
 * `getOrInsertComputed is not a function`, thrown from
 * `getOptionalContentConfig` on the first render, with `Math.sumPrecise`
 * missing in the worker besides.
 *
 * These open a real document through `./pdfjs.js` in an engine without either
 * feature. Swap that module back to the modern build and the first case fails
 * with the error the webview reported.
 */

const MISSING = [
  [Map.prototype, "getOrInsertComputed"],
  [WeakMap.prototype, "getOrInsertComputed"],
  [Math, "sumPrecise"],
] as const;

// One empty page; pdf.js rebuilds the missing cross-reference table itself.
const ONE_PAGE_PDF = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]/Resources<<>>/Contents 4 0 R>>endobj
4 0 obj<</Length 0>>stream
endstream endobj
trailer<</Root 1 0 R>>
%%EOF`;

let pdfjs: typeof import("./pdfjs.js");

beforeAll(async () => {
  // Node may grow these natively. Take them away so the case keeps standing
  // in for the webview rather than passing on the strength of the engine.
  for (const [target, name] of MISSING) delete (target as any)[name];
  pdfjs = await import("./pdfjs.js");
  // `PDFJS_WORKER_SRC` is a bundler-resolved URL; outside a bundle, resolve
  // the package path it names the way the bundler would.
  const workerSpecifier = pdfjs.PDFJS_WORKER_SRC.slice(
    pdfjs.PDFJS_WORKER_SRC.indexOf("pdfjs-dist/"),
  );
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(
    createRequire(import.meta.url).resolve(workerSpecifier),
  ).href;
});

describe("the pdf.js build the reader loads", () => {
  it("opens a document in an engine without the features the modern build assumes", async () => {
    const task = pdfjs.getDocument({
      data: new TextEncoder().encode(ONE_PAGE_PDF),
      verbosity: pdfjs.VerbosityLevel.ERRORS,
    });
    try {
      const pdf = await task.promise;
      // The call the webview threw from.
      await pdf.getOptionalContentConfig();
      const page = await pdf.getPage(1);
      await page.getTextContent();
      expect(pdf.numPages).toBe(1);
    } finally {
      await task.destroy();
    }
  });
});
