import { afterEach, describe, expect, it } from "vitest";
import { caretRect, lineRects } from "./editableText.js";

// jsdom lays nothing out: an element's box is stubbed, and a caret reports no
// box, as the browser's does in an empty line.
function laidOut(element: HTMLElement, box: DOMRect): HTMLElement {
  element.getBoundingClientRect = () => box;
  document.body.append(element);
  return element;
}

/** Have a caret report what a caret in an empty line reports: nothing. jsdom's
 *  ranges have no boxes at all. */
function caretWithoutBox(): void {
  Object.assign(Range.prototype, {
    getClientRects: () => [],
    getBoundingClientRect: () => new DOMRect(0, 0, 0, 0),
  });
}

afterEach(() => {
  document.body.replaceChildren();
  const range = Range.prototype as Partial<Range>;
  delete range.getClientRects;
  delete range.getBoundingClientRect;
});

describe("an empty paragraph", () => {
  it("is one line, where its element is laid out", () => {
    const empty = laidOut(document.createElement("div"), new DOMRect(10, 20, 300, 18));
    expect(lineRects(empty)).toEqual([new DOMRect(10, 20, 300, 18)]);
  });

  it("is no line while it is not laid out", () => {
    const empty = laidOut(document.createElement("div"), new DOMRect(0, 0, 0, 0));
    expect(lineRects(empty)).toEqual([]);
  });

  it("has its caret at the start of that line", () => {
    const empty = laidOut(document.createElement("div"), new DOMRect(10, 20, 300, 18));
    caretWithoutBox();
    window.getSelection()?.collapse(empty, 0);
    expect(caretRect(empty)).toEqual(new DOMRect(10, 20, 0, 18));
  });

  it("does not stand in for the caret of a paragraph with text", () => {
    const paragraph = laidOut(document.createElement("div"), new DOMRect(10, 20, 300, 18));
    paragraph.textContent = "words";
    caretWithoutBox();
    window.getSelection()?.collapse(paragraph.firstChild!, 2);
    expect(caretRect(paragraph)).toBeNull();
  });
});
