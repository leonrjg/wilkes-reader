import { renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { usePdfOutline } from "./usePdfOutline.js";

function makePdf(getOutline: () => Promise<unknown>) {
  return { getOutline: vi.fn(getOutline) } as never;
}

describe("usePdfOutline", () => {
  it("prefers a host-supplied outline over the document's", async () => {
    // A book rendered to pages for display carries no outline of its own, so
    // asking the document would report it as having none -- a different claim
    // from the truth, and the one thing an EPUB declares better than a PDF.
    const getOutline = vi.fn();
    const pdf = { getOutline } as never;
    const supplied = [{ title: "Segunda regla", dest: { page: 34 }, url: null, items: [] }];

    const { result } = renderHook(() => usePdfOutline(pdf, supplied));

    await waitFor(() => expect(result.current).toEqual(supplied));
    expect(getOutline).not.toHaveBeenCalled();
  });

  it("treats an empty host outline as no outline, hiding the affordance", async () => {
    const pdf = { getOutline: vi.fn() } as never;
    const { result } = renderHook(() => usePdfOutline(pdf, []));
    await waitFor(() => expect(result.current).toBeNull());
  });

  it("returns null when the document has no outline", async () => {
    const pdf = makePdf(async () => null);
    const { result } = renderHook(() => usePdfOutline(pdf));
    // Give the effect a chance to run; value should stay null.
    await waitFor(() => expect(pdf.getOutline).toHaveBeenCalled());
    expect(result.current).toBeNull();
  });

  it("normalizes a nested outline into title/dest/url/items nodes", async () => {
    const pdf = makePdf(async () => [
      {
        title: "Chapter 1",
        dest: "ch1",
        items: [{ title: "Section 1.1", dest: ["ref", { name: "XYZ" }], items: [] }],
      },
      { title: "External", url: "https://example.com" },
    ]);

    const { result } = renderHook(() => usePdfOutline(pdf));

    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current).toEqual([
      {
        title: "Chapter 1",
        dest: "ch1",
        url: null,
        items: [
          { title: "Section 1.1", dest: ["ref", { name: "XYZ" }], url: null, items: [] },
        ],
      },
      { title: "External", dest: null, url: "https://example.com", items: [] },
    ]);
  });

  it("returns null when pdf is null", () => {
    const { result } = renderHook(() => usePdfOutline(null));
    expect(result.current).toBeNull();
  });
});
