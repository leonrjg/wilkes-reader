import { describe, expect, it } from "vitest";
import { steppedPage } from "./readerShortcuts.js";

describe("steppedPage", () => {
  const at = (page: number, offsetRatio: number) => ({ page, offsetRatio });

  it("goes forward to the next page's top", () => {
    expect(steppedPage(at(3, 0), 1, 10)).toBe(4);
    expect(steppedPage(at(3, 0.6), 1, 10)).toBe(4);
  });

  it("goes back to the current page's top when part-way down it", () => {
    expect(steppedPage(at(3, 0.6), -1, 10)).toBe(3);
  });

  it("goes back to the previous page when already at the top", () => {
    expect(steppedPage(at(3, 0), -1, 10)).toBe(2);
    expect(steppedPage(at(3, 0.004), -1, 10)).toBe(2);
  });

  it("reads the foot of a page as the next page's top", () => {
    expect(steppedPage(at(2, 0.996), 1, 10)).toBe(4);
    expect(steppedPage(at(2, 0.996), -1, 10)).toBe(2);
  });

  it("stays within the document", () => {
    expect(steppedPage(at(1, 0), -1, 10)).toBe(1);
    expect(steppedPage(at(10, 0.5), 1, 10)).toBe(10);
  });
});
