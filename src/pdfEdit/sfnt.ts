/**
 * Just enough of the OpenType file format to give a font a new character map.
 *
 * A font file is a directory of tables. The one that says which glyph draws
 * which character is `cmap`; everything else -- outlines, advances, names --
 * is copied through untouched. See `ownFaces` for why a font needs a new one.
 */

/** One table of a font file, by its four-letter tag. */
interface Table {
  tag: string;
  data: Uint8Array;
}

const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

/** The tables of a font file, in the order its directory lists them. */
export function readTables(font: Uint8Array): Table[] {
  const data = view(font);
  if (font.byteLength < 12) throw new Error("font file: too short for a table directory");
  const count = data.getUint16(4);
  const tables: Table[] = [];
  for (let index = 0; index < count; index++) {
    const record = 12 + index * 16;
    if (record + 16 > font.byteLength) throw new Error("font file: the table directory runs past its end");
    const tag = String.fromCharCode(...font.subarray(record, record + 4));
    const offset = data.getUint32(record + 8);
    const length = data.getUint32(record + 12);
    if (offset + length > font.byteLength) throw new Error(`font file: table ${tag} runs past its end`);
    tables.push({ tag, data: font.subarray(offset, offset + length) });
  }
  return tables;
}

/** A font file with one table replaced, or added if it had none. */
export function withTable(font: Uint8Array, tag: string, table: Uint8Array): Uint8Array {
  const tables = readTables(font).filter((existing) => existing.tag !== tag);
  tables.push({ tag, data: table });
  tables.sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
  return writeFont(font.subarray(0, 4), tables);
}

function writeFont(version: Uint8Array, tables: Table[]): Uint8Array {
  const headerLength = 12 + tables.length * 16;
  const padded = (length: number) => (length + 3) & ~3;
  const total = tables.reduce((sum, table) => sum + padded(table.data.byteLength), headerLength);
  const out = new Uint8Array(total);
  const data = view(out);
  out.set(version, 0);
  const power = 2 ** Math.floor(Math.log2(tables.length));
  data.setUint16(4, tables.length);
  data.setUint16(6, power * 16);
  data.setUint16(8, Math.log2(power));
  data.setUint16(10, tables.length * 16 - power * 16);
  let offset = headerLength;
  let headAt = -1;
  tables.forEach((table, index) => {
    const record = 12 + index * 16;
    for (let i = 0; i < 4; i++) out[record + i] = table.tag.charCodeAt(i);
    out.set(table.data, offset);
    if (table.tag === "head" && table.data.byteLength >= 12) {
      // Summed with this zeroed; set from the whole file's sum below.
      data.setUint32(offset + 8, 0);
      headAt = offset;
    }
    data.setUint32(record + 4, checksum(out.subarray(offset, offset + padded(table.data.byteLength))));
    data.setUint32(record + 8, offset);
    data.setUint32(record + 12, table.data.byteLength);
    offset += padded(table.data.byteLength);
  });
  if (headAt >= 0) data.setUint32(headAt + 8, (0xb1b0afba - checksum(out)) >>> 0);
  return out;
}

function checksum(bytes: Uint8Array): number {
  const data = view(bytes);
  let sum = 0;
  for (let at = 0; at + 4 <= bytes.byteLength; at += 4) sum = (sum + data.getUint32(at)) >>> 0;
  const rest = bytes.byteLength % 4;
  if (rest) {
    let last = 0;
    for (let i = 0; i < 4; i++) last = (last << 8) | (i < rest ? bytes[bytes.byteLength - rest + i] : 0);
    sum = (sum + (last >>> 0)) >>> 0;
  }
  return sum;
}

/** What a font's character map says: character code to glyph, for the
 *  subtable a renderer would use. */
export function readCharacterMap(font: Uint8Array): Map<number, number> {
  const table = readTables(font).find((candidate) => candidate.tag === "cmap");
  if (!table) throw new Error("font file: no character map");
  const data = view(table.data);
  const count = data.getUint16(2);
  const subtables: Array<{ platform: number; encoding: number; offset: number }> = [];
  for (let index = 0; index < count; index++) {
    const record = 4 + index * 8;
    subtables.push({
      platform: data.getUint16(record),
      encoding: data.getUint16(record + 2),
      offset: data.getUint32(record + 4),
    });
  }
  // Full Unicode, then the basic plane, then symbol fonts', then whatever is
  // there: the order a renderer looks in.
  const rank = ({ platform, encoding }: { platform: number; encoding: number }) =>
    platform === 3 && encoding === 10 ? 0 : platform === 0 ? 1 : platform === 3 && encoding === 1 ? 2 : platform === 3 ? 3 : 4;
  subtables.sort((a, b) => rank(a) - rank(b));
  for (const subtable of subtables) {
    const map = readSubtable(data, subtable.offset);
    if (map) return map;
  }
  throw new Error("font file: no character map in a format this reads");
}

function readSubtable(data: DataView, at: number): Map<number, number> | null {
  const map = new Map<number, number>();
  const format = data.getUint16(at);
  if (format === 0) {
    for (let code = 0; code < 256; code++) {
      const glyph = data.getUint8(at + 6 + code);
      if (glyph) map.set(code, glyph);
    }
    return map;
  }
  if (format === 4) {
    const segments = data.getUint16(at + 6) / 2;
    const ends = at + 14;
    const starts = ends + segments * 2 + 2;
    const deltas = starts + segments * 2;
    const rangeOffsets = deltas + segments * 2;
    for (let segment = 0; segment < segments; segment++) {
      const end = data.getUint16(ends + segment * 2);
      const start = data.getUint16(starts + segment * 2);
      const delta = data.getUint16(deltas + segment * 2);
      const rangeOffsetAt = rangeOffsets + segment * 2;
      const rangeOffset = data.getUint16(rangeOffsetAt);
      for (let code = start; code <= end && code !== 0xffff; code++) {
        let glyph: number;
        if (rangeOffset === 0) {
          glyph = (code + delta) & 0xffff;
        } else {
          const glyphAt = rangeOffsetAt + rangeOffset + (code - start) * 2;
          if (glyphAt + 2 > data.byteLength) continue;
          glyph = data.getUint16(glyphAt);
          if (glyph !== 0) glyph = (glyph + delta) & 0xffff;
        }
        if (glyph) map.set(code, glyph);
      }
    }
    return map;
  }
  if (format === 6) {
    const first = data.getUint16(at + 6);
    const count = data.getUint16(at + 8);
    for (let index = 0; index < count; index++) {
      const glyph = data.getUint16(at + 10 + index * 2);
      if (glyph) map.set(first + index, glyph);
    }
    return map;
  }
  if (format === 12) {
    const groups = data.getUint32(at + 12);
    for (let group = 0; group < groups; group++) {
      const record = at + 16 + group * 12;
      const start = data.getUint32(record);
      const end = data.getUint32(record + 4);
      const glyph = data.getUint32(record + 8);
      for (let code = start; code <= end; code++) map.set(code, glyph + (code - start));
    }
    return map;
  }
  return null;
}

/** How far each glyph of a font advances, in ems; null for a font whose
 *  metrics cannot be read. */
export function glyphAdvances(font: Uint8Array): ((glyph: number) => number) | null {
  const tables = readTables(font);
  const find = (tag: string) => tables.find((table) => table.tag === tag)?.data;
  const head = find("head");
  const hhea = find("hhea");
  const hmtx = find("hmtx");
  if (!head || !hhea || !hmtx || head.byteLength < 20 || hhea.byteLength < 36) return null;
  const unitsPerEm = view(head).getUint16(18);
  const metrics = view(hhea).getUint16(34);
  if (unitsPerEm === 0 || metrics === 0 || metrics * 4 > hmtx.byteLength) return null;
  const data = view(hmtx);
  // Glyphs past the last metric share its advance.
  return (glyph) => data.getUint16(Math.min(glyph, metrics - 1) * 4) / unitsPerEm;
}

/** How far a font's space advances, in ems, or null if it has no space. */
export function spaceAdvance(font: Uint8Array): number | null {
  const glyph = readCharacterMap(font).get(0x20);
  if (glyph === undefined) return null;
  return glyphAdvances(font)?.(glyph) ?? null;
}

/** A character map for Unicode: the basic plane in the format every renderer
 *  reads, and everything in the one that reaches past it. */
export function writeCharacterMap(map: ReadonlyMap<number, number>): Uint8Array {
  const entries = [...map].filter(([, glyph]) => glyph > 0).sort((a, b) => a[0] - b[0]);
  // Runs of consecutive characters drawn by consecutive glyphs.
  const runs: Array<{ start: number; end: number; glyph: number }> = [];
  for (const [code, glyph] of entries) {
    const last = runs[runs.length - 1];
    if (last && code === last.end + 1 && glyph === last.glyph + (code - last.start)) last.end = code;
    else runs.push({ start: code, end: code, glyph });
  }
  const basic = runs.filter((run) => run.end < 0xffff);
  const format4 = basic.length * 8 + 24 <= 0xffff ? writeFormat4(basic) : null;
  const format12 = writeFormat12(runs);

  const subtables: Array<{ platform: number; encoding: number; data: Uint8Array }> = [];
  if (format4) subtables.push({ platform: 3, encoding: 1, data: format4 });
  subtables.push({ platform: 3, encoding: 10, data: format12 });
  const header = 4 + subtables.length * 8;
  const out = new Uint8Array(header + subtables.reduce((sum, subtable) => sum + subtable.data.byteLength, 0));
  const data = view(out);
  data.setUint16(2, subtables.length);
  let offset = header;
  subtables.forEach((subtable, index) => {
    data.setUint16(4 + index * 8, subtable.platform);
    data.setUint16(6 + index * 8, subtable.encoding);
    data.setUint32(8 + index * 8, offset);
    out.set(subtable.data, offset);
    offset += subtable.data.byteLength;
  });
  return out;
}

function writeFormat4(runs: ReadonlyArray<{ start: number; end: number; glyph: number }>): Uint8Array {
  // Every run is a segment of its own, its glyphs found by adding a constant;
  // and the map must end with a segment for 0xFFFF.
  const segments = [...runs.map((run) => ({ ...run, delta: (run.glyph - run.start) & 0xffff })), { start: 0xffff, end: 0xffff, glyph: 0, delta: 1 }];
  const count = segments.length;
  const length = 16 + count * 8;
  const out = new Uint8Array(length);
  const data = view(out);
  const power = 2 ** Math.floor(Math.log2(count));
  data.setUint16(0, 4);
  data.setUint16(2, length);
  data.setUint16(6, count * 2);
  data.setUint16(8, power * 2);
  data.setUint16(10, Math.log2(power));
  data.setUint16(12, count * 2 - power * 2);
  const ends = 14;
  const starts = ends + count * 2 + 2;
  const deltas = starts + count * 2;
  segments.forEach((segment, index) => {
    data.setUint16(ends + index * 2, segment.end);
    data.setUint16(starts + index * 2, segment.start);
    data.setUint16(deltas + index * 2, segment.delta);
    // The range offsets that follow stay zero: no glyph array.
  });
  return out;
}

function writeFormat12(runs: ReadonlyArray<{ start: number; end: number; glyph: number }>): Uint8Array {
  const length = 16 + runs.length * 12;
  const out = new Uint8Array(length);
  const data = view(out);
  data.setUint16(0, 12);
  data.setUint32(4, length);
  data.setUint32(12, runs.length);
  runs.forEach((run, index) => {
    data.setUint32(16 + index * 12, run.start);
    data.setUint32(20 + index * 12, run.end);
    data.setUint32(24 + index * 12, run.glyph);
  });
  return out;
}
