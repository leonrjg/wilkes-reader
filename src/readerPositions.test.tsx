import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import MarkdownViewer from "./MarkdownViewer.js";
import {
  clampTextScrollRatio,
  clampTextZoom,
  createMemoryPositionStore,
  TEXT_MAX_ZOOM,
  TEXT_MIN_ZOOM,
} from "./readerPositions.js";
import { renderWithReaderHost } from "./testing/readerHarness.js";

describe("createMemoryPositionStore", () => {
  it("keeps source and rendered positions of one document independent", () => {
    const positions = createMemoryPositionStore();
    positions.saveTextScroll("/notes.md", "source", 0.25);
    positions.saveTextScroll("/notes.md", "rendered", 0.75);

    expect(positions.readTextScroll("/notes.md", "source")).toBe(0.25);
    expect(positions.readTextScroll("/notes.md", "rendered")).toBe(0.75);
    expect(positions.readTextZoom("/notes.md")).toBeNull();
  });

  it("does not share what it holds with another store", () => {
    const first = createMemoryPositionStore();
    first.savePdf("paper.pdf", { page: 4, offsetRatio: 0.5, horizontalRatio: 0.5, zoom: 1.2 });

    expect(createMemoryPositionStore().readPdf("paper.pdf")).toBeNull();
  });
});

describe("text position clamps", () => {
  it("clamps scroll ratios to the scrollable range and zoom to the reader's bounds", () => {
    expect(clampTextScrollRatio(-1)).toBe(0);
    expect(clampTextScrollRatio(2)).toBe(1);
    expect(clampTextZoom(0.1)).toBe(TEXT_MIN_ZOOM);
    expect(clampTextZoom(9)).toBe(TEXT_MAX_ZOOM);
  });
});

describe("text readers and the host's store", () => {
  it("reads a document's zoom from the host rather than from anything of their own", () => {
    const positions = createMemoryPositionStore();
    positions.saveTextZoom("/remembered.md", 1.5);

    renderWithReaderHost(
      <MarkdownViewer content="# Title" documentPath="/remembered.md" highlightRange={{ start: 0, end: 0 }} />,
      { host: { positions } },
    );

    expect(screen.getByText("150%")).toBeInTheDocument();
  });
});
