import { useEffect } from "react";
import { useDebugStore } from "@/store/debugStore";

const PANELS = [
  { id: "opcode", name: "Opcode", key: "1" },
  { id: "stack", name: "Stack", key: "2" },
  { id: "memory", name: "Memory", key: "3" },
  { id: "storage", name: "Storage", key: "4" },
];

export function PanelSelector() {
  const isOpen = useDebugStore((s) => s.isPanelSelectorOpen);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // 数字键 1-4 选择面板
      const key = e.key;
      const panel = PANELS.find((p) => p.key === key);
      if (panel) {
        e.preventDefault();
        useDebugStore.getState().sync({
          activePanelId: panel.id,
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

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-background border border-border rounded-lg shadow-2xl p-6 max-w-md">
        <h2 className="text-lg font-semibold mb-4">Select Panel</h2>
        <div className="space-y-2 mb-4">
          {PANELS.map((panel) => (
            <div
              key={panel.id}
              className={`p-3 rounded border cursor-pointer transition-colors ${
                useDebugStore.getState().activePanelId === panel.id
                  ? "bg-primary/20 border-primary"
                  : "border-border hover:bg-muted/50"
              }`}
            >
              <div className="flex items-center gap-2">
                <kbd className="px-2 py-1 bg-muted rounded text-xs font-mono">
                  {panel.key}
                </kbd>
                <span className="font-medium">{panel.name}</span>
              </div>
            </div>
          ))}
        </div>
        <div className="text-xs text-muted-foreground space-y-1">
          <p>Press <kbd>1</kbd>-<kbd>4</kbd> to select, <kbd>ESC</kbd> to close</p>
          <p className="mt-2">After selection, use <kbd>w</kbd>/<kbd>e</kbd> to scroll</p>
        </div>
      </div>
    </div>
  );
}
