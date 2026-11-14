import { describe, expect, it } from "vitest";
import { layoutFragments } from "./fragmentFloats.js";

const LINE = 20;
const WIDTH = 200;

describe("layoutFragments", () => {
  it("sets a paragraph in one place with a single spacer", () => {
    const layout = layoutFragments([{ left: 50, top: 100, lines: 3 }], LINE, WIDTH);
    expect(layout).toMatchObject({ left: 50, top: 100, width: WIDTH, columns: 1 });
    expect(layout.floats).toEqual([{ side: "left", width: 0, height: 60.5, clear: true }]);
  });

  it("skips from the foot of one page to the head of the next with a gap", () => {
    const layout = layoutFragments(
      [
        { left: 50, top: 100, lines: 2 },
        { left: 50, top: 400, lines: 3 },
      ],
      LINE,
      WIDTH,
    );
    expect(layout.columns).toBe(1);
    expect(layout.floats).toEqual([
      { side: "left", width: 0, height: 40.5, clear: true },
      { side: "left", width: "100%", height: 259.5, clear: true },
      { side: "left", width: 0, height: 60.5, clear: true },
    ]);
  });

  it("opens a column for a fragment that starts higher than the last ended", () => {
    // The foot of a left column, then the head of the right one.
    const layout = layoutFragments(
      [
        { left: 50, top: 400, lines: 2 },
        { left: 300, top: 100, lines: 3 },
      ],
      LINE,
      WIDTH,
    );
    expect(layout).toMatchObject({ left: 48, top: 100, width: 452, columns: 2 });
    expect(layout.floats).toEqual([
      // Down to the first fragment, which sits two pixels in and leaves the
      // right-hand column's width beside it.
      { side: "left", width: "100%", height: 300, clear: true },
      { side: "left", width: 2, height: 40.5, clear: true },
      { side: "right", width: 250, height: 40.5, clear: false },
      // The rest of the first column, to just short of its foot.
      { side: "left", width: "100%", height: layout.columnHeight - 340.5 - 0.5, clear: true },
      // The second column starts one pixel further right, which is then to
      // spare on the other side.
      { side: "left", width: 251, height: 60.5, clear: true },
      { side: "right", width: 1, height: 60.5, clear: false },
    ]);
  });

  it("goes on down inside a column it opened", () => {
    const layout = layoutFragments(
      [
        { left: 50, top: 400, lines: 2 },
        { left: 300, top: 100, lines: 17 },
        { left: 50, top: 600, lines: 1 },
      ],
      LINE,
      WIDTH,
    );
    expect(layout.columns).toBe(2);
    const last = layout.floats.slice(-3);
    expect(last[0]).toEqual({ side: "left", width: "100%", height: 600 - 100 - 340.5, clear: true });
    expect(last[1]).toMatchObject({ side: "left", width: 1 });
    expect(last[2]).toMatchObject({ side: "right", width: 251 });
  });
});
