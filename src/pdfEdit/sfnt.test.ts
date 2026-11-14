import { describe, expect, it } from "vitest";
import { readCharacterMap, readTables, withTable, writeCharacterMap } from "./sfnt.js";

/** A font file of the given tables, put together by hand. */
function fontOf(tables: Record<string, Uint8Array>): Uint8Array {
  const placeholder = new Uint8Array([0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  let font = placeholder;
  for (const [tag, data] of Object.entries(tables)) font = withTable(font, tag, data);
  return font;
}

describe("character maps", () => {
  it("read back what was written, past the basic plane too", () => {
    const map = new Map([
      [0x41, 3],
      [0x42, 4],
      [0x43, 5],
      [0x61, 9],
      [0x2227, 40],
      [0x1d44e, 77],
    ]);
    const font = fontOf({ cmap: writeCharacterMap(map), head: new Uint8Array(54) });
    expect(readCharacterMap(font)).toEqual(map);
  });

  it("give a font a new map and keep its other tables as they were", () => {
    const glyf = new Uint8Array([1, 2, 3, 4, 5]);
    const font = fontOf({ glyf, head: new Uint8Array(54), cmap: writeCharacterMap(new Map([[0x41, 1]])) });
    const remapped = withTable(font, "cmap", writeCharacterMap(new Map([[0x5a, 1]])));
    expect(readCharacterMap(remapped)).toEqual(new Map([[0x5a, 1]]));
    expect([...readTables(remapped).find((table) => table.tag === "glyf")!.data]).toEqual([...glyf]);
    expect(readTables(remapped).map((table) => table.tag)).toEqual(["cmap", "glyf", "head"]);
  });

  it("make a file whose checksum comes out as the format asks", () => {
    const font = fontOf({ head: new Uint8Array(54), cmap: writeCharacterMap(new Map([[0x41, 1]])) });
    const data = new DataView(font.buffer);
    let sum = 0;
    for (let at = 0; at < font.byteLength; at += 4) sum = (sum + data.getUint32(at)) >>> 0;
    expect(sum).toBe(0xb1b0afba);
  });
});
