import { act, fireEvent, screen } from "@testing-library/react";
import { createRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { openExternalSpy, renderWithReaderHost, stubSelectionSlot } from "./testing/readerHarness.js";
import HtmlViewer, { type HtmlReaderHandle } from "./HtmlViewer.js";

const NO_HIGHLIGHT = { start: 0, end: 0 };
const bytes = (text: string) => new TextEncoder().encode(text).length;

describe("HtmlViewer", () => {
  // The harness' host capability is one shared spy, so what a test asserts was
  // *not* asked of the host is only true if earlier tests' calls are gone.
  beforeEach(() => openExternalSpy.mockClear());

  it("renders the document's own structure", () => {
    renderWithReaderHost(
      <HtmlViewer
        documentPath="/corpus/report.html"
        highlightRange={NO_HIGHLIGHT}
        content={
          "<html><head><title>Report</title></head><body><h2>Findings</h2>" +
          "<table><tr><th>Metric</th></tr><tr><td>Kept</td></tr></table></body></html>"
        }
      />,
    );

    expect(screen.getByRole("heading", { name: "Findings", level: 2 })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Metric" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Kept" })).toBeInTheDocument();
  });

  it("renders no script, no author stylesheet and no title text", () => {
    renderWithReaderHost(
      <HtmlViewer
        documentPath="/corpus/report.html"
        highlightRange={NO_HIGHLIGHT}
        content={
          "<html><head><title>Tab title</title><style>body{display:none}</style></head>" +
          "<body><p>Prose</p><script>window.stolen = true;</script></body></html>"
        }
      />,
    );

    expect(document.querySelector("article")).toHaveTextContent("Prose");
    expect(document.querySelector("article")!.textContent).not.toContain("display:none");
    expect(document.querySelector("article")!.textContent).not.toContain("Tab title");
    expect(document.querySelector("script")).toBeNull();
    expect((window as unknown as { stolen?: boolean }).stolen).toBeUndefined();
  });

  it("hands an external link to the host instead of navigating to it", () => {
    renderWithReaderHost(
      <HtmlViewer
        documentPath="/corpus/report.html"
        highlightRange={NO_HIGHLIGHT}
        content={`<body><a href="https://example.com/paper">paper</a></body>`}
      />,
    );

    fireEvent.click(screen.getByRole("link", { name: "paper" }));

    expect(openExternalSpy).toHaveBeenCalledWith("https://example.com/paper");
  });

  it("asks the host to open a document beside this one, by path", () => {
    renderWithReaderHost(
      <HtmlViewer
        documentPath="/corpus/report.html"
        highlightRange={NO_HIGHLIGHT}
        content={`<body><a href="appendix/notes.html">notes</a></body>`}
      />,
    );

    fireEvent.click(screen.getByRole("link", { name: "notes" }));

    expect(openExternalSpy).toHaveBeenCalledWith("/corpus/appendix/notes.html");
  });

  it("follows a link into the document itself, through the prefix sanitizing gave the id", () => {
    renderWithReaderHost(
      <HtmlViewer
        documentPath="/corpus/report.html"
        highlightRange={NO_HIGHLIGHT}
        content={`<body><a href="#method">jump</a><h2 id="method">Method</h2></body>`}
      />,
    );
    const heading = screen.getByRole("heading", { name: "Method" });
    heading.scrollIntoView = vi.fn();

    fireEvent.click(screen.getByRole("link", { name: "jump" }));

    expect(heading).toHaveAttribute("id", "user-content-method");
    expect(heading.scrollIntoView).toHaveBeenCalled();
    expect(openExternalSpy).not.toHaveBeenCalled();
  });

  it("shows a picture beside the document at the URL the host serves it from", () => {
    renderWithReaderHost(
      <HtmlViewer
        documentPath="/corpus/report.html"
        highlightRange={NO_HIGHLIGHT}
        content={`<body><img src="figures/one.png" alt="Figure 1"><img src="https://cdn.example/two.png" alt="Figure 2"></body>`}
      />,
      { host: { resolveLocalAsset: (path) => `/asset?path=${path}` } },
    );

    expect(screen.getByAltText("Figure 1")).toHaveAttribute("src", "/asset?path=/corpus/figures/one.png");
    expect(screen.getByAltText("Figure 2")).not.toHaveAttribute("src");
    // Marked, but with nothing to report: the schema refused the remote address
    // before anything here saw it, which is where that refusal belongs.
    expect(screen.getByAltText("Figure 2")).toHaveAttribute("data-unresolved-src", "");
  });

  it("segments overlapping search and bookmark annotations from source byte ranges", () => {
    const content = "<body><p>Start café🙂 end</p></body>";
    const start = bytes("<body><p>Start ");
    const cafeEnd = start + bytes("café");
    const wordEnd = cafeEnd + bytes("🙂");
    renderWithReaderHost(
      <HtmlViewer
        documentPath="/corpus/report.html"
        content={content}
        restoreScrollPosition={false}
        highlightRange={{ start, end: wordEnd }}
        decorations={[
          {
            id: "cafe",
            anchor: { kind: "range", range: { start, end: cafeEnd } },
            className: "rendered-bookmark-highlight",
          },
        ]}
      />,
    );

    const overlap = document.querySelector<HTMLElement>(".rendered-search-highlight.rendered-bookmark-highlight");
    expect(overlap).toHaveTextContent("café");
    expect(overlap).toHaveAttribute("data-decoration-ids", "reader:search,cafe");
    expect(document.querySelector<HTMLElement>(".rendered-search-highlight:not(.rendered-bookmark-highlight)"))
      .toHaveTextContent("🙂");
  });

  it("opens a bookmark when its rendered highlight is clicked", () => {
    const onActivate = vi.fn();
    const start = bytes("<body><p>");
    renderWithReaderHost(
      <HtmlViewer
        documentPath="/corpus/report.html"
        content="<body><p>Read this note</p></body>"
        highlightRange={NO_HIGHLIGHT}
        decorations={[
          {
            id: "note-1",
            anchor: { kind: "range", range: { start, end: start + bytes("Read") } },
            className: "rendered-bookmark-highlight",
            onActivate,
          },
        ]}
      />,
    );

    fireEvent.click(document.querySelector(".rendered-bookmark-highlight")!);
    expect(onActivate).toHaveBeenCalledWith("note-1", { left: 0, top: 0, right: 0, bottom: 0 });
  });

  it("ignores decorations anchored in a coordinate system it cannot place", () => {
    renderWithReaderHost(
      <HtmlViewer
        documentPath="/corpus/report.html"
        content="<body><p>Read this note</p></body>"
        highlightRange={NO_HIGHLIGHT}
        decorations={[
          {
            id: "pdf-anchored",
            anchor: { kind: "rects", page: 1, rects: [{ x: 1, y: 2, width: 3, height: 4 }] },
            className: "rendered-bookmark-highlight",
          },
        ]}
      />,
    );

    expect(document.querySelector(".rendered-bookmark-highlight")).toBeNull();
  });

  it("maps a rendered selection back to the document's own bytes", () => {
    const onSelected = vi.fn();
    const content = "<body>\n<p>Pick <b>this</b> text</p>\n</body>";
    renderWithReaderHost(
      <HtmlViewer
        documentPath="/corpus/report.html"
        content={content}
        highlightRange={NO_HIGHLIGHT}
        slots={{ selectionActions: stubSelectionSlot({ onAction: onSelected }) }}
      />,
    );
    const run = Array.from(document.querySelectorAll<HTMLElement>(".reader-source-run"))
      .find((element) => element.textContent === "this")!;
    const text = run.firstChild!;
    const rect = { top: 10, left: 10, right: 50, bottom: 30, width: 40, height: 20, x: 10, y: 10, toJSON: () => ({}) } as DOMRect;
    const range = {
      startContainer: text,
      endContainer: text,
      startOffset: 0,
      endOffset: 4,
      getBoundingClientRect: () => rect,
      getClientRects: () => [rect] as unknown as DOMRectList,
    } as unknown as Range;
    vi.spyOn(window, "getSelection").mockReturnValue({
      isCollapsed: false,
      rangeCount: 1,
      getRangeAt: () => range,
      toString: () => "this",
      removeAllRanges: vi.fn(),
    } as unknown as Selection);

    fireEvent.mouseUp(run);
    fireEvent.click(screen.getByRole("button", { name: "Stub action" }));

    const start = content.indexOf("this");
    expect(onSelected).toHaveBeenCalledWith({
      quote: "this",
      origin: { TextFile: { line: 2, col: bytes("<p>Pick <b>") } },
      text_range: { start, end: start + bytes("this") },
      rects: [],
    });
  });

  it("opens find and reports zoom through the imperative handle", () => {
    const handle = createRef<HtmlReaderHandle>();
    renderWithReaderHost(
      <HtmlViewer
        ref={handle}
        documentPath="/corpus/handle.html"
        content="<body><p>Searchable text</p></body>"
        highlightRange={NO_HIGHLIGHT}
      />,
    );

    act(() => handle.current!.openFind("café"));
    expect(screen.getByPlaceholderText("Find in document...")).toHaveValue("café");

    act(() => handle.current!.setZoom(1.4));
    expect(handle.current!.getZoom()).toBe(1.4);
    expect(document.querySelector<HTMLElement>(".prose-document")!.style.fontSize).toBe("1.4rem");

    act(() => handle.current!.closeFind());
    expect(screen.queryByPlaceholderText("Find in document...")).not.toBeInTheDocument();
  });
});
