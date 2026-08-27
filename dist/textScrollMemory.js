const positions = new Map();
const markdownZooms = new Map();
export const MARKDOWN_MIN_ZOOM = 0.6;
export const MARKDOWN_MAX_ZOOM = 2.5;
function key(path, mode) {
    return `${path}\u0000${mode}`;
}
export function saveTextScrollPosition(path, mode, ratio) {
    positions.set(key(path, mode), Math.min(Math.max(ratio, 0), 1));
}
export function readTextScrollPosition(path, mode) {
    return positions.get(key(path, mode)) ?? null;
}
export function saveMarkdownZoom(path, zoom) {
    markdownZooms.set(path, Math.min(Math.max(zoom, MARKDOWN_MIN_ZOOM), MARKDOWN_MAX_ZOOM));
}
export function readMarkdownZoom(path) {
    return markdownZooms.get(path) ?? 1;
}
//# sourceMappingURL=textScrollMemory.js.map