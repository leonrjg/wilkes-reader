## wilkes-reader (lib)

Document readers — PDF, Markdown, HTML and source - used by
[Wilkes](https://github.com/leonrjg/Wilkes).

### What a host provides, and what it gets

The readers know how to render a document. They know nothing about bookmarks,
chat, review state or search backends. Four channels carry everything a host
needs, and nothing app-specific crosses back:

| Channel | Direction | For |
| --- | --- | --- |
| `decorations` | host → reader | Marks on the document, anchored by page rects or a text range |
| `slots` | host → reader | Host chrome rendered inside the reader (selection actions, page gutter) |
| `ref` | host → reader | Navigation, zoom and find as imperative commands |
| `ReaderHostProvider` | host → reader | Capabilities the readers need: opening a URL, the colour scheme, a URL for a local file |

A `pageGutter` slot declares its own width, and the reader **reserves** it:
the page is drawn into what is left of the canvas, so host chrome beside a page
sits inside the scrollable extent and stays there at every zoom, padding the
page rather than hanging off its right edge.

```ts
slots={{ pageGutter: { width: 280, render: (page, { scale }) => <Notes … /> } }}
```

`index.ts` is the whole public surface, in two tiers: the composed readers with
that contract, and the headless hooks for a host whose reading surface is not a
reader — an annotated single-page stage, a thumbnail strip — which would
otherwise reimplement document loading and text location badly.

### An HTML file is read, not browsed

`HtmlViewer` renders an HTML file the way the other readers render their
documents: the file supplies structure and text, and the reader supplies the
typography. What it deliberately does not supply is a browser. A file on disk
arrives with no origin, no CSP and no user behind it, so what it may do is a
closed list: scripts, author stylesheets, frames, forms and plugins do not
survive parsing, and **nothing in a document can cause a request to leave the
machine** — opening a file must not tell anyone that it was opened.

Every text run is mapped back to the bytes it came from, so a bookmark, a search
hit and a selection are in the file's own coordinates, exactly as they are in
Markdown. This is why the rendering is faithful rather than clever: an
extractor that decided which parts of the page were "the article" (Readability
and its kin) would rewrite the tree those coordinates are measured in, and
would drop, as boilerplate, content a corpus was indexed on.

The one thing a file brings that a string of Markdown cannot is other files
beside it. A relative `src` is resolved against the document and offered to the
host:

```ts
<ReaderHostProvider value={{ …, resolveLocalAsset: (path) => api.resolveAssetUrl(path) }}>
```

Without that capability a document renders without its local pictures, showing
their alt text; the readers will not invent a way to fetch a file the
application has not offered them. It is also the only place a document's reach
into the filesystem can be judged — the reference has already been resolved
against the document, and a host that wants it fenced to a corpus fences it
there. Remote and inline addresses never reach it: `data:` is part of the file
and is kept, and everything else is refused.

Links are destinations, never navigations. `#fragment` scrolls within the
document, a relative link is handed to the host as a path, and anything else
goes to `openExternal`.

### Installing

```
npm install github:leonrjg/wilkes-reader#v0.3.0
```

`pdfjs-dist`, `react` and `react-dom` are peer dependencies.

To edit the package alongside an application, link it rather than changing the
application's manifest — `npm link` touches neither package.json nor the
lockfile, so the tag stays the committed truth and CI is unaffected:

```
cd wilkes-reader && npm link
cd ../Wilkes/ui && npm link @leonrjg/wilkes-reader
```

`npm ci` restores the tagged version. A linked package resolves to its real
path, outside the application's root, so the application's dev server needs
that path in `server.fs.allow` or it will refuse to serve pdf.js' worker.

Any `npm install` or `npm ci` in the application replaces the link with the
tagged package again — that is what the link is, a directory npm owns — so
after one, re-run `npm link @leonrjg/wilkes-reader`. Until the tag the
application asks for exists, npm resolves the previous one from the lockfile
and the application boots to a blank window with `does not provide an export
named …` in its console: the code was written against the working copy and the
manifest was answered from the last release. Vite also pre-bundles the package
into `node_modules/.vite`, so restart its dev server after re-linking or
rebuilding the package.

### Wiring it into a Vite application

Three things beyond the import, all of them easy to forget and quiet when
missed:

```ts
// vite.config.ts — pdf.js fetches its decoders, fonts and character maps at
// runtime. Without this, a scanned PDF renders blank behind an invisible,
// still-selectable text layer, and nothing errors.
import { pdfjsAssets } from "@leonrjg/wilkes-reader/vite";
export default defineConfig({ plugins: [react(), tailwindcss(), pdfjsAssets()] });
```

```css
/* styles.css — ahead of your own `:root`, so your tokens override the
   defaults. `@source` is required: the readers use Tailwind utilities, and
   Tailwind does not scan dependencies unless told to. */
@import "tailwindcss";
@source "../node_modules/@leonrjg/wilkes-reader/dist";
@import "@leonrjg/wilkes-reader/reader.css";
```

```ts
// vitest setup — jsdom gaps the readers hit, chiefly DOMMatrix, which pdf.js
// constructs at module evaluation. Without it every test that imports a reader
// dies on import.
import "@leonrjg/wilkes-reader/testing/setup";
```

`@leonrjg/wilkes-reader/testing` also exports `renderWithReaderHost`, which
mounts a reader with a host you can change afterwards, and `stubSelectionSlot`.

Of the three, only the `@source` line is about Tailwind, and only the composed
readers need it. A host that takes the headless tier alone — `usePdfDocument`,
`PdfPageCanvas`, the metrics and locator hooks — needs no Tailwind and no
`reader.css`: nothing in that tier carries a utility class, and the only rule it
would take from the stylesheet is `.pdf-page canvas`, the sheet-of-paper white
and its shadow. Import `reader.css` if you want that look, or style the class
yourself. The other two wirings are not optional for anyone: `pdfjsAssets()`
because pdf.js fetches its decoders at runtime in every tier, and the test setup
because every tier imports pdf.js.

### Where a document comes from

`PdfViewer`, `usePdfDocument` and `loadPdfDocument` all take a
`PdfDocumentSource`, which is either a URL string or `{ key, bytes }`:

```ts
usePdfDocument(convertFileSrc(path));                  // Wilkes: a fetchable URL
usePdfDocument(bytes && { key: `document:${id}`, bytes }); // Underdog: bytes over IPC
<PdfViewer source={convertFileSrc(path)} … />
<PdfViewer source={{ key: `document:${id}`, bytes }} … />
```

A URL is identity and transport at once, so it stays a bare string. Bytes are
transport with no identity, so they carry the host's own — a record id, a hash.
The key is what the document cache stores under, so it must be stable across
renders even though the object around it is not; without one, every render is a
cache miss and re-parses the file. `null` is a source too, meaning the bytes have
not arrived yet, and is not reported as a failed load.

The bytes are copied before pdf.js sees them, because pdf.js detaches the buffer
it is handed. Your `ArrayBuffer` stays usable.

### Releasing

```
git tag vX.Y.Z && git push --tags
```

### Theming

`reader.css` defines a light-only `:root` of defaults so the readers render
correctly with no host palette at all. A host overrides those tokens; dark mode
is a host decision, delivered through `colorScheme` on the provider rather than
inferred from a class the readers cannot see.

### Bumping pdf.js

`src/pdfTextLayer.css` is a verbatim copy of pdf.js' own text-layer
stylesheet, which pdf.js publishes only inside its whole viewer application's
stylesheet. The copy is load-bearing: from pdf.js 6 the span geometry is
computed there from custom properties the JavaScript sets, so a stale copy
misaligns the invisible text over the glyphs and breaks selection. Nothing
about that failure is visible -- no property is missing, so nothing throws; the
glyphs you see are painted on the canvas by another path; and the text layer is
transparent by design.

`pdfTextLayer.test.ts` is what makes a bump safe. It holds the copy byte-for-
byte against the installed pdf.js, checks that nothing the rule reads is left
unsupplied by what the package ships, and checks that every property
`PdfTextLayer.tsx` computes is still one the stylesheet reads. Re-copy the
`.textLayer` rule out of `web/pdf_viewer.css` and the tests will tell you what
else moved.
