import { afterEach, describe, expect, it, vi } from "vitest";
import { PARAGRAPH_HOST } from "./caretTravel.js";
import { attachEditInput, type ParagraphHandle } from "./editInput.js";
import type { Paragraph } from "./paragraphs.js";
import type { PdfEditSession } from "./usePdfEditSession.js";

function host(text: string): HTMLElement {
  const element = document.createElement("div");
  element.setAttribute(PARAGRAPH_HOST, "");
  element.textContent = text;
  return element;
}

function handleOf(element: HTMLElement): ParagraphHandle {
  const paragraph = { text: element.textContent ?? "" } as Paragraph;
  return {
    element,
    slot: () => ({ paragraph, edit: null }),
    offsetOf: () => 0,
    runs: () => [{ text: paragraph.text, style: 0 }],
  };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("attachEditInput", () => {
  it("passes over a paragraph whose element has already left the document", () => {
    // WebKit puts the editor's own typing through `beforeinput`, and that can
    // come while a paragraph's element is gone but not yet withdrawn.
    const layer = document.createElement("div");
    const shown = host("shown");
    layer.append(shown);
    document.body.append(layer);
    const gone = host("gone");
    const handles = new Map([shown, gone].map((element) => [element, handleOf(element)]));
    const beginEdit = vi.fn();
    const detach = attachEditInput(layer, () => ({ beginEdit }) as unknown as PdfEditSession, handles);
    const failures: unknown[] = [];
    const onError = (event: ErrorEvent) => failures.push(event.error);
    window.addEventListener("error", onError);

    // Between paragraphs rather than in one, which is where every paragraph
    // on screen is looked at to see which side of it the caret is.
    window.getSelection()?.collapse(layer, 0);
    const input = new InputEvent("beforeinput", { inputType: "insertText", data: "x", cancelable: true });
    layer.dispatchEvent(input);

    window.removeEventListener("error", onError);
    detach();
    expect(failures).toEqual([]);
    // Not in the text, so nothing is typed.
    expect(input.defaultPrevented).toBe(true);
    expect(beginEdit).not.toHaveBeenCalled();
  });

  it("hands a keystroke in a paragraph of the page to the session", () => {
    const layer = document.createElement("div");
    const shown = host("shown");
    layer.append(shown);
    document.body.append(layer);
    const beginEdit = vi.fn();
    const detach = attachEditInput(
      layer,
      () => ({ beginEdit }) as unknown as PdfEditSession,
      new Map([[shown, handleOf(shown)]]),
    );

    window.getSelection()?.collapse(shown.firstChild!, 2);
    const input = new InputEvent("beforeinput", { inputType: "insertText", data: "x", cancelable: true });
    // jsdom has no target ranges; the selection is what the keystroke covers.
    Object.assign(input, { getTargetRanges: () => [] });
    layer.dispatchEvent(input);

    detach();
    expect(input.defaultPrevented).toBe(true);
    expect(beginEdit).toHaveBeenCalledWith(
      expect.objectContaining({ text: "shown" }),
      expect.objectContaining({ input: { kind: "insert", text: "x" } }),
    );
  });
});
