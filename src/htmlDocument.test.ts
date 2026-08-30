import { describe, expect, it, vi } from "vitest";
import type { Element, Nodes } from "hast";
import { markHtmlDocument, parseHtmlDocument, renderableHtml, resolveDocumentRelativePath } from "./htmlDocument.js";

function elements(node: Nodes, tagName: string): Element[] {
  const found: Element[] = [];
  const visit = (current: Nodes) => {
    if (current.type === "element" && current.tagName === tagName) found.push(current);
    if ("children" in current) current.children.forEach(visit);
  };
  visit(node);
  return found;
}

function text(node: Nodes): string {
  if (node.type === "text") return node.value;
  return "children" in node ? node.children.map(text).join("") : "";
}

const render = (content: string, options: Partial<Parameters<typeof renderableHtml>[1]> = {}) =>
  renderableHtml(content, { documentPath: "/corpus/report.html", annotations: [], ...options });

describe("renderableHtml", () => {
  it("removes a script and its source rather than unwrapping it into the prose", () => {
    const tree = render("<body><p>Body</p><script>alert('x')</script></body>");

    expect(elements(tree, "script")).toHaveLength(0);
    expect(text(tree)).toBe("Body");
  });

  it("removes an author stylesheet with its rules, which unwrapping would have kept as text", () => {
    const tree = render("<head><style>body{display:none}</style><title>T</title></head><body>Read me</body>");

    expect(text(tree)).toBe("Read me");
  });

  it("drops event handlers, javascript: destinations and frames", () => {
    const tree = render(
      `<body><p onclick="steal()">p</p><a href="javascript:steal()">a</a><iframe src="https://e.example"></iframe></body>`,
    );

    expect(elements(tree, "p")[0].properties.onClick).toBeUndefined();
    expect(elements(tree, "a")[0].properties.href).toBeUndefined();
    expect(elements(tree, "iframe")).toHaveLength(0);
  });

  it("does not let a document fetch anything when it is opened", () => {
    const tree = render(
      `<body><img src="https://tracker.example/pixel.png" alt="p"><img src="//tracker.example/p.png" alt="q"></body>`,
    );

    for (const image of elements(tree, "img")) {
      expect(image.properties.src).toBeUndefined();
      expect(image.properties.dataUnresolvedSrc).toBeDefined();
    }
  });

  it("keeps an image that is part of the file", () => {
    const inline = "data:image/gif;base64,R0lGODlhAQABAAAAACw=";
    const tree = render(`<body><img src="${inline}" alt="inline"></body>`);

    expect(elements(tree, "img")[0].properties.src).toBe(inline);
  });

  it("asks the host for a picture beside the document, and shows the alt text when it is refused", () => {
    const resolveLocalAsset = vi.fn((path: string) => (path.endsWith("kept.png") ? `/asset?p=${path}` : null));
    const tree = render(
      `<body><img src="figures/kept.png" alt="kept"><img src="../refused.png" alt="refused"></body>`,
      { resolveLocalAsset },
    );

    expect(resolveLocalAsset).toHaveBeenCalledWith("/corpus/figures/kept.png");
    expect(resolveLocalAsset).toHaveBeenCalledWith("/refused.png");
    expect(elements(tree, "img")[0].properties.src).toBe("/asset?p=/corpus/figures/kept.png");
    expect(elements(tree, "img")[1].properties.src).toBeUndefined();
    expect(elements(tree, "img")[1].properties.alt).toBe("refused");
  });

  it("marks a link to a file beside the document with the path the host would open", () => {
    const tree = render(`<body><a href="notes/appendix.html">appendix</a><a href="#top">top</a></body>`);

    expect(elements(tree, "a")[0].properties.href).toBe("/corpus/notes/appendix.html");
    expect(elements(tree, "a")[0].properties.dataLocalLink).toBe("");
    expect(elements(tree, "a")[1].properties.href).toBe("#top");
    expect(elements(tree, "a")[1].properties.dataLocalLink).toBeUndefined();
  });

  it("makes every rendered run addressable in the source bytes it came from", () => {
    const content = "<body><p>caf&eacute; \u{1F642}</p></body>";
    const tree = render(content);
    const span = elements(tree, "span")[0];
    const boundaries = String(span.properties.dataSourceBoundaries).split(",").map(Number);

    expect(text(span)).toBe("café 🙂");
    // The run starts after `<body><p>` and the first boundary steps over the
    // whole `&eacute;` entity, which is one visible character.
    expect(boundaries[0]).toBe(new TextEncoder().encode("<body><p>").length);
    expect(boundaries[1] - boundaries[0]).toBe("c".length);
    expect(boundaries[4] - boundaries[3]).toBe("&eacute;".length);
  });

  it("keeps a newline in flowing text as whitespace rather than a line break", () => {
    const tree = render("<body><p>one\ntwo</p></body>");

    expect(elements(tree, "br")).toHaveLength(0);
    expect(text(tree)).toBe("one\ntwo");
  });
});

describe("markHtmlDocument", () => {
  it("leaves the parse it was given unmarked, so one parse serves every set of marks", () => {
    const content = "<body><p>Pick this text</p></body>";
    const start = new TextEncoder().encode("<body><p>Pick ").length;
    const parsed = parseHtmlDocument(content, { documentPath: "/corpus/report.html" });

    const first = markHtmlDocument(parsed, content, [
      { id: "a", range: { start, end: start + 4 }, className: "mark-a" },
    ]);
    const second = markHtmlDocument(parsed, content, [
      { id: "b", range: { start, end: start + 4 }, className: "mark-b" },
    ]);

    expect(elements(first, "span").some((span) => String(span.properties.className).includes("mark-a"))).toBe(true);
    expect(elements(second, "span").some((span) => String(span.properties.className).includes("mark-a"))).toBe(false);
    expect(elements(second, "span").some((span) => String(span.properties.className).includes("mark-b"))).toBe(true);
    expect(elements(parsed, "span")).toHaveLength(0);
  });
});

describe("resolveDocumentRelativePath", () => {
  const document = "/corpus/My Docs/report.html";

  it.each([
    ["figures/fig 1.png", "/corpus/My Docs/figures/fig 1.png"],
    ["../shared/logo.png", "/corpus/shared/logo.png"],
    ["./a/../b.png", "/corpus/My Docs/b.png"],
    ["fig%20one.png", "/corpus/My Docs/fig one.png"],
    ["image.png?v=2#anchor", "/corpus/My Docs/image.png"],
    ["/rooted.png", "/rooted.png"],
  ])("resolves %s", (reference, expected) => {
    expect(resolveDocumentRelativePath(document, reference)).toBe(expected);
  });

  it("refuses a reference that names a host rather than a file", () => {
    expect(resolveDocumentRelativePath(document, "//host.example/x.png")).toBeNull();
  });

  it("refuses a reference that is not a path", () => {
    expect(resolveDocumentRelativePath(document, "%E2.png")).toBeNull();
  });

  it("answers in the separators the host asked in", () => {
    expect(resolveDocumentRelativePath("C:\\Corpus\\report.html", "media/a.png")).toBe(
      "C:\\Corpus\\media\\a.png",
    );
  });
});
