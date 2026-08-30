import type { Element, Nodes, Root } from "hast";
import { fromHtml } from "hast-util-from-html";
import { defaultSchema, sanitize, type Schema } from "hast-util-sanitize";
import { withSourceRuns, type HastNode, type TextAnnotation } from "./sourceRuns.js";

/**
 * What an HTML file becomes before it is rendered.
 *
 * The reader is a reader, not a browser. A document arrives as bytes from disk
 * with no origin, no CSP and no user behind it, so what it may do here is a
 * closed list rather than an open one: it contributes structure and text, and
 * the reader contributes the typography. Scripts, author stylesheets, frames,
 * forms and plugins do not survive this module, and nothing in the document can
 * cause a request to leave the machine -- opening a file must not tell anyone
 * that it was opened.
 */

/** Elements removed with their contents.
 *
 *  Sanitizing normally *unwraps* a disallowed element, which is right for a
 *  `<div>` and wrong for a `<style>`: the stylesheet's text would be kept and
 *  land in the document as prose. Anything whose children are not prose has to
 *  be named here instead. */
const STRIPPED = [
  "script",
  "style",
  "title",
  "head",
  "noscript",
  "template",
  "iframe",
  "frame",
  "frameset",
  "object",
  "embed",
  "applet",
  "form",
  "button",
  "select",
  "textarea",
  "canvas",
  "audio",
  "video",
  "svg",
  "math",
  "link",
  "meta",
  "base",
  "dialog",
  "portal",
];

/** Structural and inline elements a document reasonably uses that GitHub's
 *  comment-oriented default does not list. Kept to elements with a rendering
 *  the reader's typography can honour; anything else is unwrapped, which keeps
 *  its text. */
const DOCUMENT_TAGS = [
  "article",
  "aside",
  "figure",
  "figcaption",
  "footer",
  "header",
  "hgroup",
  "main",
  "nav",
  "caption",
  "colgroup",
  "col",
  "abbr",
  "cite",
  "time",
  "mark",
  "small",
  "u",
  "bdi",
  "bdo",
  "wbr",
];

export const READER_HTML_SCHEMA: Schema = {
  ...defaultSchema,
  strip: [...(defaultSchema.strip ?? []), ...STRIPPED],
  tagNames: [...(defaultSchema.tagNames ?? []), ...DOCUMENT_TAGS],
  // `data:` alone: an inline image is part of the file, and every other scheme
  // on a subresource is a fetch. A relative reference carries no scheme and so
  // passes this check untouched -- it is resolved below, where the host decides
  // whether it will serve the file it names.
  protocols: { ...defaultSchema.protocols, src: ["data"] },
};

/** Whether a reference addresses somewhere other than the file next to this
 *  document. Protocol-relative (`//host/x`) counts: it has no scheme to reject,
 *  and it is still the network. */
function isAbsoluteReference(reference: string): boolean {
  return reference.startsWith("//") || /^[a-z][a-z\d+\-.]*:/i.test(reference);
}

/**
 * Where a document-relative reference points, as a path in the host's own
 * filesystem vocabulary.
 *
 * Resolved through the URL parser rather than by joining path segments: `..`,
 * `.`, percent-escapes, a stray query or fragment and a protocol-relative
 * authority are all things it already gets right, and it is the same resolver
 * the document would have been read by anywhere else.
 *
 * The reader resolves this rather than the host because it is the reader that
 * knows a reference is document-relative; the host only knows how to turn a
 * path into something it will serve, which is the one thing the reader cannot
 * know. `..` is resolved but not fenced -- what a document may reach is the
 * host's judgement, made where it resolves the path.
 */
export function resolveDocumentRelativePath(documentPath: string, reference: string): string | null {
  const windows = documentPath.includes("\\") && !documentPath.includes("/");
  const base = "file:///" + documentPath
    .split(/[/\\]/)
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");
  let resolved: URL;
  try {
    resolved = new URL(reference, base);
  } catch {
    return null;
  }
  // An authority means the reference addressed a host, not a sibling file.
  if (resolved.protocol !== "file:" || resolved.host) return null;
  let path: string;
  try {
    path = decodeURIComponent(resolved.pathname);
  } catch {
    // A reference with a stray `%` is not a path; nothing to resolve.
    return null;
  }
  if (!path || path === "/") return null;
  return windows ? path.replace(/^\//, "").replace(/\//g, "\\") : path;
}

/** Marks an anchor whose destination is a file beside the document, so the
 *  reader hands it to the host rather than letting the webview navigate.
 *  Written in the tree under hast's own spelling, read back off the DOM under
 *  the attribute name that spelling renders to. */
export const LOCAL_LINK_PROPERTY = "dataLocalLink";
export const LOCAL_LINK_ATTRIBUTE = "data-local-link";
/** Marks an image with nothing to show -- refused by the host, or addressed
 *  somewhere the reader will not fetch from -- so the stylesheet can present
 *  its alt text as words rather than as a broken graphic. */
export const UNRESOLVED_IMAGE_PROPERTY = "dataUnresolvedSrc";
export const UNRESOLVED_IMAGE_ATTRIBUTE = "data-unresolved-src";

function resolveReferences(
  node: Nodes,
  documentPath: string,
  resolveLocalAsset: ((path: string) => string | null) | undefined,
): void {
  if (node.type === "element") {
    const { properties } = node as Element;
    if (node.tagName === "img") {
      const source = typeof properties.src === "string" ? properties.src : "";
      if (source && !source.startsWith("data:")) {
        const path = isAbsoluteReference(source)
          ? null
          : resolveDocumentRelativePath(documentPath, source);
        const url = path && resolveLocalAsset ? resolveLocalAsset(path) : null;
        if (url) properties.src = url;
        else delete properties.src;
      }
      // Including an image whose `src` the schema already refused, which is
      // why the mark can be empty: what is left either way is an element with
      // nothing to draw, and the reading is better served by its alt text than
      // by a browser's broken-image graphic.
      if (!properties.src) properties[UNRESOLVED_IMAGE_PROPERTY] = source;
    }
    if (node.tagName === "a") {
      const href = typeof properties.href === "string" ? properties.href : "";
      if (href && !href.startsWith("#") && !isAbsoluteReference(href)) {
        const path = resolveDocumentRelativePath(documentPath, href);
        if (path) {
          properties.href = path;
          properties[LOCAL_LINK_PROPERTY] = "";
        } else {
          delete properties.href;
        }
      }
    }
  }
  if ("children" in node) {
    for (const child of node.children) resolveReferences(child, documentPath, resolveLocalAsset);
  }
}

export interface HtmlDocumentOptions {
  documentPath: string;
  /** How the host turns a local file path into something it will serve. Absent,
   *  a document renders without its images: the reader will not invent a way to
   *  fetch a file the application has not offered it. */
  resolveLocalAsset?: (path: string) => string | null;
}

/**
 * Parse a document and keep what may be shown of it.
 *
 * The order is the point. Parsing first is what gives every text node a source
 * position; sanitizing second decides what is rendered at all; marking the text
 * runs last (`withSourceRuns`, below) cuts spans only in text that survived,
 * and the spans it adds are not themselves subject to a schema that would strip
 * their attributes.
 *
 * Separate from the marking because a document is parsed once and marked again
 * every time the host's bookmarks or the search target change.
 */
export function parseHtmlDocument(content: string, options: HtmlDocumentOptions): Root {
  const parsed = fromHtml(content);
  const body = findBody(parsed);
  // Everything outside `<body>` is about the document rather than in it. Parsing
  // the whole file rather than a fragment is what puts stray content where the
  // browser would have put it, so taking the body here loses nothing.
  const document = sanitize(
    { type: "root", children: body ? body.children : parsed.children },
    READER_HTML_SCHEMA,
  ) as Root;
  resolveReferences(document, options.documentPath, options.resolveLocalAsset);
  return document;
}

/** The document with the host's marks on it, ready to render. A newline in
 *  flowing HTML is whitespace the layout collapses, not a line break. */
export function markHtmlDocument(document: Root, content: string, annotations: TextAnnotation[]): Root {
  return withSourceRuns(document as unknown as HastNode, content, annotations, "collapse") as unknown as Root;
}

/** Both halves, for a caller that has no reason to keep the parse. */
export function renderableHtml(
  content: string,
  options: HtmlDocumentOptions & { annotations: TextAnnotation[] },
): Root {
  return markHtmlDocument(parseHtmlDocument(content, options), content, options.annotations);
}

function findBody(node: Nodes): Element | null {
  if (node.type === "element" && node.tagName === "body") return node;
  if (!("children" in node)) return null;
  for (const child of node.children) {
    const found = findBody(child);
    if (found) return found;
  }
  return null;
}
