import { describe, expect, it, vi } from "vitest";
import { createMemoryPdfEditStore, usableEdits, type DraftEdit, type PdfEditDraft } from "./editStore.js";

const paragraph = {
  page: 2,
  itemIds: ["2:0:0:3"],
  area: { x: 50, y: 100, width: 200, height: 30 },
  text: "Some words.",
  runs: [{ text: "Some words.", style: 0 }],
  styles: [{ fontName: "f1", fontSize: 10, color: "black", rise: 0 }],
  baseStyle: 0,
  lineCount: 1,
  firstBaseline: 108,
  lastBaseline: 108,
  lineHeight: 12,
  inset: 0,
  width: 200,
  indent: 0,
  fontName: "f1",
  fontSize: 10,
  color: "black",
  align: "left" as const,
  lines: [],
};
const edit: DraftEdit = { paragraph, runs: [{ text: "Other words.", style: 0 }], absorbed: [] };

describe("usableEdits", () => {
  it("lets go of a draft whose edits meant something else when it was written", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    // Version 1 named fonts by what pdf.js called them at the time.
    expect(usableEdits({ version: 1, edits: [edit] } as unknown as PdfEditDraft)).toEqual([]);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("takes up a draft this version wrote", () => {
    expect(usableEdits({ version: 2, edits: [edit] })).toEqual([edit]);
    expect(usableEdits(null)).toEqual([]);
  });

  it("lets go of an edit that lacks what laying it out needs, and says so", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { area: _area, ...withoutArea } = paragraph;
    const older = { paragraph: withoutArea, runs: edit.runs } as unknown as DraftEdit;
    expect(usableEdits({ version: 2, edits: [older, edit] })).toEqual([edit]);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

describe("usableEdits for paragraphs the reader made", () => {
  it("takes up one that names the edit it follows", () => {
    const made: DraftEdit = { paragraph: { ...paragraph, itemIds: [] }, runs: [], after: 0, structural: true, absorbed: [] };
    expect(usableEdits({ version: 2, edits: [edit, made] })).toEqual([edit, made]);
  });

  it("lets go of one with nothing on the page and nothing to follow", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const adrift: DraftEdit = { paragraph: { ...paragraph, itemIds: [] }, runs: [], absorbed: [] };
    expect(usableEdits({ version: 2, edits: [adrift] })).toEqual([]);
    warn.mockRestore();
  });
});

describe("createMemoryPdfEditStore", () => {
  it("keeps a draft by document and forgets it when there is none", () => {
    const store = createMemoryPdfEditStore();
    store.save("a.pdf", { version: 2, edits: [edit] });
    expect(store.read("a.pdf")?.edits).toEqual([edit]);
    expect(store.read("b.pdf")).toBeNull();
    store.save("a.pdf", null);
    expect(store.read("a.pdf")).toBeNull();
  });
});
