import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";
// The environment gaps a host hits too, and which ship with the package.
import "./src/testing/setup";

afterEach(() => {
  cleanup();
});

// jsdom implements neither of these, and the readers observe both.
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

global.ResizeObserver = vi.fn().mockImplementation(function (this: any) {
  this.observe = vi.fn();
  this.unobserve = vi.fn();
  this.disconnect = vi.fn();
});

// CodeMirror draws to a real layout engine, which jsdom does not provide. The
// source reader is tested for the behaviour it adds around the editor, not for
// CodeMirror itself, so the editor is a double everywhere.
vi.mock("@codemirror/view", () => {
  function MockView(this: any, config?: { state?: unknown }) {
    this.destroy = vi.fn();
    this.dispatch = vi.fn();
    this.state = config?.state ?? {
      doc: { toString: () => "{}", length: 2 },
      selection: { main: { empty: true, head: 2 } },
      sliceDoc: (from: number, to: number) => "{}".slice(from, to),
    };
  }
  MockView.theme = vi.fn().mockReturnValue({});
  MockView.baseTheme = vi.fn().mockReturnValue({});
  MockView.decorations = { from: vi.fn() };
  MockView.lineWrapping = {};
  MockView.scrollIntoView = vi.fn();
  MockView.updateListener = { of: vi.fn() };
  class MockWidgetType {}
  return {
    EditorView: MockView,
    Decoration: {
      none: {},
      mark: vi.fn(),
      set: vi.fn().mockReturnValue({}),
      widget: vi.fn().mockReturnValue({ range: vi.fn().mockReturnValue({}) }),
    },
    WidgetType: MockWidgetType,
    keymap: { of: vi.fn() },
  };
});

vi.mock("@codemirror/state", () => ({
  EditorState: {
    create: vi.fn(({ doc }: { doc: string }) => ({
      doc: { toString: () => doc, length: doc.length },
      selection: { main: { empty: true, head: doc.length } },
      sliceDoc: (from: number, to: number) => doc.slice(from, to),
    })),
    readOnly: { of: vi.fn() },
  },
  RangeSetBuilder: vi.fn().mockImplementation(() => ({
    add: vi.fn(),
    finish: vi.fn(),
  })),
  StateField: { define: vi.fn() },
  StateEffect: { define: vi.fn(() => ({ of: vi.fn(), is: vi.fn() })) },
  Prec: { highest: vi.fn((value: unknown) => value) },
}));
