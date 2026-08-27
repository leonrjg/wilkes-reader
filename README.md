## wilkes-reader

Document readers — PDF, Markdown and source - used by [Wilkes](https://github.com/leonrjg/Wilkes).

## What a host provides, and what it gets

The readers know how to render a document. They know nothing about bookmarks,
chat, review state or search backends. Four channels carry everything a host
needs, and nothing app-specific crosses back:

| Channel | Direction | For |
| --- | --- | --- |
| `decorations` | host → reader | Marks on the document, anchored by page rects or a text range |
| `slots` | host → reader | Host chrome rendered inside the reader (selection actions, page gutter) |
| `ref` | host → reader | Navigation, zoom and find as imperative commands |
| `ReaderHostProvider` | host → reader | Capabilities the readers need: opening a URL, the colour scheme |

`index.ts` is the whole public surface, in two tiers: the composed readers with
that contract, and the headless hooks for a host whose reading surface is not a
reader — an annotated single-page stage, a thumbnail strip — which would
otherwise reimplement document loading and text location badly.

## Installing

```
npm install github:leonrjg/wilkes-reader#v0.1.0
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

## Wiring it into a Vite application

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

## Releasing

```
git tag vX.Y.Z && git push --tags
```

## Theming

`reader.css` defines a light-only `:root` of defaults so the readers render
correctly with no host palette at all. A host overrides those tokens; dark mode
is a host decision, delivered through `colorScheme` on the provider rather than
inferred from a class the readers cannot see.

## Bumping pdf.js

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
