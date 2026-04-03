import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { X, ZoomIn, ZoomOut } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  defaultFloatingRect,
  loadSavedFloatingRect,
  saveFloatingRect,
  type FloatingPanelRect,
} from "./floatingPanelStorage";
import { FloatingPanelBodyContext } from "./FloatingPanelBodyContext";

const MIN_W = 220;
const MIN_H = 140;
/** 顶边最小留白，防止标题栏拖出视口 */
const TOP_MARGIN = 8;
/** 面板层级 */
const Z_PANEL = 95;
const RESIZE_HANDLE_PX = 14;
const SCALE_MIN = 0.5;
const SCALE_MAX = 2;
const SCALE_STEP = 0.1;

function ensureMinSize(r: FloatingPanelRect): FloatingPanelRect {
  return {
    ...r,
    w: Math.max(MIN_W, r.w),
    h: Math.max(MIN_H, r.h),
  };
}

/** 仅限制顶边 */
function clampTopEdge(r: FloatingPanelRect): FloatingPanelRect {
  return { ...r, y: Math.max(TOP_MARGIN, r.y) };
}

export function FloatingPanelFrame({
  title,
  headerTrailing,
  onClose,
  children,
}: {
  title: string;
  /** 标题栏右侧区域，不参与拖动 */
  headerTrailing?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  const [rect, setRect] = useState<FloatingPanelRect>(() => {
    const saved = loadSavedFloatingRect();
    if (typeof window === "undefined") {
      return clampTopEdge(ensureMinSize(saved ?? defaultFloatingRect()));
    }
    return clampTopEdge(ensureMinSize(saved ?? defaultFloatingRect()));
  });

  /** 打开时默认 100% 缩放 */
  const [contentScale, setContentScale] = useState(1);
  /** 用缩放后的包围盒高度收紧外层，避免底部留白 */
  const [scaledOuterHeight, setScaledOuterHeight] = useState<number | null>(null);
  const scaleInnerRef = useRef<HTMLDivElement | null>(null);
  const [bodyRoot, setBodyRoot] = useState<HTMLElement | null>(null);

  const setScaleInnerEl = useCallback((el: HTMLDivElement | null) => {
    scaleInnerRef.current = el;
    setBodyRoot(el);
  }, []);

  const updateScaledOuterHeight = useCallback(() => {
    const el = scaleInnerRef.current;
    if (!el) return;
    setScaledOuterHeight(el.getBoundingClientRect().height);
  }, [contentScale]);

  useLayoutEffect(() => {
    updateScaledOuterHeight();
  }, [updateScaledOuterHeight, children]);

  useEffect(() => {
    const el = scaleInnerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      updateScaledOuterHeight();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [updateScaledOuterHeight]);

  const dragRef = useRef<{
    type: "move" | "resize";
    startX: number;
    startY: number;
    orig: FloatingPanelRect;
  } | null>(null);

  const rectRef = useRef(rect);
  rectRef.current = rect;

  const applyRect = useCallback((next: FloatingPanelRect) => {
    setRect(next);
    rectRef.current = next;
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;

      if (d.type === "move") {
        const x = d.orig.x + dx;
        const y = Math.max(TOP_MARGIN, d.orig.y + dy);
        applyRect({ ...d.orig, x, y });
      } else {
        let w = d.orig.w + dx;
        let h = d.orig.h + dy;
        w = Math.max(MIN_W, w);
        h = Math.max(MIN_H, h);
        applyRect({ ...d.orig, w, h });
      }
    };

    const onUp = () => {
      if (dragRef.current) {
        saveFloatingRect(rectRef.current);
      }
      dragRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [applyRect]);

  const startMove = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = {
      type: "move",
      startX: e.clientX,
      startY: e.clientY,
      orig: { ...rect },
    };
    document.body.style.cursor = "grabbing";
    document.body.style.userSelect = "none";
  };

  const nudgeScale = useCallback((delta: number) => {
    setContentScale((prev) =>
      Math.min(
        SCALE_MAX,
        Math.max(SCALE_MIN, Math.round((prev + delta) * 100) / 100),
      ),
    );
  }, []);

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = {
      type: "resize",
      startX: e.clientX,
      startY: e.clientY,
      orig: { ...rect },
    };
    document.body.style.cursor = "nwse-resize";
    document.body.style.userSelect = "none";
  };

  return (
    <FloatingPanelBodyContext.Provider value={bodyRoot}>
    <div
      className={cn(
        "fixed flex flex-col overflow-hidden rounded-md border border-gray-300 bg-background shadow-[0_8px_32px_rgba(0,0,0,0.28)]",
      )}
      style={{
        left: rect.x,
        top: rect.y,
        width: rect.w,
        height: rect.h,
        zIndex: Z_PANEL,
      }}
      role="dialog"
      aria-label={title}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="flex shrink-0 select-none items-stretch border-b border-border bg-muted/70">
        <div
          className="flex min-w-0 flex-1 cursor-grab items-center px-2 py-1 active:cursor-grabbing"
          onMouseDown={startMove}
        >
          <span className="truncate text-[11px] font-medium text-foreground">{title}</span>
        </div>
        <div
          className="flex shrink-0 items-center gap-px px-0.5"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
            title="缩小内容"
            aria-label="Zoom out"
            disabled={contentScale <= SCALE_MIN}
            onClick={() => nudgeScale(-SCALE_STEP)}
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
            title="放大内容"
            aria-label="Zoom in"
            disabled={contentScale >= SCALE_MAX}
            onClick={() => nudgeScale(SCALE_STEP)}
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </button>
        </div>
        <div
          className="flex shrink-0 items-center gap-0.5 border-l border-border/60 pl-1 pr-0.5"
          onMouseDown={(e) => e.stopPropagation()}
        >
          {headerTrailing}
          <button
            type="button"
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Close"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <div
          className="w-full min-w-0"
          style={{
            height: scaledOuterHeight ?? undefined,
            overflow: "hidden",
          }}
        >
          <div
            ref={setScaleInnerEl}
            className="w-full min-w-0 will-change-transform"
            style={{
              transform: `scale(${contentScale})`,
              transformOrigin: "top left",
              width: `${100 / contentScale}%`,
            }}
          >
            {children}
          </div>
        </div>
      </div>
      <div
        className="absolute cursor-nwse-resize rounded-tl-sm bg-muted/40 hover:bg-muted/70"
        style={{
          width: RESIZE_HANDLE_PX,
          height: RESIZE_HANDLE_PX,
          right: 0,
          bottom: 0,
        }}
        aria-hidden
        onMouseDown={startResize}
        title="Resize"
      />
    </div>
    </FloatingPanelBodyContext.Provider>
  );
}
