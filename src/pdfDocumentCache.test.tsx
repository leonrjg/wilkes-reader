import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDocument } from "pdfjs-dist";
import { usePdfDocument } from "./pdfDocumentCache.js";
import { pdfjsAssetUrls } from "./pdfjsAssetUrls.js";

vi.mock("pdfjs-dist", () => ({
  getDocument: vi.fn(),
}));

/** A loading task, which is what the cache owns and destroys on eviction.
 *  These tests load more documents than the cache holds, so a mock without
 *  `destroy` fails in the eviction rather than in the assertion. */
function task(promise: Promise<unknown>) {
  return { promise, destroy: vi.fn().mockResolvedValue(undefined) } as any;
}

describe("pdfDocumentCache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reports a failed load and retries when the attempt changes", async () => {
    const proxy = { numPages: 1, destroy: vi.fn() } as any;
    vi.mocked(getDocument)
      .mockReturnValueOnce(task(Promise.reject(new Error("PDF file not found"))))
      .mockReturnValueOnce(task(Promise.resolve(proxy)));
    const onLoadError = vi.fn();
    const { result, rerender } = renderHook(
      ({ attempt }) => usePdfDocument("retryable-missing.pdf", attempt, onLoadError),
      { initialProps: { attempt: 0 } },
    );

    await waitFor(() => expect(onLoadError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "PDF file not found" }),
    ));
    expect(result.current).toBeNull();

    rerender({ attempt: 1 });

    await waitFor(() => expect(result.current).toBe(proxy));
    expect(getDocument).toHaveBeenCalledTimes(2);
  });

  it("tells pdf.js where its decoders, fonts and character maps live", async () => {
    // Without these pdf.js cannot decode a scanned page, and the document
    // renders blank behind an invisible, still-selectable OCR text layer.
    const proxy = { numPages: 1 } as any;
    vi.mocked(getDocument).mockReturnValue(task(Promise.resolve(proxy)));

    renderHook(() => usePdfDocument("assets.pdf"));

    await waitFor(() => expect(getDocument).toHaveBeenCalled());
    expect(vi.mocked(getDocument).mock.calls[0][0]).toMatchObject({
      url: "assets.pdf",
      ...pdfjsAssetUrls(),
    });
  });

  describe("a source that is bytes rather than a URL", () => {
    it("reads from the bytes, and still locates the decoders", async () => {
      const proxy = { numPages: 1 } as any;
      vi.mocked(getDocument).mockReturnValue(task(Promise.resolve(proxy)));
      const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]).buffer;

      const { result } = renderHook(() => usePdfDocument({ key: "document:7", bytes }));

      await waitFor(() => expect(result.current).toBe(proxy));
      const params = vi.mocked(getDocument).mock.calls[0][0] as any;
      expect(params.url).toBeUndefined();
      expect(new Uint8Array(params.data)).toEqual(new Uint8Array(bytes));
      expect(params).toMatchObject(pdfjsAssetUrls());
    });

    it("hands pdf.js a copy, leaving the host's buffer usable", async () => {
      // pdf.js takes ownership of the buffer it is given and detaches it. A
      // host that keeps its bytes -- to reload after an eviction, to hash, to
      // hand to something else -- would find them zero-length.
      vi.mocked(getDocument).mockReturnValue(task(Promise.resolve({ numPages: 1 } as any)));
      const bytes = new Uint8Array([1, 2, 3, 4]).buffer;

      renderHook(() => usePdfDocument({ key: "document:8", bytes }));

      await waitFor(() => expect(getDocument).toHaveBeenCalled());
      expect((vi.mocked(getDocument).mock.calls[0][0] as any).data).not.toBe(bytes);
      expect(bytes.byteLength).toBe(4);
    });

    it("parses once per key, however many objects carry it", async () => {
      // The source object is rebuilt on every render of the host. Identity
      // cannot be what the cache keys on, or the document reloads per render.
      const proxy = { numPages: 1 } as any;
      vi.mocked(getDocument).mockReturnValue(task(Promise.resolve(proxy)));
      const bytes = new Uint8Array([1, 2, 3, 4]).buffer;

      const { result, rerender } = renderHook(() =>
        usePdfDocument({ key: "document:9", bytes }),
      );
      await waitFor(() => expect(result.current).toBe(proxy));
      rerender();
      rerender();

      expect(getDocument).toHaveBeenCalledTimes(1);
    });

    it("holds no document until there is a source", async () => {
      // Bytes that arrive over the host's own transport have a render pass
      // before them; that is not a load to report as failed.
      const proxy = { numPages: 1 } as any;
      vi.mocked(getDocument).mockReturnValue(task(Promise.resolve(proxy)));
      const bytes = new Uint8Array([1, 2, 3, 4]).buffer;
      const onLoadError = vi.fn();

      const { result, rerender } = renderHook(
        ({ source }) => usePdfDocument(source, 0, onLoadError),
        { initialProps: { source: null as any } },
      );
      expect(result.current).toBeNull();
      expect(getDocument).not.toHaveBeenCalled();
      expect(onLoadError).not.toHaveBeenCalled();

      rerender({ source: { key: "document:10", bytes } as any });

      await waitFor(() => expect(result.current).toBe(proxy));
    });
  });
});
