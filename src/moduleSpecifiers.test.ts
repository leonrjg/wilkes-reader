import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `tsc` emits import specifiers exactly as written, so the source has to spell
 * them the way Node's ESM resolver reads them: a relative import needs its
 * extension. Without it the build still succeeds and a bundler still resolves
 * it, so nothing here or in a consumer's build complains -- but a consumer
 * whose test runner loads this package through Node, as Vitest does for
 * anything in node_modules, gets ERR_MODULE_NOT_FOUND on every entry point.
 *
 * That is invisible while the package is linked, because Vitest inlines a
 * linked dependency and lets Vite resolve it. It appears only once the package
 * is installed for real, which is the worst moment to find it.
 */

const RELATIVE_SPECIFIER = /\b(?:from|import)\s+"(\.{1,2}\/[^"]*)"/g;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry) ? [path] : [];
  });
}

describe("module specifiers", () => {
  it("give every relative import an extension Node can resolve", () => {
    const offenders = sourceFiles(join(process.cwd(), "src")).flatMap((path) => {
      const source = readFileSync(path, "utf8");
      return [...source.matchAll(RELATIVE_SPECIFIER)]
        .map((match) => match[1])
        .filter((specifier) => !/\.(js|css|json)$/.test(specifier))
        .map((specifier) => `${path.split("/src/")[1]}: ${specifier}`);
    });
    expect(offenders).toEqual([]);
  });
});
