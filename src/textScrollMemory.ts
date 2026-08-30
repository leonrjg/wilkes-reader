/** Session-scoped reader positions for text documents. Positions are keyed by
 * document path and presentation mode so the source and rendered views of one
 * document do not overwrite one another. A normalized ratio survives viewport
 * resizing. Zoom is keyed by path alone: how large a document is read at is a
 * property of the document, not of which surface it is being read on. */
export type TextViewerMode = "source" | "rendered";

const positions = new Map<string, number>();
const zooms = new Map<string, number>();

export const TEXT_MIN_ZOOM = 0.6;
export const TEXT_MAX_ZOOM = 2.5;

function key(path: string, mode: TextViewerMode): string {
  return `${path}\u0000${mode}`;
}

export function saveTextScrollPosition(path: string, mode: TextViewerMode, ratio: number): void {
  positions.set(key(path, mode), Math.min(Math.max(ratio, 0), 1));
}

export function readTextScrollPosition(path: string, mode: TextViewerMode): number | null {
  return positions.get(key(path, mode)) ?? null;
}

export function saveTextZoom(path: string, zoom: number): void {
  zooms.set(path, Math.min(Math.max(zoom, TEXT_MIN_ZOOM), TEXT_MAX_ZOOM));
}

export function readTextZoom(path: string): number {
  return zooms.get(path) ?? 1;
}
