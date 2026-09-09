import { describe, it, expect, vi } from "vitest";
import { resolveDestination } from "./pdfDestinations.js";

function makePdf(overrides: Record<string, unknown> = {}) {
  return {
    getDestination: vi.fn(),
    getPageIndex: vi.fn().mockResolvedValue(4),
    getPage: vi.fn().mockResolvedValue({
      view: [0, 0, 600, 800],
      getViewport: () => ({
        transform: [1, 0, 0, -1, 0, 800],
        // Emulate pdf.js' bottom-left → top-left flip for a 800-high page.
        convertToViewportPoint: (x: number, y: number) => [x, 800 - y],
      }),
    }),
    ...overrides,
  } as never;
}

describe("resolveDestination", () => {
  it("resolves a host destination without consulting the document", async () => {
    // The point of a host destination: the reader may be drawing a rendering
    // whose pages pdf.js parsed, while the destination was resolved against
    // the document the host laid out. Asking pdf.js would be asking the wrong
    // document, and for a book there is nothing there to ask.
    const pdf = {
      getDestination: vi.fn(),
      getPageIndex: vi.fn(),
    } as never;

    const resolved = await resolveDestination(pdf, { page: 34, offsetY: 120 });

    expect(resolved).toEqual({
      pageIndex: 33,
      mode: null,
      offsetX: null,
      offsetY: 120,
    });
    expect((pdf as unknown as { getDestination: ReturnType<typeof vi.fn> }).getDestination)
      .not.toHaveBeenCalled();
    expect((pdf as unknown as { getPageIndex: ReturnType<typeof vi.fn> }).getPageIndex)
      .not.toHaveBeenCalled();
  });

  it("treats a host destination with no offset as pinning no position", async () => {
    const pdf = { getDestination: vi.fn(), getPageIndex: vi.fn() } as never;
    const resolved = await resolveDestination(pdf, { page: 1 });
    expect(resolved).toMatchObject({ pageIndex: 0, offsetY: null });
  });

  it("resolves an explicit XYZ destination to page index and top-left offset", async () => {
    const pdf = makePdf();
    const dest = [{ ref: 1 }, { name: "XYZ" }, 0, 700, null];

    const resolved = await resolveDestination(pdf, dest);

    expect(resolved).toEqual({
      pageIndex: 4,
      mode: "XYZ",
      offsetX: 0,
      offsetY: 100,
    });
  });

  it("resolves a named destination via getDestination", async () => {
    const pdf = makePdf({
      getDestination: vi.fn().mockResolvedValue([{ ref: 2 }, { name: "FitH" }, 600]),
    });

    const resolved = await resolveDestination(pdf, "section.1");

    expect(pdf.getDestination).toHaveBeenCalledWith("section.1");
    expect(resolved).toEqual({
      pageIndex: 4,
      mode: "FitH",
      offsetX: null,
      offsetY: 200,
    });
  });

  it("resolves a FitR destination to its upper-left spatial anchor", async () => {
    const pdf = makePdf();
    const dest = [{ ref: 1 }, { name: "FitR" }, 40, 100, 300, 650];

    const resolved = await resolveDestination(pdf, dest);

    expect(resolved).toEqual({
      pageIndex: 4,
      mode: "FitR",
      offsetX: 40,
      offsetY: 150,
    });
  });

  it("preserves which axis a one-dimensional destination constrains", async () => {
    const pdf = makePdf();
    const dest = [{ ref: 1 }, { name: "FitV" }, 75];

    const resolved = await resolveDestination(pdf, dest);

    expect(resolved).toEqual({
      pageIndex: 4,
      mode: "FitV",
      offsetX: 75,
      offsetY: null,
    });
  });

  it("maps constrained axes through a rotated page viewport", async () => {
    const pdf = makePdf({
      getPage: vi.fn().mockResolvedValue({
        view: [0, 0, 600, 800],
        getViewport: () => ({
          // A quarter-turn maps PDF y to viewport x and PDF x to viewport y.
          transform: [0, 1, 1, 0, 0, 0],
          convertToViewportPoint: (x: number, y: number) => [y, x],
        }),
      }),
    });

    const resolved = await resolveDestination(
      pdf,
      [{ ref: 1 }, { name: "FitH" }, 600],
    );

    expect(resolved).toEqual({
      pageIndex: 4,
      mode: "FitH",
      offsetX: 600,
      offsetY: null,
    });
  });

  it("returns null spatial offsets for destinations without a pinned position", async () => {
    const pdf = makePdf();
    const dest = [{ ref: 1 }, { name: "Fit" }];

    const resolved = await resolveDestination(pdf, dest);

    expect(resolved).toEqual({
      pageIndex: 4,
      mode: "Fit",
      offsetX: null,
      offsetY: null,
    });
    expect(pdf.getPage).not.toHaveBeenCalled();
  });

  it("returns null for an unresolvable named destination", async () => {
    const pdf = makePdf({ getDestination: vi.fn().mockResolvedValue(null) });

    expect(await resolveDestination(pdf, "missing")).toBeNull();
  });
});
