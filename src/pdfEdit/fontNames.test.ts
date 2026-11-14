import { describe, expect, it } from "vitest";
import { faceFromName } from "./fontNames.js";

describe("faceFromName", () => {
  it("reads Computer Modern's face codes", () => {
    expect(faceFromName("CMR10")).toEqual({ generic: "serif", bold: false, italic: false });
    expect(faceFromName("CMBX12")).toEqual({ generic: "serif", bold: true, italic: false });
    expect(faceFromName("CMTI10")).toEqual({ generic: "serif", bold: false, italic: true });
    expect(faceFromName("CMMI8")).toEqual({ generic: "serif", bold: false, italic: true });
    expect(faceFromName("CMSS12")).toEqual({ generic: "sans-serif", bold: false, italic: false });
    expect(faceFromName("CMSSBX10")).toEqual({ generic: "sans-serif", bold: true, italic: false });
    expect(faceFromName("CMTT9")).toEqual({ generic: "monospace", bold: false, italic: false });
    expect(faceFromName("SFTT1000")).toEqual({ generic: "monospace", bold: false, italic: false });
  });

  it("knows a family by its name, whatever the file's flags say", () => {
    expect(faceFromName("Baskervaldx-Reg").generic).toBe("serif");
    expect(faceFromName("LMMono10-Regular").generic).toBe("monospace");
    expect(faceFromName("LMRoman10-Regular").generic).toBe("serif");
    expect(faceFromName("DejaVuSansMono").generic).toBe("monospace");
    expect(faceFromName("MSReferenceSansSerif").generic).toBe("sans-serif");
    expect(faceFromName("SourceSansPro-Regular").generic).toBe("sans-serif");
  });

  it("reads abbreviated weights and slants after the family", () => {
    expect(faceFromName("Baskervaldx-BolIta")).toMatchObject({ bold: true, italic: true });
    expect(faceFromName("Baskervaldx-Ita")).toMatchObject({ bold: false, italic: true });
    expect(faceFromName("NimbusSanL-ReguItal")).toMatchObject({ bold: false, italic: true });
    expect(faceFromName("WarnockPro-It")).toMatchObject({ bold: false, italic: true });
    expect(faceFromName("TimesNewRoman,Italic")).toMatchObject({ bold: false, italic: true });
    expect(faceFromName("LibertinusSerif-Semibold")).toMatchObject({ bold: true, italic: false });
    expect(faceFromName("Arial-BoldMT")).toMatchObject({ bold: true, italic: false });
  });

  it("says nothing where the name does not", () => {
    expect(faceFromName("Gaspar")).toEqual({ bold: false, italic: false });
    expect(faceFromName("")).toEqual({ bold: false, italic: false });
    // `It` only counts as a word of the style, not as letters of the family.
    expect(faceFromName("Merriweather-Regular")).toEqual({ bold: false, italic: false });
    expect(faceFromName("Bitter-Regular")).toMatchObject({ bold: false, italic: false });
  });
});
