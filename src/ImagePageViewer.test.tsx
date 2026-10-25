import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ImagePageViewer, { ImagePageQueue, imagePageLayout, type ImagePage } from "./ImagePageViewer.js";
import { ReaderHostProvider } from "./ReaderHost.js";
import { createMemoryPositionStore } from "./readerPositions.js";

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get: () => 600 });
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get: () => 800 });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 600 });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 800 });
  HTMLElement.prototype.scrollTo = function(options: ScrollToOptions | number, y?: number) {
    this.scrollTop = typeof options === "number" ? y ?? 0 : options.top ?? this.scrollTop;
    this.scrollLeft = typeof options === "number" ? options : options.left ?? this.scrollLeft;
    this.dispatchEvent(new Event("scroll"));
  };
});

const result = (): ImagePage => ({ width: 100, height: 140, image: new Blob(["page"], { type: "image/png" }) });
const settle = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

describe("image page scheduling", () => {
  it("bounds running IO and drops aborted work before it reaches the host", async () => {
    const releases: Array<(value: ImagePage) => void> = [];
    const loader = vi.fn(() => new Promise<ImagePage>(resolve => releases.push(resolve)));
    const queue = new ImagePageQueue(loader);
    const controllers = Array.from({length: 8}, () => new AbortController());
    const jobs = controllers.map((c, index) => queue.loadPage(index + 1, c.signal).catch(e => e));
    expect(loader).toHaveBeenCalledTimes(2);
    controllers.slice(2, 7).forEach(c => c.abort());
    releases[0](result()); await settle();
    expect(loader).toHaveBeenCalledTimes(3);
    expect(loader.mock.lastCall?.[0]).toBe(8);
    releases[1](result()); releases[2](result());
    await Promise.all(jobs);
  });
  it("does not free an IPC slot until an aborted request actually settles", async () => {
    const releases: Array<(value: ImagePage) => void> = [];
    const loader = vi.fn(() => new Promise<ImagePage>(resolve => releases.push(resolve)));
    const queue = new ImagePageQueue(loader);
    const first = new AbortController();
    const jobs = [queue.loadPage(1, first.signal), queue.loadPage(2, new AbortController().signal), queue.loadPage(3, new AbortController().signal)];
    first.abort(); expect(loader).toHaveBeenCalledTimes(2);
    releases[0](result()); await settle(); expect(loader).toHaveBeenCalledTimes(3);
    releases[1](result()); releases[2](result()); await Promise.all(jobs);
  });
  it("uses known page geometry and estimates unopened pages without requesting them", () => {
    const layout = imagePageLayout(213, 600, new Map([[100, {width: 100, height: 200}]]));
    expect(layout).toHaveLength(213);
    expect(layout[99].height).toBe(1200);
    expect(layout[100].top - layout[99].top).toBe(1212);
  });
});

describe("image reader lifecycle", () => {
  beforeEach(() => {
    let id = 0;
    URL.createObjectURL = vi.fn(() => `blob:page-${++id}`);
    URL.revokeObjectURL = vi.fn();
  });
  it("opens a remembered distant page without loading the whole archive and releases images on exit", async () => {
    const positions = createMemoryPositionStore();
    positions.savePdf("comic", {page: 100, offsetRatio: 0.25, horizontalRatio: 0.5, zoom: 1});
    const loader = vi.fn(async () => result());
    const onReady = vi.fn();
    const view = render(<ReaderHostProvider value={{ positions, colorScheme: "light", openExternal: vi.fn() }}>
      <ImagePageViewer source={{ key: "comic", pageCount: 213, loadPage: loader }} page={1} onRenderSuccess={onReady} />
    </ReaderHostProvider>);
    await waitFor(() => expect(screen.getByAltText("Page 100")).toBeTruthy());
    expect(loader.mock.calls.length).toBeLessThan(10);
    fireEvent.load(screen.getByAltText("Page 100"));
    expect(onReady).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes((URL.createObjectURL as any).mock.calls.length);
    expect(positions.readPdf("comic")?.page).toBe(100);
  });
  it("aborts in-flight requests and never retains a late result after unmount", async () => {
    const signals: AbortSignal[] = [];
    let release!: (value: ImagePage) => void;
    const loader = vi.fn((_page, signal) => { signals.push(signal); return new Promise<ImagePage>(resolve => {release = resolve;}); });
    const positions = createMemoryPositionStore();
    const view = render(<ReaderHostProvider value={{positions, colorScheme: "light", openExternal: vi.fn()}}>
      <ImagePageViewer source={{ key: "comic", pageCount: 213, loadPage: loader }} page={1} />
    </ReaderHostProvider>);
    view.unmount();
    expect(signals.every(signal => signal.aborted)).toBe(true);
    await act(async () => release(result()));
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
});

describe("image navigation", () => {
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => "blob:page"); URL.revokeObjectURL = vi.fn();
  });
  it("places an initial search target in page coordinates after lazy dimensions arrive", async () => {
    const positions = createMemoryPositionStore();
    positions.savePdf("comic", {page: 100, offsetRatio: 0.5, horizontalRatio: 0.5, zoom: 1});
    const view = render(<ReaderHostProvider value={{positions, colorScheme: "light", openExternal: vi.fn()}}>
      <ImagePageViewer source={{key: "comic", pageCount: 213, loadPage: async () => result()}} page={1} highlight_bbox={{x: 0, y: 70, width: 10, height: 10}} />
    </ReaderHostProvider>);
    await waitFor(() => expect(screen.getByAltText("Page 1")).toBeTruthy());
    view.unmount();
    expect(positions.readPdf("comic")).toMatchObject({page: 1, offsetRatio: 0.5});
  });
  it("releases old images and restores each document's own position on a source change", async () => {
    const positions = createMemoryPositionStore();
    const host = {positions, colorScheme: "light" as const, openExternal: vi.fn()};
    const loadPage = vi.fn(async () => result());
    const view = render(<ReaderHostProvider value={host}><ImagePageViewer source={{key: "first", pageCount: 213, loadPage}} page={1} /></ReaderHostProvider>);
    await waitFor(() => expect(screen.getByAltText("Page 1")).toBeTruthy());
    positions.savePdf("second", {page: 100, offsetRatio: 0, horizontalRatio: 0.5, zoom: 1.5});
    view.rerender(<ReaderHostProvider value={host}><ImagePageViewer source={{key: "second", pageCount: 213, loadPage}} page={1} /></ReaderHostProvider>);
    await waitFor(() => expect(screen.getByAltText("Page 100")).toBeTruthy());
    expect(URL.revokeObjectURL).toHaveBeenCalled();
    expect(screen.getByText("150%")).toBeTruthy();
  });
});

it("keeps a bounded set of image URLs through distant jumps and return navigation", async () => {
  let id = 0;
  URL.createObjectURL = vi.fn(() => `blob:jump-${++id}`);
  URL.revokeObjectURL = vi.fn();
  const positions = createMemoryPositionStore();
  const loader = vi.fn(async () => result());
  const view = render(<ReaderHostProvider value={{positions, colorScheme: "light", openExternal: vi.fn()}}>
    <ImagePageViewer source={{key: "comic", pageCount: 213, loadPage: loader}} page={1} />
  </ReaderHostProvider>);
  await waitFor(() => expect(screen.getByAltText("Page 1")).toBeTruthy());
  for (const page of [100, 213, 1]) {
    // The host moves the reader by changing `page`; the reader has no controls of its own for it.
    view.rerender(<ReaderHostProvider value={{positions, colorScheme: "light", openExternal: vi.fn()}}>
      <ImagePageViewer source={{key: "comic", pageCount: 213, loadPage: loader}} page={page} />
    </ReaderHostProvider>);
    // jsdom does not dispatch native scroll events for a scrollTop assignment.
    fireEvent.scroll(view.container.querySelector(".overflow-auto")!);
    await waitFor(() => expect(screen.getByAltText(`Page ${page}`)).toBeTruthy());
    const held = (URL.createObjectURL as any).mock.calls.length - (URL.revokeObjectURL as any).mock.calls.length;
    expect(held).toBeLessThanOrEqual(4);
  }
  expect(loader.mock.calls.length).toBeLessThan(20);
});

describe("image reader controls", () => {
  it("offers only the page indicator and zoom of the shared toolbar, with stepped zoom that does not drift", async () => {
    URL.createObjectURL = vi.fn(() => "blob:page");
    URL.revokeObjectURL = vi.fn();
    const positions = createMemoryPositionStore();
    render(<ReaderHostProvider value={{ positions, colorScheme: "light", openExternal: vi.fn() }}>
      <ImagePageViewer source={{ key: "comic", pageCount: 3, loadPage: async () => result() }} page={1} />
    </ReaderHostProvider>);
    expect(screen.getByText("1/3")).toBeTruthy();
    expect(screen.queryByLabelText("Page number")).toBeNull();
    expect(screen.queryByLabelText("Next page")).toBeNull();
    for (let i = 0; i < 3; i++) fireEvent.click(screen.getByLabelText("Zoom in"));
    expect(screen.getByText("130%")).toBeTruthy();
  });
});

describe("image reader page failures", () => {
  beforeEach(() => {
    let id = 0;
    URL.createObjectURL = vi.fn(() => `blob:fail-${++id}`);
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  const mount = (loader: (page: number) => Promise<ImagePage>, onRenderSuccess = vi.fn()) =>
    render(<ReaderHostProvider value={{ positions: createMemoryPositionStore(), colorScheme: "light", openExternal: vi.fn() }}>
      <ImagePageViewer source={{ key: "comic", pageCount: 3, loadPage: loader }} page={1} onRenderSuccess={onRenderSuccess} />
    </ReaderHostProvider>);

  it("reports a page that cannot be loaded in its own slot and keeps the others", async () => {
    const onRenderSuccess = vi.fn();
    mount(async page => { if (page === 1) throw new Error("not an image"); return result(); }, onRenderSuccess);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Could not load page 1"));
    await waitFor(() => expect(screen.getByAltText("Page 2")).toBeTruthy());
    // The failed slot is settled: the host's loading state must not wait on it.
    expect(onRenderSuccess).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalled();
  });

  it("reports a page whose image cannot be decoded in its own slot", async () => {
    mount(async () => result());
    await waitFor(() => expect(screen.getByAltText("Page 1")).toBeTruthy());
    fireEvent.error(screen.getByAltText("Page 1"));
    expect(screen.getByRole("alert").textContent).toBe("Could not load page 1");
    expect(screen.getByAltText("Page 2")).toBeTruthy();
  });
});

describe("image reader dark mode", () => {
  const mountWith = (colorScheme: "light" | "dark") => {
    URL.createObjectURL = vi.fn(() => "blob:dark");
    URL.revokeObjectURL = vi.fn();
    return render(<ReaderHostProvider value={{ positions: createMemoryPositionStore(), colorScheme, openExternal: vi.fn() }}>
      <ImagePageViewer source={{ key: "comic", pageCount: 2, loadPage: async () => result() }} page={1} />
    </ReaderHostProvider>);
  };
  it("marks its scroller and page slots for the dark-mode inversion the PDF reader uses", async () => {
    const view = mountWith("dark");
    await waitFor(() => expect(screen.getByAltText("Page 1")).toBeTruthy());
    const scroller = view.container.querySelector(".overflow-auto")!;
    expect(scroller.classList.contains("pdf-dark-mode")).toBe(true);
    // The stylesheet selects `.pdf-page > img`, so the image must be a direct child of the slot.
    expect(screen.getByAltText("Page 1").parentElement!.classList.contains("pdf-page")).toBe(true);
  });
  it("leaves pages alone in light mode", async () => {
    const view = mountWith("light");
    await waitFor(() => expect(screen.getByAltText("Page 1")).toBeTruthy());
    expect(view.container.querySelector(".pdf-dark-mode")).toBeNull();
  });
});
