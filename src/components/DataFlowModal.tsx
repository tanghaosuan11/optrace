import React from "react";
import { GitBranch, X } from "lucide-react";
import { BottomSheetShell } from "@/components/ui/bottom-sheet-shell";
import { SheetClose } from "@/components/ui/sheet";
import { DataFlowTreeComponent, type DataNodeInfo } from "./DataFlowTree";

interface DataFlowDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  rootId: number;
  nodes: DataNodeInfo[];
  onStepSelect?: (globalStep: number) => void;
}

/** 与其它底部抽屉共用 `BottomSheetShell`（拖拽条、顶边、阴影一致） */
export const DataFlowDrawer: React.FC<DataFlowDrawerProps> = ({
  isOpen,
  onClose,
  rootId,
  nodes,
  onStepSelect,
}) => {
  if (!isOpen || nodes.length === 0) return null;

  const rootStep = nodes.find((n) => n.id === rootId)?.global_step;

  return (
    <BottomSheetShell
      open={isOpen}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      sheetTitle="Data flow"
      defaultHeightVh={50}
      minHeightPx={150}
      contentClassName="bg-white text-slate-900"
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex flex-nowrap items-center gap-x-1.5 border-b border-border bg-muted/60 px-2 py-1 text-[11px] shrink-0">
          <GitBranch className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
          <span className="shrink-0 font-semibold tracking-wide text-foreground">Data flow</span>
          <span className="min-w-0 flex-1 truncate text-muted-foreground tabular-nums">
            <span className="text-muted-foreground/70">·</span> step #{rootStep ?? "—"}{" "}
            <span className="text-muted-foreground/50">|</span> {nodes.length} nodes
          </span>
          <SheetClose className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sm p-0 opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-secondary">
            <X className="h-3 w-3" />
            <span className="sr-only">Close</span>
          </SheetClose>
        </div>
        <div className="relative min-h-0 flex-1 overflow-hidden">
          <DataFlowTreeComponent
            root_id={rootId}
            nodes={nodes}
            onNodeClick={(globalStep) => {
              console.log("[DataFlowDrawer] Jumping to step:", globalStep);
              onStepSelect?.(globalStep);
            }}
          />
        </div>
      </div>
    </BottomSheetShell>
  );
};

export default DataFlowDrawer;
