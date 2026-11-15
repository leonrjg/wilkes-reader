import { describe, expect, it } from "vitest";
import type { LiveFont } from "./hostFonts.js";
import { ownFaceOf } from "./ownFaces.js";
import { readCharacterMap, withTable, writeCharacterMap } from "./sfnt.js";
import { runsByFont } from "./typeset.js";

/** A font as pdf.js builds one: its character map keyed by the codes pdf.js
 *  gave the glyphs, here moved up into the private use area. */
function builtFont(byFontCode: Map<number, number>): Uint8Array {
  const empty = new Uint8Array([0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  return withTable(withTable(empty, "head", new Uint8Array(54)), "cmap", writeCharacterMap(byFontCode));
}

describe("ownFaceOf", () => {
  it("maps each character to the glyph its code draws", () => {
    // Codes 1 and 2 of a TeX-like font are "x" and a comma; pdf.js moved them
    // to 0xE001 and 0xE002 in the font it built, drawn by glyphs 5 and 6.
    const face = ownFaceOf({
      data: builtFont(new Map([[0xe001, 5], [0xe002, 6], [0xe003, 7]])),
      toUnicode: { _map: Object.assign([], { 1: "x", 2: ",", 3: "fi" }) },
      toFontChar: Object.assign([], { 1: 0xe001, 2: 0xe002, 3: 0xe003 }),
    });
    expect(face).not.toBeNull();
    // The ligature stands for two letters, which find their own glyphs.
    expect(readCharacterMap(face!.data)).toEqual(new Map([[0x78, 5], [0x2c, 6]]));
    expect([...face!.covers].sort((a, b) => a - b)).toEqual([0x2c, 0x78]);
  });

  it("gives no glyph to a code pdf.js gave none, though its number is a character the font has", () => {
    // Prince numbers a subset's characters its own way: here the space is
    // code 79 and was never drawn, so it has no glyph. The built font also
    // maps the character "O" (U+004F, 79) to its glyph, for copying text out.
    const face = ownFaceOf({
      data: builtFont(new Map([[0xe001, 5], [0x4f, 5]])),
      toUnicode: { _map: Object.assign([], { 1: "O", 79: " " }) },
      toFontChar: Object.assign([], { 1: 0xe001 }),
    });
    expect([...face!.covers]).toEqual([0x4f]);
  });

  it("takes a code as its own character when the file says every one is", () => {
    const face = ownFaceOf({
      data: builtFont(new Map([[0x41, 3], [0x42, 4]])),
      toUnicode: { firstChar: 0x41, lastChar: 0x42 },
    });
    expect(readCharacterMap(face!.data)).toEqual(new Map([[0x41, 3], [0x42, 4]]));
  });

  it("knows how wide the font's space is from the code it says is one", () => {
    const face = ownFaceOf({
      data: builtFont(new Map([[0x41, 3]])),
      toUnicode: { _map: Object.assign([], { 3: " ", 0x41: "A" }) },
      widths: Object.assign([], { 3: 250, 0x41: 600 }),
    });
    expect(face!.space).toBe(0.25);
  });

  it("takes no space's width from code 32 where the font says code 32 is something else", () => {
    // A CID font numbers its glyphs as it likes: LM Roman's 32 is an asterisk
    // half an em wide, and the font has no space at all.
    const face = ownFaceOf({
      data: builtFont(new Map([[0x20, 3], [0x41, 4]])),
      toUnicode: { _map: Object.assign([], { 0x20: "*", 0x41: "A" }) },
      widths: Object.assign([], { 0x20: 500, 0x41: 600 }),
    });
    expect(face!.space).toBeUndefined();
  });

  it("makes nothing of a font with no file", () => {
    expect(ownFaceOf({ data: null, toUnicode: { firstChar: 0, lastChar: 1 } })).toBeNull();
  });

  it("leaves out a character whose glyph takes no room, or that the document never set", () => {
    // Glyph 1 is a letter 0.5 em wide; glyph 2 has no width, as the "space"
    // pdf.js gives a TeX font; glyph 3 is a combining accent, which is meant
    // to take no room.
    const metrics = (advances: number[]) => {
      const head = new Uint8Array(54);
      new DataView(head.buffer).setUint16(18, 1000);
      const hhea = new Uint8Array(36);
      new DataView(hhea.buffer).setUint16(34, advances.length);
      const hmtx = new Uint8Array(advances.length * 4);
      advances.forEach((advance, glyph) => new DataView(hmtx.buffer).setUint16(glyph * 4, advance));
      return { head, hhea, hmtx };
    };
    const { head, hhea, hmtx } = metrics([0, 500, 0, 0, 600]);
    let data = new Uint8Array([0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    data = withTable(data, "head", head);
    data = withTable(data, "hhea", hhea);
    data = withTable(data, "hmtx", hmtx);
    data = withTable(data, "cmap", writeCharacterMap(new Map([[0x61, 1], [0x20, 2], [0x301, 3], [0x62, 4]])));
    const face = ownFaceOf({
      data,
      toUnicode: { _map: Object.assign([], { 0x61: "a", 0x20: " ", 0x301: "́", 0x62: "b" }) },
      // "b" is in the font, but the document gives its code no width: it
      // never set one.
      widths: Object.assign([], { 0x61: 500, 0x62: 0 }),
    });
    expect([...face!.covers].sort((a, b) => a - b)).toEqual([0x61, 0x301]);
  });
});

describe("runsByFont", () => {
  const font = (id: string, characters: string): LiveFont => ({
    id,
    family: id,
    covers: new Set([...characters].map((character) => character.codePointAt(0)!)),
  });

  it("puts each character in the first font that has it", () => {
    const own = font("own", "abc");
    const whole = font("whole", "abcxyz");
    expect(runsByFont("abxcz", 0, 5, [own, whole]).map(([from, to, which]) => [from, to, which.id])).toEqual([
      [0, 2, "own"],
      [2, 3, "whole"],
      [3, 4, "own"],
      [4, 5, "whole"],
    ]);
  });

  it("leaves a character no font has to the last of them", () => {
    const own = font("own", "a");
    expect(runsByFont("a∧", 0, 2, [own, font("whole", "a")]).map(([, , which]) => which.id)).toEqual([
      "own",
      "whole",
    ]);
  });
});
