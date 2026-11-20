import { afterEach, describe, expect, it, vi } from "vitest";

const SAFARI_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

describe("attachWebkitMarginSelection", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    document.body.innerHTML = "";
  });

  it("focuses the reader when it takes over a margin click", async () => {
    vi.stubGlobal("navigator", { ...navigator, userAgent: SAFARI_UA });
    const { attachWebkitMarginSelection } = await import("./pdfWebkitSelection.js");

    document.body.innerHTML = `
      <div id="reader" tabindex="0"><div class="textLayer"><span>Text</span></div></div>
      <input id="elsewhere" />`;
    const textLayer = document.querySelector<HTMLElement>(".textLayer")!;
    document.getElementById("elsewhere")!.focus();
    const detach = attachWebkitMarginSelection(textLayer);

    const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 });
    textLayer.dispatchEvent(down);

    expect(down.defaultPrevented).toBe(true);
    expect(document.activeElement?.id).toBe("reader");
    detach();
  });
});
