import { useEffect, useRef, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { cn } from "@/lib/utils";

const DEFAULT_ROW_PX = 18;

export type VirtualHighlightListRenderArgs<T> = {
  item: T;
  index: number;
  isActive: boolean;
  zebra: boolean;
};

export type VirtualHighlightListProps<T> = {
  items: readonly T[];
  /** 估算行高，默认 18px */
  estimateRowPx?: number;
  overscan?: number;
  getItemKey: (item: T, index: number) => string | number;
  /** 当前高亮行判定 */
  isRowActive: (item: T, index: number) => boolean;
  onRowClick: (item: T, index: number) => void;
  getRowTitle?: (item: T, index: number) => string;
  /** 空列表占位 */
  empty?: ReactNode;
  /** 行内容渲染 */
  renderRow: (args: VirtualHighlightListRenderArgs<T>) => ReactNode;
};
export function VirtualHighlightList<T>({
  items,
  estimateRowPx = DEFAULT_ROW_PX,
  overscan = 16,
  getItemKey,
  isRowActive,
  onRowClick,
  getRowTitle,
  empty,
  renderRow,
}: VirtualHighlightListProps<T>) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => estimateRowPx,
    overscan,
    getItemKey: (index) => {
      const item = items[index];
      return item !== undefined ? getItemKey(item, index) : String(index);
    },
  });

  useEffect(() => {
    virtualizer.measure();
  }, [items, virtualizer]);

  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      virtualizer.measure();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [virtualizer]);

  if (items.length === 0) {
    return empty ?? null;
  }

  return (
    <div ref={parentRef} className="scrollbar-hidden h-full min-h-0 overflow-auto">
      <div
        className="relative w-full"
        style={{ height: `${virtualizer.getTotalSize()}px` }}
      >
        {virtualizer.getVirtualItems().map((vRow) => {
          const item = items[vRow.index] as T;
          const isActive = isRowActive(item, vRow.index);
          const title = getRowTitle?.(item, vRow.index) ?? "";
          const zebra = vRow.index % 2 === 0;
          return (
            <div
              key={vRow.key}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: `${vRow.size}px`,
                transform: `translateY(${vRow.start}px)`,
              }}
              role="button"
              tabIndex={0}
              title={title}
              aria-current={isActive ? "true" : undefined}
              data-active={isActive ? "" : undefined}
              className={cn(
                "flex cursor-pointer items-center gap-1 border-b px-2.5 text-[9px] font-mono leading-none transition-colors",
                isActive
                  ? "bg-sky-500/20 ring-1 ring-inset ring-sky-500/40 dark:bg-sky-400/15 dark:ring-sky-400/35"
                  : cn(zebra ? "bg-muted/30" : "", "hover:bg-muted/50"),
              )}
              onClick={() => onRowClick(item, vRow.index)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onRowClick(item, vRow.index);
                }
              }}
            >
              {renderRow({ item, index: vRow.index, isActive, zebra })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
