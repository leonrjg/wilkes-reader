import { withSourceRuns, type HastNode, type TextAnnotation } from "./sourceRuns.js";

/** Rehype plugin that makes every rendered text run addressable in source bytes.
 *
 *  The mapping itself is substrate-neutral and lives in `sourceRuns`; what is
 *  Markdown's alone is the plugin shape react-markdown expects, and the fact
 *  that a newline in flowing Markdown is a soft break rather than whitespace. */
export function sourceMappedMarkdown(content: string, annotations: TextAnnotation[]) {
  // A rehype plugin transforms the tree it is handed, so the marked copy is
  // moved back onto it. react-markdown parses on every render either way.
  return () => (tree: HastNode) => {
    tree.children = withSourceRuns(tree, content, annotations, "break").children;
  };
}

export type { TextAnnotation };
