/**
 * 面板选择 Hint 模式（类似 HintOverlay）
 * 
 * 按 Shift+F 进入：为每个面板的左上角显示可选的数字键 hint（1-4）。
 * 按对应数字键选中面板，面板获得焦点并关闭 hint 模式。
 * 按 ESC 关闭 hint 模式，不改变焦点。
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useDebugStore } from "@/store/debugStore";

const PANELS = [
  { id: "opcode", label: "1" },
  { id: "stack", label: "2" },
  { id: "memory", label: "3" },
  { id: "storage", label: "4" },
  { id: "frameinfo", label: "5" },
  { id: "calldata", label: "6" },
  { id: "returndata", label: "7" },
  { id: "logs", label: "8" },
];

interface HintItem {
  label: string;
  panelId: string;
  rect: DOMRect;
}

export function PanelHintOverlay() {
  const isPanelSelectorOpen = useDebugStore((s) => s.isPanelSelectorOpen);
  const [hints, setHints] = useState<HintItem[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isPanelSelectorOpen) {
      setHints([]);
      return;
    }

    // 扫描所有带 data-panel-id 的面板
    const newHints: HintItem[] = [];
    for (const panel of PANELS) {
      const el = document.querySelector(`[data-panel-id="${panel.id}"]`) as HTMLElement;
      if (el) {
        const rect = el.getBoundingClientRect();
        newHints.push({
          label: panel.label,
          panelId: panel.id,
          rect,
        });
      }
    }
    setHints(newHints);
  }, [isPanelSelectorOpen]);

  useEffect(() => {
    if (!isPanelSelectorOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // 数字键 1-4 选择面板
      const key = e.key;
      const hint = hints.find((h) => h.label === key);
      if (hint) {
        e.preventDefault();
        useDebugStore.getState().sync({
          activePanelId: hint.panelId,
          isPanelSelectorOpen: false,
        });
        return;
      }

      // ESC 关闭选择器
      if (key === "Escape") {
        e.preventDefault();
        useDebugStore.getState().sync({ isPanelSelectorOpen: false });
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [hints, isPanelSelectorOpen]);

  if (!isPanelSelectorOpen || hints.length === 0) return null;

  return createPortal(
    <div ref={containerRef} className="fixed inset-0 pointer-events-none z-50">
      {hints.map((hint) => (
        <div
          key={hint.panelId}
          className="absolute pointer-events-auto"
          style={{
            left: `${hint.rect.left + 8}px`,
            top: `${hint.rect.top + 8}px`,
          }}
        >
          <div className="inline-flex min-w-[1.375rem] h-[1.375rem] items-center justify-center px-0.5 bg-primary text-primary-foreground rounded text-[11px] font-bold leading-none shadow-md select-none">
            {hint.label}
          </div>
        </div>
      ))}
    </div>,
    document.body
  );
}
