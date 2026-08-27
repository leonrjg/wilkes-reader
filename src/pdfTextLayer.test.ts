import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `pdfTextLayer.css` is a copy of pdf.js' own text-layer stylesheet, and the
 * copy is load-bearing: from pdf.js 6 the span geometry is computed in CSS from
 * custom properties the JavaScript sets, so the two must come from the same
 * version. Skew them and every span renders at the default size with no
 * transform -- the invisible text stops covering the painted glyphs and
 * selection grabs the wrong words.
 *
 * Nothing about that failure is visible. No property is missing, so nothing
 * throws; the page still looks right, because the glyphs are painted on the
 * canvas by a separate path; and the text layer is transparent by design. A
 * screenshot cannot show it and the other tests here mock pdf.js entirely.
 *
 * Hence this file. It is the reason a version bump cannot quietly forget to
 * re-copy the stylesheet.
 */

const require = createRequire(import.meta.url);
const pdfjsRoot = dirname(require.resolve("pdfjs-dist/package.json"));
const readPdfjs = (path: string) => readFileSync(join(pdfjsRoot, path), "utf8");
// Read from disk rather than import: these files are compared as text, and
// `import.meta.url` is not a file URL once the test has been transformed.
const readSource = (name: string) =>
  readFileSync(join(process.cwd(), "src", name), "utf8");

/** The `.textLayer` rule with everything nested inside it. */
function textLayerRule(css: string): string {
  const start = css.indexOf(".textLayer{");
  if (start === -1) {
    throw new Error("pdf.js no longer publishes a .textLayer rule to copy");
  }
  let depth = 0;
  for (let i = start; i < css.length; i++) {
    if (css[i] === "{") depth += 1;
    else if (css[i] === "}" && (depth -= 1) === 0) {
      return css.slice(start, i + 1).trim();
    }
  }
  throw new Error("unbalanced braces in pdf.js' stylesheet");
}

const vendored = readSource("pdfTextLayer.css");
const vendoredRule = vendored.slice(vendored.indexOf(".textLayer{")).trim();

const customProperties = (source: string, pattern: RegExp) =>
  new Set([...source.matchAll(pattern)].map((match) => match[1]));

/** The properties the reader computes and hands to the stylesheet. */
const setByProps = () =>
  customProperties(readSource("PdfTextLayer.tsx"), /setProperty\(\s*"(--[\w-]+)"/g);

describe("pdfTextLayer.css", () => {
  it("is verbatim what the installed pdf.js publishes", () => {
    // pdf.js ships its text-layer styles only inside the whole viewer
    // application's stylesheet, so they are extracted rather than imported.
    expect(vendoredRule).toBe(textLayerRule(readPdfjs("web/pdf_viewer.css")));
  });

  it("reads no custom property that nothing this package ships supplies", () => {
    // pdf.js declares some of what its text layer reads on the viewer element
    // of the application we replaced, so anything it expects from outside the
    // rule has to be picked up by the package's own stylesheet entry.
    const read = customProperties(vendoredRule, /var\(\s*(--[\w-]+)/g);
    const declared = customProperties(
      vendoredRule + readSource("reader.css"),
      /^\s*(--[\w-]+)\s*:/gm,
    );
    const supplied = new Set([...declared, ...setByProps()]);
    expect([...read].filter((property) => !supplied.has(property))).toEqual([]);
  });

  it("has us set every property it expects the reader to compute", () => {
    // `--total-scale-factor` is the reader's half of the bargain. Were pdf.js
    // to rename it, re-copying the stylesheet alone would leave the component
    // setting a property the stylesheet no longer reads.
    const read = customProperties(vendoredRule, /var\(\s*(--[\w-]+)/g);
    const setByUs = setByProps();
    expect(setByUs.size).toBeGreaterThan(0);
    expect([...setByUs].filter((property) => !read.has(property))).toEqual([]);
  });

  it("still gets its span geometry from pdf.js at runtime", () => {
    // These carry the geometry: the stylesheet turns them into font-size and
    // transform. They are what makes the copy load-bearing rather than
    // decorative, so their disappearance should be loud.
    const runtime = readPdfjs("build/pdf.mjs");
    for (const property of ["--font-height", "--scale-x", "--rotate"]) {
      expect(vendoredRule).toContain(`var(${property})`);
      expect(runtime).toContain(`"${property}"`);
    }
  });
});
