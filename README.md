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
| `ReaderHostProvider` | host → reader | Capabilities the readers need: opening a URL, the colour scheme, a URL for a local file, where each document was left |

A `pageGutter` slot declares its own width, and the reader **reserves** it:
the page is drawn into what is left of the canvas, so host chrome beside a page
sits inside the scrollable extent and stays there at every zoom, padding the
page rather than hanging off its right edge.

```ts
slots={{ pageGutter: { width: 280, render: (page, { scale }) => <Notes … /> } }}
```

Where a document was left — a PDF's page, offset and zoom; a text document's
scroll ratio per surface and its zoom — is captured and restored by the readers
but kept by the host, through `positions` on the provider. Every call is
synchronous, because a PDF restores its zoom during its first render. A host
that keeps positions only as long as the component tree passes
`createMemoryPositionStore()`; one that persists them answers from a warm copy.

The readers claim a few keys. Cmd/Ctrl with `+`, `-` and `0` zoom, listened
for on the window. Left/Right step the PDF and image readers a page, listened
for on the reader only — clicking the document focuses it — so a host's own
lists, tabs and fields keep their arrows.

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

### Editing a PDF in place

`<PdfViewer editing />` makes a PDF's text something to type in. Nothing on the
page changes until the reader types: every paragraph has invisible text laid
over the page's own rendering, and the whole document is one editable surface,
so a click puts a caret between two letters, an arrow key carries it from one
paragraph into the next, and a selection runs across as many paragraphs as the
reader drags over. The first keystroke in a paragraph takes that paragraph —
and only that one — from the page and sets it as live text, in the runs of type
it was in. What follows it moves to make room: down the page, into the next
column, on to the next page, and onto pages appended past the document's end.
When text is taken out, what follows moves back up, across any break the file
only made because it had run out of room.

- **Enter** starts a new paragraph; **Shift+Enter** breaks a line inside one.
- **Backspace** or **Delete** at a paragraph's edge joins it to its neighbour in
  reading order — the next column's, the next page's, the one past a figure.
- Typing, deleting or cutting over a selection that spans paragraphs leaves one
  paragraph of what remains.
- **Cmd/Ctrl+B** and **Cmd/Ctrl+I** make the selection bold or italic, in that
  face of the font's family.
- **Escape** gives a paragraph back to the page.
- **Cmd/Ctrl+click** follows a link; a plain click is for the caret.

**The file is never written by the reader.** An edit is a statement about how
pages are drawn. A host that wants a file asks for the result and writes it:

```ts
const edits = await ref.current.exportEdits();   // null when nothing changed
if (edits) await myBackend.writePdf(sourcePath, edits);
```

`exportEdits()` returns, for each page that changed, which areas of which
source pages are drawn where (`strips`) and which runs of text sit on which
baselines in which font (`text`). The reader broke the lines and laid out the
pages, so whoever writes the file computes nothing: it copies areas and sets
text where it is told. `discardEdits()` gives everything back to the page.

Three things come from the host, all optional:

| On `ReaderHostProvider` / `PdfViewer` | Without it |
| --- | --- |
| `resolvePdfFont(font)` — a whole, installed font standing in for one the document names. A PDF embeds *subsets* of its fonts, so typed text needs a whole one, and the host saves with the same file | Edited text is set in the embedded faces as far as they go, and `exportEdits()` rejects |
| `pdfEdits` — a store for unsaved edits, keyed like `positions` | Edits last as long as the viewer showing them |
| `textSubstitutions` — the areas the host's reading knows are formulas or tables | Nothing is locked: a formula can be cut between two of its rows, and offered as prose |

What is marked on the pages — decorations, the find match, the passage the
reader was sent to — is drawn where the lines it marks are now, which can be
another page than it names; a link is followed from wherever its line went, and
a destination is the place it pointed at rather than the place that was. The
gutter and the selection actions describe the pages as the file has them, and
are not offered while editing.

It lives in `src/pdfEdit/`, in layers that each know about one thing:

| Module | Knows about |
| --- | --- |
| `flow.ts` | The model: a page is regions, a region is columns, a column is items |
| `reflow.ts` | Laying that model out again. Pure; no pdf.js, canvas or DOM |
| `inkGrid.ts`, `pageLayout.ts` | Reading a page's lines and columns off its raster |
| `documentFrame.ts` | What only several pages can say: running heads, how far down a page goes, and what the host says is locked |
| `paragraphs.ts` | Which lines are one paragraph, and the text and runs of type it was set in |
| `edits.ts` | An edit: replacing a paragraph's lines in the flow, following another edit, standing in for paragraphs joined into it, what it stood on |
| `typeChange.ts` | Bold and italic, said against what a font already is |
| `relocation.ts` | Where an area or a point of the original page is drawn now |
| `editExport.ts`, `typeset.ts` | The edited document as areas and text, read back off the screen |
| `editStore.ts`, `hostFonts.ts` | What crosses to the host: unsaved edits, and fonts |
| `pdfPageSource.ts` | The only module that touches pdf.js |
| `usePdfEditSession.ts` | The state: what is known about the pages, and what was changed |
| `PdfEditPage.tsx` | The paper: pages recomposed from strips |
| `PdfEditLayer.tsx`, `PageParagraph.tsx`, `LiveParagraph.tsx` | The text: untouched paragraphs as a caret over the page, changed ones as live text |
| `editInput.ts`, `caretTravel.ts` | What the keyboard means: which keystrokes are the browser's, and which change the paragraphs |
| `fragmentFloats.ts` | How one block of live text is made to stand in several places |

What it does not do:

- **Take back a break the file made on purpose.** Content is pulled back only
  across a break where the next line would not have fit. A chapter that ends
  short of its page, or a pair of columns the file balanced, stays as it is —
  and a page whose last lines were all taken back stays in the document, blank.
- **Search or mark what was typed.** Find looks through the file's text. A
  match, a decoration or a link on words that have since been replaced has
  nowhere to be drawn and is passed over.
- **Type in a style of its own.** Bold and italic apply to a selection; there
  is no pending style for the next character, and no change of size or colour.
- **Fall back for a missing character.** A character the paragraph's font does
  not have is drawn by the browser in some other font, and is not what a host
  will be able to save.
- **Find structure the host did not name.** Paragraphs, columns and running
  heads are found by geometry. A table can be taken for columns, and a scanned
  page is one unbreakable block.
- **Restart an input method's composition.** A composition begun in a paragraph
  the page still draws starts over once the paragraph is live text.

### Installing

```
npm install github:leonrjg/wilkes-reader#v0.3.0
```

`pdfjs-dist`, `react` and `react-dom` are peer dependencies. The package loads
pdf.js' `legacy/` build — library, viewer components and worker alike — because
the modern one calls JavaScript features (`Map.prototype.getOrInsertComputed`,
`Math.sumPrecise`) that the webviews hosts ship into do not all have yet.
`src/pdfjs.ts` is the only module that names a build.

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

In dark mode a page reader inverts its pages. The host sets how strongly with
`--pdf-dark-inversion` (0 to 1, default 0.9), or replaces the inversion with a
filter of its own with `--pdf-dark-filter` — `brightness(0.6)` dims the pages
instead.

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
`.textLayer` rule out of `legacy/web/pdf_viewer.css` and the tests will tell you what
else moved.

### Image page sources

`ImagePageViewer` reads image documents without a PDF conversion. Supply a stable
`ImagePageSource` with `key`, `pageCount`, and `loadPage(page, signal)`, returning
`{width, height, image: Blob}`. Dimensions use the host's page coordinate system;
rectangle decorations use those same units. Key the source by document identity.

The viewer uses the same TanStack virtualizer as the PDF reader, retains visible
images plus one adjacent page on each side, and limits page requests to two at a
time. Queued requests are discarded on cancellation. The source must honour the
abort signal; a running transport keeps its queue slot until it settles. Image
object URLs are revoked when their page leaves the render window.

A page that fails to load or decode shows "Could not load page N" in its own slot and is
logged to the console; the rest of the document keeps working, and the host's
`onRenderSuccess` still fires once the first visible page has settled either way.

Unopened page sizes are estimates. Exact dimensions arrive with each image, and
layout corrections preserve the current page and fractional scroll position.
Zoom, remembered positions, page navigation, and rectangle decorations use the
same host position store and coordinate contract as `PdfViewer`.
