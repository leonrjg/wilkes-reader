import { describe, expect, it } from "vitest";
import { OPS } from "../pdfjs.js";
import { characterSpacing, inkColour } from "./pdfPageSource.js";

type Rgb = [number, number, number];

/** A 4×2 raster of one colour, with some of its pixels painted. */
function raster(ground: Rgb, painted: Array<[x: number, y: number, colour: Rgb]> = []) {
  const width = 4;
  const height = 2;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < data.length; offset += 4) data.set([...ground, 255], offset);
  for (const [x, y, colour] of painted) data.set([...colour, 255], (y * width + x) * 4);
  return { data, width, height };
}

const all = { x: 0, y: 0, width: 4, height: 2 };
const WHITE: Rgb = [255, 255, 255];
const GREEN: Rgb = [12, 138, 108];

describe("inkColour", () => {
  it("is the colour of a stroke's middle, not of its anti-aliased edge", () => {
    const page = raster(WHITE, [[1, 0, [128, 128, 128]], [2, 0, [0, 0, 0]]]);
    expect(inkColour(page, raster(WHITE), all)).toBe("rgb(0, 0, 0)");
  });

  it("is white for white text on a darker ground, not the ground", () => {
    const page = raster(GREEN, [[1, 0, [140, 200, 185]], [2, 0, WHITE]]);
    expect(inkColour(page, raster(GREEN), all)).toBe("rgb(255, 255, 255)");
  });

  it("is the text's own colour on a tint that sits behind only part of the run", () => {
    const yellow: Rgb = [250, 200, 40];
    const navy: Rgb = [20, 30, 90];
    const paper = raster(GREEN, [[2, 0, yellow], [3, 0, yellow], [2, 1, yellow], [3, 1, yellow]]);
    const page = raster(GREEN, [[0, 0, WHITE], [2, 0, yellow], [3, 0, navy], [2, 1, yellow], [3, 1, yellow]]);
    // The run's area here is the navy word on its yellow box.
    expect(inkColour(page, paper, { x: 2, y: 0, width: 2, height: 2 })).toBe("rgb(20, 30, 90)");
  });

  it("is the darkest thing under text that drew nothing, as an OCR layer over a scan", () => {
    const scan = raster([240, 238, 230], [[1, 1, [40, 40, 40]], [2, 1, [90, 90, 90]]]);
    expect(inkColour(scan, scan, all)).toBe("rgb(40, 40, 40)");
  });
});

describe("characterSpacing", () => {
  const glyphs = (text: string) => [...text].map((unicode) => ({ unicode }));
  /** Operations as pdf.js lists them: one code and one argument list each. */
  const operations = (...steps: Array<[number, unknown[]]>) => ({
    fnArray: steps.map(([code]) => code),
    argsArray: steps.map(([, args]) => args),
  });

  it("is the file's spacing in ems of the font, until it is set again or restored", () => {
    const spacingOf = characterSpacing(
      operations(
        [OPS.save, []],
        [OPS.setFont, ["f1", 1]],
        [OPS.setCharSpacing, [-0.05]],
        // A headline set at size 1 and scaled by its matrix: Tc is in ems.
        [OPS.showText, [[...glyphs("Study where"), 18, ...glyphs(" you")]]],
        [OPS.restore, []],
        [OPS.setFont, ["f2", 10]],
        [OPS.showText, [glyphs("Body text.")]],
        [OPS.setCharSpacing, [0.5]],
        [OPS.setHScale, [80]],
        [OPS.showText, [glyphs("Loose")]],
      ),
    );
    expect(spacingOf("Study where you")).toBe(-0.05);
    expect(spacingOf("Body text.")).toBe(0);
    // 0.5 at size 10, scaled to 80%: 0.04 of an em.
    expect(spacingOf("Loose")).toBeCloseTo(0.04);
    expect(spacingOf.unread).toBe(0);
  });

  it("finds text the text layer gives with spaces of its own and ligatures apart", () => {
    const spacingOf = characterSpacing(
      operations([OPS.setFont, ["f1", 1]], [OPS.setCharSpacing, [-0.02]], [OPS.showText, [glyphs("\uFB01ne print")]]),
    );
    expect(spacingOf("fine  print")).toBe(-0.02);
  });

  it("counts text it cannot find among the glyphs, and sets it with none", () => {
    const spacingOf = characterSpacing(
      operations([OPS.setFont, ["f1", 1]], [OPS.setCharSpacing, [-0.05]], [OPS.showText, [glyphs("drawn")]]),
    );
    expect(spacingOf("replaced")).toBe(0);
    expect(spacingOf.unread).toBe(1);
    // And what comes after it is still found.
    expect(spacingOf("drawn")).toBe(-0.05);
  });
});
