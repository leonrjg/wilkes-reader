import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { beforeEach, describe, it, expect, vi } from "vitest";
import PdfLinkLayer from "./PdfLinkLayer.js";

const { mockGetPdfLinkPreview } = vi.hoisted(() => ({
  mockGetPdfLinkPreview: vi.fn(),
}));
vi.mock("./pdfLinkPreview", () => ({
  getPdfLinkPreview: mockGetPdfLinkPreview,
}));

function makePdf(annotations: unknown[]) {
  return {
    getPage: vi.fn().mockResolvedValue({
      getAnnotations: vi.fn().mockResolvedValue(annotations),
      // Identity-ish mapping at scale 1 keeps the rect math easy to assert.
      getViewport: () => ({
        convertToViewportPoint: (x: number, y: number) => [x, y],
      }),
    }),
  } as never;
}

describe("PdfLinkLayer", () => {
  beforeEach(() => {
    mockGetPdfLinkPreview.mockReset();
    mockGetPdfLinkPreview.mockResolvedValue(null);
  });

  it("uses host-supplied links and never asks the document", async () => {
    // A book rendered to pages for display has no link annotations at all --
    // a page writer emits drawing operations and an annotation is not one --
    // so asking would find none and every footnote would go dead.
    const getAnnotations = vi.fn();
    const pdf = {
      getPage: vi.fn().mockResolvedValue({ getAnnotations, getViewport: () => ({}) }),
    } as never;

    render(
      <PdfLinkLayer
        pdf={pdf}
        pageNumber={1}
        scale={2}
        hostLinks={[
          { bbox: { x: 10, y: 20, width: 50, height: 12 }, page: 34, offsetY: 100 },
          { bbox: { x: 10, y: 40, width: 50, height: 12 }, url: "https://example.com" },
          { bbox: { x: 0, y: 0, width: 5, height: 5 } },
        ]}
        onNavigateToDestination={() => {}}
        onOpenExternal={() => {}}
      />,
    );

    // The third goes nowhere and is not clickable.
    await waitFor(() => expect(screen.getAllByRole("link")).toHaveLength(2));
    expect(getAnnotations).not.toHaveBeenCalled();

    // Host boxes are unscaled page units; only the render scale separates
    // them from CSS pixels.
    const [internal] = screen.getAllByRole("link");
    expect(internal).toHaveStyle({ left: "20px", top: "40px", width: "100px", height: "24px" });
  });

  it("navigates to a host link's page", async () => {
    const onNavigateToDestination = vi.fn();
    const pdf = {
      getPage: vi.fn().mockResolvedValue({
        getAnnotations: vi.fn().mockResolvedValue([]),
        getViewport: () => ({}),
      }),
    } as never;

    render(
      <PdfLinkLayer
        pdf={pdf}
        pageNumber={1}
        scale={1}
        hostLinks={[{ bbox: { x: 0, y: 0, width: 10, height: 10 }, page: 7 }]}
        onNavigateToDestination={onNavigateToDestination}
        onOpenExternal={() => {}}
      />,
    );

    await waitFor(() => expect(screen.getAllByRole("link")).toHaveLength(1));
    fireEvent.click(screen.getAllByRole("link")[0]);
    expect(onNavigateToDestination).toHaveBeenCalledWith({ page: 7, offsetY: null });
  });

  it("renders overlays only for Link annotations that navigate somewhere", async () => {
    const pdf = makePdf([
      { subtype: "Link", dest: "sec.1", rect: [10, 20, 60, 40] },
      { subtype: "Link", url: "https://example.com", rect: [10, 50, 60, 70] },
      { subtype: "Link", rect: [0, 0, 5, 5] }, // no dest/url → skipped
      { subtype: "Text", dest: "sec.2", rect: [0, 0, 5, 5] }, // not a Link → skipped
    ]);

    render(
      <PdfLinkLayer
        pdf={pdf}
        pageNumber={1}
        scale={1}
        onNavigateToDestination={vi.fn()}
        onOpenExternal={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getAllByTestId("pdf-link")).toHaveLength(2));
    expect(screen.getAllByTestId("pdf-link")[0]).toHaveStyle({ zIndex: "2" });
  });

  it("invokes navigation for an internal link and external open for a URL link", async () => {
    const onNavigate = vi.fn();
    const onOpen = vi.fn();
    const pdf = makePdf([
      { subtype: "Link", dest: "sec.1", rect: [10, 20, 60, 40] },
      { subtype: "Link", url: "https://example.com", rect: [10, 50, 60, 70] },
    ]);

    render(
      <PdfLinkLayer
        pdf={pdf}
        pageNumber={1}
        scale={1}
        onNavigateToDestination={onNavigate}
        onOpenExternal={onOpen}
      />,
    );

    await waitFor(() => expect(screen.getAllByTestId("pdf-link")).toHaveLength(2));
    const [internal, external] = screen.getAllByTestId("pdf-link");

    fireEvent.click(internal);
    expect(onNavigate).toHaveBeenCalledWith("sec.1");

    fireEvent.click(external);
    expect(onOpen).toHaveBeenCalledWith("https://example.com");
  });

  it("loads an internal-link preview on focus without changing click navigation", async () => {
    const onNavigate = vi.fn();
    mockGetPdfLinkPreview.mockResolvedValue({
      pageNumber: 12,
      text: "Target text from an opaque destination",
    });
    const pdf = makePdf([
      { subtype: "Link", dest: "opaque.destination", rect: [10, 20, 60, 40] },
    ]);

    render(
      <PdfLinkLayer
        pdf={pdf}
        pageNumber={1}
        scale={1}
        onNavigateToDestination={onNavigate}
        onOpenExternal={vi.fn()}
      />,
    );

    const link = await screen.findByTestId("pdf-link");
    fireEvent.focus(link);

    await waitFor(() =>
      expect(screen.getByRole("tooltip")).toHaveTextContent(
        "Target text from an opaque destination",
      ),
    );
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip).toHaveTextContent("Page 12");
    expect(tooltip).toHaveClass("pointer-events-auto", "select-text");
    expect(mockGetPdfLinkPreview).toHaveBeenCalledWith(
      pdf,
      "opaque.destination",
    );

    fireEvent.click(link);
    expect(onNavigate).toHaveBeenCalledWith("opaque.destination");
  });
});
