# wilkes-reader

Document readers — PDF, Markdown and source — shared between
[Wilkes](https://github.com/leonrjg/Wilkes) and Underdog. Both are Tauri 2 +
React 19 applications; both need the same reading surface, and a fix or an
affordance added here reaches both.

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
pnpm add github:leonrjg/wilkes-reader#v0.1.0
```

`pdfjs-dist`, `react` and `react-dom` are peer dependencies. While editing the
package alongside an application, `pnpm link ../wilkes-reader` instead.

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

`dist/` is committed. Installing from a git tag has no build step: pnpm blocks
a dependency's `prepare` script unless the consuming project opts in, so a
package that builds itself on install arrives empty, and the failure surfaces
as a missing module rather than as a build error. Shipping the artifact also
means a consumer's CI needs no TypeScript to install.

So a release is:

```
pnpm run build && git add -A && git commit && git tag vX.Y.Z && git push --tags
```

`pnpm test` runs against `src/`, never `dist/`, so a stale artifact cannot make
the tests pass.

## Theming

`reader.css` defines a light-only `:root` of defaults so the readers render
correctly with no host palette at all. A host overrides those tokens; dark mode
is a host decision, delivered through `colorScheme` on the provider rather than
inferred from a class the readers cannot see.

## Bumping pdf.js

`src/pdfTextLayer.css` is a verbatim copy of pdf.js' own text-layer
stylesheet and **must be re-synced on every version bump**. From pdf.js 6 the
span geometry lives in that stylesheet, so a stale copy silently misaligns the
invisible text over the glyphs and breaks selection without erroring.
