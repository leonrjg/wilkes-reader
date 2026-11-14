/**
 * What a font's name says about the font.
 *
 * A PDF describes each font twice: in flags its producer set, and in the
 * PostScript name the font came with. The flags are what pdf.js reports, and
 * they are often wrong -- TeX marks every font it embeds as a symbol font and
 * nothing else, so a book set in Computer Modern or Baskerville arrives as
 * sans-serif, upright and regular throughout. The name is what the type
 * designer called the face, and where it says something it is believed first.
 */

export type GenericFamily = "serif" | "sans-serif" | "monospace";

export interface NamedFace {
  /** Absent when the name does not say. */
  generic?: GenericFamily;
  bold: boolean;
  italic: boolean;
}

interface TexFace {
  generic: GenericFamily;
  bold?: true;
  italic?: true;
}

const SERIF: TexFace = { generic: "serif" };
const SANS: TexFace = { generic: "sans-serif" };
const MONO: TexFace = { generic: "monospace" };

/** Computer Modern and its descendants name a face by a fixed code between
 *  the family's prefix and the design size: `cmbx10`, `sfti1000`, `ecss0900`.
 *  Slanted counts as italic: it is what an italic request would be met with. */
const TEX_FACES: Readonly<Record<string, TexFace>> = {
  r: SERIF, rm: SERIF, csc: SERIF, cc: SERIF, dunh: SERIF, ff: SERIF, fi: SERIF,
  sy: SERIF, ex: SERIF,
  b: { ...SERIF, bold: true }, bx: { ...SERIF, bold: true }, fib: { ...SERIF, bold: true },
  bsy: { ...SERIF, bold: true },
  ti: { ...SERIF, italic: true }, sl: { ...SERIF, italic: true }, u: { ...SERIF, italic: true },
  mi: { ...SERIF, italic: true },
  bxti: { ...SERIF, bold: true, italic: true }, bxsl: { ...SERIF, bold: true, italic: true },
  mib: { ...SERIF, bold: true, italic: true },
  ss: SANS,
  ssbx: { ...SANS, bold: true }, sx: { ...SANS, bold: true }, ssdc: { ...SANS, bold: true },
  ssi: { ...SANS, italic: true }, si: { ...SANS, italic: true },
  tt: MONO, tcsc: MONO, vtt: MONO,
  itt: { ...MONO, italic: true }, it: { ...MONO, italic: true },
  sltt: { ...MONO, italic: true }, st: { ...MONO, italic: true },
};

const TEX_NAME = /^(?:cm|sf|ec)([a-z]+)\d+$/i;

// Tested in this order: `DejaVuSansMono` is a monospace, and `MS Reference
// Sans Serif` a sans.
const MONOSPACE = /mono|courier|consol|typewriter|menlo|monaco|inconsolata|fixed/i;
const SANS_SERIF =
  /sans|helvet|arial|grotesk|gothic|verdana|tahoma|calibri|roboto|myriad|frutiger|futura|univers|gill|optima|avenir|lato|segoe|corbel|candara|trebuchet|franklin|akzidenz/i;
const SERIFED =
  /serif|times|lmroman|nimbusrom|garamond|baskerv|palatino|pallad|bookman|century|schoolbook|georgia|minion|caslon|libertin|charter|utopia|melior|warnock|cambria|constantia|antiqua|didot|bodoni|sabon|bembo|jenson|plantin/i;

/** How a face's weight and slant are abbreviated after the family's name:
 *  `Baskervaldx-BolIta`, `NimbusSanL-ReguItal`, `WarnockPro-It`. */
const BOLD_WORDS = new Set(["bol", "bold", "bd", "bld", "semibold", "sb", "smbd", "demi", "dm", "demibold", "black", "blk", "heavy", "hv", "ultra"]);
const ITALIC_WORDS = new Set(["it", "ita", "ital", "italic", "obl", "oblique", "slant", "slanted", "sl", "kursiv", "inclined"]);

export function faceFromName(name: string): NamedFace {
  const tex = TEX_FACES[TEX_NAME.exec(name)?.[1]?.toLowerCase() ?? ""];
  if (tex) return { generic: tex.generic, bold: tex.bold ?? false, italic: tex.italic ?? false };

  const generic = MONOSPACE.test(name)
    ? "monospace"
    : SANS_SERIF.test(name)
      ? "sans-serif"
      : SERIFED.test(name)
        ? "serif"
        : undefined;
  // The style follows the family after a hyphen or a comma, in words run
  // together: each capital starts one.
  const style = name.split(/[-,]/).slice(1).join("");
  const words = (style.match(/[A-Z][a-z]*|[a-z]+/g) ?? []).map((word) => word.toLowerCase());
  return {
    ...(generic ? { generic } : {}),
    bold: /bold|black|heavy|demi/i.test(name) || words.some((word) => BOLD_WORDS.has(word)),
    italic: /italic|oblique/i.test(name) || words.some((word) => ITALIC_WORDS.has(word)),
  };
}
