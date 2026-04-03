export type FloatingPanelRect = { x: number; y: number; w: number; h: number };

const STORAGE_KEY = "optrace-floating-panel-rect";

export function loadSavedFloatingRect(): FloatingPanelRect | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<FloatingPanelRect>;
    if (
      typeof p.x === "number" &&
      typeof p.y === "number" &&
      typeof p.w === "number" &&
      typeof p.h === "number"
    ) {
      return { x: p.x, y: p.y, w: p.w, h: p.h };
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function saveFloatingRect(r: FloatingPanelRect) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(r));
  } catch {
    /* ignore */
  }
}

export function defaultFloatingRect(): FloatingPanelRect {
  if (typeof window === "undefined") {
    return { x: 48, y: 80, w: 400, h: 320 };
  }
  const w = 400;
  const h = 320;
  const margin = 16;
  return {
    x: Math.max(margin, window.innerWidth - w - margin),
    y: 80,
    w,
    h,
  };
}
