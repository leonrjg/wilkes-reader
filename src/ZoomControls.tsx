import type { ReactNode } from "react";

export const ZOOM_STEP = 0.1;
/** The zoom range of the page-based readers. */
export const PAGE_MIN_ZOOM = 0.25;
export const PAGE_MAX_ZOOM = 3.0;

/** One zoom step from `zoom`, rounded so repeated steps do not drift. */
export function stepPageZoom(zoom: number, direction: 1 | -1): number {
  return Math.min(PAGE_MAX_ZOOM, Math.max(PAGE_MIN_ZOOM, +(zoom + direction * ZOOM_STEP).toFixed(2)));
}

/** The floating control pill every reader shows at its bottom-right corner. */
export function ViewerToolbar({ children }: { children: ReactNode }) {
  return (
    <div className="absolute bottom-4 right-4 z-20 flex flex-col gap-2 items-end">
      <div className="flex items-center gap-1.5 bg-[var(--bg-app)] border border-[var(--border-main)] rounded-lg shadow-lg px-2.5 py-1.5 text-sm text-[var(--text-main)]">
        {children}
      </div>
    </div>
  );
}

/** "current/total" followed by the divider that separates it from the zoom cluster. */
export function PageIndicator({ page, pageCount }: { page: number; pageCount: number }) {
  return (
    <>
      <span className="w-20 text-center font-mono">{page}/{pageCount}</span>
      <span className="text-[var(--text-dim)]">|</span>
    </>
  );
}

interface ZoomControlsProps {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
}

/**
 * The −/percentage/+ zoom cluster shared by the PDF and Markdown viewers. It is
 * purely presentational: each viewer keeps its own zoom state, clamping, and the
 * meaning of a zoom step (canvas scale vs. font size), and passes the handlers.
 * Rendered as a fragment so callers own the surrounding container.
 */
export default function ZoomControls({ zoom, onZoomIn, onZoomOut }: ZoomControlsProps) {
  return (
    <>
      <button onClick={onZoomOut} aria-label="Zoom out" className="px-1.5 py-0.5 hover:text-[var(--accent-blue)]">
        −
      </button>
      <span className="w-12 text-center font-mono">{Math.round(zoom * 100)}%</span>
      <button onClick={onZoomIn} aria-label="Zoom in" className="px-1.5 py-0.5 hover:text-[var(--accent-blue)]">
        +
      </button>
    </>
  );
}
