import { beforeEach, describe, expect, it } from "vitest";
import { substitutePageText, type TextSubstitution } from "./pdfTextSubstitution.js";

/**
 * The rules are arithmetic on the inline styles pdf.js writes, which is what
 * makes them testable at all: jsdom has no layout, so anything measured with
 * `getBoundingClientRect` would read zero here and could only be checked by
 * hand in a browser.
 *
 * Two behaviours in this module deliberately have no test and cannot have one
 * under jsdom: `user-select: all` (asserted as a property below, but its effect
 * on a drag is the engine's) and `--scale-x`, which needs canvas text metrics.
 * Both are verified in the running application.
 */

const PAGE_WIDTH = 600;
const PAGE_HEIGHT = 800;

let container: HTMLElement;

beforeEach(() => {
  container = document.createElement("div");
  container.className = "textLayer";
  document.body.replaceChildren(container);
});

/** A span shaped exactly as `TextLayer.#appendText` writes one: percentage
 *  offsets into the page and a `--font-height` in the page's own units. */
function appendSpan(text: string, x: number, y: number, fontHeight = 10): HTMLElement {
  const span = document.createElement("span");
  span.textContent = text;
  span.style.left = `${((100 * x) / PAGE_WIDTH).toFixed(2)}%`;
  span.style.top = `${((100 * y) / PAGE_HEIGHT).toFixed(2)}%`;
  span.style.setProperty("--font-height", `${fontHeight.toFixed(2)}px`);
  container.append(span);
  return span;
}

function appendBreak(): HTMLElement {
  const br = document.createElement("br");
  container.append(br);
  return br;
}

function formulaAt(text: string, x: number, y: number, width = 200, height = 20): TextSubstitution {
  return { page: 1, bbox: { x, y, width, height }, text };
}

function substitute(...substitutions: TextSubstitution[]): void {
  substitutePageText(container, substitutions, PAGE_WIDTH, PAGE_HEIGHT);
}

describe("substitutePageText", () => {
  it("puts the reading's account where the page's glyph run was", () => {
    appendSpan("prose above", 50, 100);
    appendSpan("yB = wxB mod q", 100, 200);
    appendSpan("prose below", 50, 300);

    substitute(formulaAt("y_{B} = w^{x_{B}} \\bmod q", 90, 195));

    // In place: the reading's order is the page's, and a formula between two
    // paragraphs must be copied between them.
    expect(container.textContent).toBe(
      "prose abovey_{B} = w^{x_{B}} \\bmod qprose below",
    );
    expect(container.querySelectorAll("[data-substituted]")).toHaveLength(1);
  });

  it("leaves every run outside the area exactly where it was", () => {
    const above = appendSpan("prose above", 50, 100);
    appendSpan("yB = wxB mod q", 100, 200);
    const below = appendSpan("prose below", 50, 300);

    substitute(formulaAt("\\alpha", 90, 195));

    expect(above.isConnected).toBe(true);
    expect(below.isConnected).toBe(true);
  });

  it("claims every run of a multi-line area", () => {
    appendSpan("first line of the formula", 100, 200);
    appendSpan("second line of the formula", 100, 215);

    substitute(formulaAt("\\begin{aligned}x&=1\\\\y&=2\\end{aligned}", 90, 195, 200, 40));

    expect(container.textContent).toBe("\\begin{aligned}x&=1\\\\y&=2\\end{aligned}");
  });

  it("drops the area's own line breaks and keeps a neighbour's", () => {
    appendSpan("first line of the formula", 100, 200);
    const inner = appendBreak();
    appendSpan("second line of the formula", 100, 215);
    const edge = appendBreak();
    appendSpan("prose below", 50, 300);

    substitute(formulaAt("x = 1", 90, 195, 200, 40));

    // The break between two removed runs was the area's; the one between the
    // area and surviving prose still separates two lines that remain.
    expect(inner.isConnected).toBe(false);
    expect(edge.isConnected).toBe(true);
  });

  it("inserts nothing where no glyph run is superseded", () => {
    appendSpan("a caption under a figure", 50, 500);

    // A picture: the page draws pixels there, and there is no competing claim
    // to settle. Adding text over it would be a different feature.
    substitute(formulaAt("read out of the picture", 100, 200));

    expect(container.textContent).toBe("a caption under a figure");
    expect(container.querySelector("[data-substituted]")).toBeNull();
  });

  it("gives each area its own runs and never the same run twice", () => {
    appendSpan("first formula", 100, 200);
    appendSpan("second formula", 100, 400);

    substitute(formulaAt("\\alpha", 90, 195), formulaAt("\\beta", 90, 395));

    expect(container.textContent).toBe("\\alpha\\beta");
    expect(container.querySelectorAll("[data-substituted]")).toHaveLength(2);
  });

  it("writes the geometry in pdf.js' own idiom", () => {
    appendSpan("yB = wxB mod q", 100, 200);
    substitute(formulaAt("y_{B}", 90, 190, 300, 24));

    const span = container.querySelector<HTMLElement>("[data-substituted]");
    // The CSSOM normalises the two decimals pdf.js writes; the value is what
    // matters, not its spelling.
    expect(span?.style.left).toBe("15%");
    expect(span?.style.top).toBe("23.75%");
    // Without `--font-height` the copied stylesheet computes `font-size: 0`,
    // and the area becomes an invisible span nobody can select.
    expect(span?.style.getPropertyValue("--font-height")).toBe("24.00px");
    // The area is indivisible: no offset in this string corresponds to a glyph
    // painted under it, so a partial selection could only cut arbitrarily.
    expect(span?.style.getPropertyValue("user-select")).toBe("all");
  });

  it("keeps a table's rows as one selectable run", () => {
    appendSpan("flattened table row", 100, 200);
    const table = "| a | b |\n| - | - |\n| 1 | 2 |";

    substitute(formulaAt(table, 90, 195, 200, 60));

    const span = container.querySelector<HTMLElement>("[data-substituted]");
    expect(span?.textContent).toBe(table);
    expect(span?.childNodes).toHaveLength(1);
    // One line's worth of height each, so the rows cover the area rather than
    // stacking past it.
    expect(span?.style.getPropertyValue("--font-height")).toBe("20.00px");
  });

  it("claims nothing for an area with no extent", () => {
    const span = appendSpan("yB = wxB mod q", 100, 200);

    substitute(formulaAt("y_{B}", 100, 200, 0, 0));

    expect(span.isConnected).toBe(true);
    expect(container.querySelector("[data-substituted]")).toBeNull();
  });
});
