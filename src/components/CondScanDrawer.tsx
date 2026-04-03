import { useEffect, useMemo, useRef, useState } from "react";
import { BottomSheetShell } from "@/components/ui/bottom-sheet-shell";
import { SheetClose } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { X, ScanSearch, PanelTop } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDebugStore } from "@/store/debugStore";
import {
  PAUSE_CONDITION_LABELS,
  type CondNode,
  type PauseConditionType,
  type ScanHit,
} from "@/lib/pauseConditions";
import { useCondNodeEditor } from "@/hooks/useCondNodeEditor";
import type { RunConditionScanOptions } from "@/hooks/useConditionScan";
import { useDrawerActions } from "@/hooks/useDrawerActions";
import { useDebugUiActions } from "@/hooks/useDebugUiActions";
import { useFloatingPanel } from "@/components/floating-panel";
import { ScanHitsList, ScanHitsJumpControls } from "@/components/ScanHitsList";

interface CondScanDrawerProps {
  onRunConditionScan: (options?: RunConditionScanOptions) => Promise<ScanHit[]>;
  onClearAllConditions: () => void;
  onSeekTo: (stepIndex: number) => void;
  disabled?: boolean;
}

/** 条件分类 */
type CondCategoryId = "sstore" | "sload" | "call" | "frame";

const COND_CATEGORY_GROUPS: {
  id: CondCategoryId;
  label: string;
  variants: { type: PauseConditionType; label: string }[];
}[] = [
  {
    id: "sstore",
    label: "sstore",
    variants: [
      { type: "sstore_key", label: "key" },
      { type: "sstore_value", label: "value" },
    ],
  },
  {
    id: "sload",
    label: "sload",
    variants: [
      { type: "sload_key", label: "key" },
      { type: "sload_value", label: "value" },
    ],
  },
  {
    id: "call",
    label: "call",
    variants: [
      { type: "call_address", label: "call_address" },
      { type: "call_selector", label: "call_selector" },
    ],
  },
  {
    id: "frame",
    label: "frame",
    variants: [
      { type: "contract_address", label: "contract_address" },
      { type: "target_address", label: "target_address" },
      { type: "frame_call_address", label: "call_address" },
    ],
  },
];

function CondNodeItem({
  node,
  onRemove,
  onToggleEnabled,
  selected,
  onSelect,
  canSelect,
}: {
  node: CondNode;
  onRemove: (id: string) => void;
  onToggleEnabled: (id: string) => void;
  selected: Set<string>;
  onSelect: (id: string) => void;
  canSelect: boolean;
}) {
  if (node.kind === "leaf") {
    const { cond } = node;
    return (
      <div
        className={`flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[10px] font-mono leading-tight ${
          cond.enabled ? "bg-muted" : "bg-muted/30 opacity-50"
        } ${selected.has(node.id) ? "ring-1 ring-primary" : ""}`}
      >
        <input
          type="checkbox"
          checked={cond.enabled}
          onChange={() => onToggleEnabled(node.id)}
          className="h-2.5 w-2.5 shrink-0 cursor-pointer accent-primary"
          title={cond.enabled ? "Disable" : "Enable"}
        />
        {canSelect && (
          <input
            type="checkbox"
            checked={selected.has(node.id)}
            onChange={() => onSelect(node.id)}
            className="h-2.5 w-2.5 shrink-0 cursor-pointer accent-sky-500"
            title="Select to merge"
          />
        )}
        <span className="shrink-0 text-muted-foreground">{PAUSE_CONDITION_LABELS[cond.type]}</span>
        <span className="min-w-0 flex-1 break-all text-foreground">{cond.value}</span>
        <button
          type="button"
          onClick={() => onRemove(node.id)}
          className="shrink-0 px-0.5 leading-none text-muted-foreground hover:text-destructive"
          title="Remove"
        >
          ×
        </button>
      </div>
    );
  }

  return (
    <div
      className={`space-y-0.5 rounded-sm border px-1.5 py-1 ${
        selected.has(node.id) ? "border-primary" : "border-border"
      }`}
    >
      <div className="flex items-center gap-1">
        {canSelect && (
          <input
            type="checkbox"
            checked={selected.has(node.id)}
            onChange={() => onSelect(node.id)}
            className="h-2.5 w-2.5 shrink-0 cursor-pointer accent-sky-500"
            title="Select to merge"
          />
        )}
        <span
          className={`rounded px-0.5 py-px text-[9px] font-mono font-bold ${
            node.op === "AND"
              ? "bg-blue-500/20 text-blue-400"
              : "bg-orange-500/20 text-orange-400"
          }`}
        >
          {node.op}
        </span>
        <span className="text-[9px] text-muted-foreground">Compound</span>
        <button
          type="button"
          onClick={() => onRemove(node.id)}
          className="ml-auto px-0.5 leading-none text-muted-foreground hover:text-destructive"
          title="Remove group"
        >
          ×
        </button>
      </div>
      <div className="space-y-0.5 border-l border-muted-foreground/25 pl-1.5">
        <CondNodeItem
          node={node.left}
          onRemove={onRemove}
          onToggleEnabled={onToggleEnabled}
          selected={selected}
          onSelect={onSelect}
          canSelect={false}
        />
        <CondNodeItem
          node={node.right}
          onRemove={onRemove}
          onToggleEnabled={onToggleEnabled}
          selected={selected}
          onSelect={onSelect}
          canSelect={false}
        />
      </div>
    </div>
  );
}

export function CondScanDrawer({
  onRunConditionScan,
  onClearAllConditions,
  onSeekTo,
  disabled = false,
}: CondScanDrawerProps) {
  const isOpen = useDebugStore((s) => s.isCondListOpen);
  const condNodes = useDebugStore((s) => s.condNodes);
  const scanHits = useDebugStore((s) => s.scanHits);
  const txBoundaries = useDebugStore((s) => s.txBoundaries);
  const conditionScanTransactionId = useDebugStore((s) => s.conditionScanTransactionId);
  const storeSync = useDebugStore((s) => s.sync);
  const { closeCondList: close } = useDrawerActions();
  const { appendLeafCondition } = useDebugUiActions();
  const { showPanel } = useFloatingPanel();

  const [categoryId, setCategoryId] = useState<CondCategoryId>("sstore");
  const [condType, setCondType] = useState<PauseConditionType>("sstore_key");
  const [condValue, setCondValue] = useState("");
  const [scanning, setScanning] = useState(false);

  const currentGroup = useMemo(
    () => COND_CATEGORY_GROUPS.find((g) => g.id === categoryId) ?? COND_CATEGORY_GROUPS[0],
    [categoryId],
  );

  const {
    selected,
    mergeOp,
    setMergeOp,
    totalLeaves,
    canMerge,
    topLevelIds,
    handleRemove,
    handleToggleEnabled,
    handleSelect,
    handleMerge,
    clearSelection,
  } = useCondNodeEditor(condNodes);

  const multiTxCount =
    txBoundaries && txBoundaries.length > 0 ? txBoundaries.length + 1 : 0;

  const totalLeavesAdd = condNodes.reduce((sum, n) => {
    const count = (node: CondNode): number =>
      node.kind === "leaf" ? 1 : count(node.left) + count(node.right);
    return sum + count(n);
  }, 0);
  const canAdd = totalLeavesAdd < 3;

  const placeholders: Record<PauseConditionType, string> = {
    sstore_key: "slot key (0x…)",
    sstore_value: "written value (0x…)",
    sload_key: "slot key (0x…)",
    sload_value: "loaded value (0x…)",
    sstore_slot: "slot (0x…)",
    sload_slot: "slot (0x…)",
    call_address: "address (0x…)",
    call_selector: "selector (0x12345678)",
    log_topic: "topic0 (0x…)",
    contract_address: "address (0x…)",
    target_address: "address (0x…)",
    frame_call_address: "address (0x…)",
  };

  const handleAdd = () => {
    const trimmed = condValue.trim();
    if (!trimmed || !canAdd) return;
    if (appendLeafCondition(condNodes, condType, trimmed)) setCondValue("");
  };

  const handleScan = async () => {
    if (disabled || scanning) return;
    setScanning(true);
    try {
      const hits = await onRunConditionScan();
      if (hits.length > 0) {
        const sorted = [...hits].sort((a, b) => a.step_index - b.step_index);
        onSeekTo(sorted[0].step_index);
      }
    } finally {
      setScanning(false);
    }
  };

  const openHitsInFloatingPanel = () => {
    showPanel({
      title: `Scan results (${scanHits.length})`,
      headerTrailing: <ScanHitsJumpControls />,
      children: <ScanHitsList />,
    });
  };

  const prevCondListOpenRef = useRef(false);

  /** 抽屉打开时静默重扫一次 */
  useEffect(() => {
    const justOpened = isOpen && !prevCondListOpenRef.current;
    prevCondListOpenRef.current = isOpen;
    if (!justOpened) return;
    if (disabled || condNodes.length === 0) return;
    let cancelled = false;
    setScanning(true);
    void onRunConditionScan({ silent: true })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setScanning(false);
      });
    return () => {
      cancelled = true;
      setScanning(false);
    };
  }, [isOpen, disabled, condNodes.length, onRunConditionScan]);

  return (
    <BottomSheetShell
      open={isOpen}
      onOpenChange={(o) => {
        if (!o) close();
      }}
      sheetTitle="CondScan"
      defaultHeightVh={48}
      minHeightPx={200}
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
        <div className="flex flex-nowrap items-center gap-x-1 border-b border-border bg-muted/60 px-1.5 py-0.5 text-[10px] shrink-0">
          <ScanSearch className="h-2.5 w-2.5 shrink-0 text-muted-foreground" aria-hidden />
          <span className="shrink-0 font-medium tracking-wide text-foreground">CondScan</span>
          <span className="min-w-0 flex-1 truncate text-[9px] text-muted-foreground">
            Scan trace — click a hit to jump
          </span>
          <SheetClose className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm p-0 opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-secondary">
            <X className="h-2.5 w-2.5" />
            <span className="sr-only">Close</span>
          </SheetClose>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 divide-y border-b border-border md:grid-cols-[3fr_3fr_4fr] md:divide-x md:divide-y-0">
          {/* Left: add condition */}
          <div className="flex min-h-0 flex-col md:min-h-[11rem]">
            <div className="shrink-0 border-b border-border bg-muted/40 px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground">
              Add condition
            </div>
            <div className="flex flex-1 flex-col gap-1.5 overflow-auto p-1.5">
              <div className="flex min-w-0 gap-1">
                <div className="min-w-0 flex-1">
                  <Select
                    value={categoryId}
                    onValueChange={(id) => {
                      const gid = id as CondCategoryId;
                      setCategoryId(gid);
                      const g = COND_CATEGORY_GROUPS.find((x) => x.id === gid);
                      if (g?.variants[0]) setCondType(g.variants[0].type);
                    }}
                  >
                    <SelectTrigger className="h-6 w-full min-w-0 px-1.5 text-[10px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {COND_CATEGORY_GROUPS.map((g) => (
                        <SelectItem key={g.id} value={g.id} className="text-[10px]">
                          {g.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="min-w-0 flex-1">
                  <Select
                    value={condType}
                    onValueChange={(v) => setCondType(v as PauseConditionType)}
                  >
                    <SelectTrigger className="h-6 w-full min-w-0 px-1.5 text-[10px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {currentGroup.variants.map((v) => (
                        <SelectItem key={v.type} value={v.type} className="text-[10px]">
                          {v.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Input
                value={condValue}
                onChange={(e) => setCondValue(e.target.value)}
                placeholder={placeholders[condType]}
                className="h-6 px-2 font-mono text-[10px]"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAdd();
                  }
                }}
              />
              <Button
                type="button"
                size="sm"
                className="h-6 px-2 text-[10px]"
                disabled={!canAdd}
                title={canAdd ? undefined : "Max 3 leaf conditions"}
                onClick={handleAdd}
              >
                + Add
              </Button>
            </div>
          </div>

          {/* Middle: list + merge */}
          <div className="flex min-h-0 flex-col md:min-h-[11rem]">
            <div className="shrink-0 border-b border-border bg-muted/40 px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground">
              Conditions ({totalLeaves} leaves / {condNodes.length} nodes)
            </div>
            {condNodes.length >= 2 && (
              <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border bg-muted/25 px-1.5 py-0.5">
                <span className="text-[9px] text-muted-foreground">Merge 2:</span>
                <button
                  type="button"
                  onClick={() => setMergeOp((v) => (v === "AND" ? "OR" : "AND"))}
                  className={`inline-flex h-4 shrink-0 items-center justify-center rounded border px-1.5 text-[9px] font-mono font-bold ${
                    mergeOp === "AND"
                      ? "border-blue-500/40 bg-blue-500/20 text-blue-400"
                      : "border-orange-500/40 bg-orange-500/20 text-orange-400"
                  }`}
                >
                  {mergeOp}
                </button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-4 px-1.5 text-[9px]"
                  disabled={!canMerge}
                  onClick={handleMerge}
                >
                  Merge
                </Button>
                {selected.size > 0 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-4 px-1.5 text-[9px]"
                    onClick={clearSelection}
                  >
                    Clear sel.
                  </Button>
                )}
              </div>
            )}
            <div className="min-h-0 flex-1 space-y-1 overflow-auto p-1.5">
              {condNodes.length === 0 ? (
                <p className="text-[10px] leading-snug text-muted-foreground">No conditions yet — add on the left.</p>
              ) : (
                condNodes.map((node) => (
                  <CondNodeItem
                    key={node.id}
                    node={node}
                    onRemove={handleRemove}
                    onToggleEnabled={handleToggleEnabled}
                    selected={selected}
                    onSelect={handleSelect}
                    canSelect={topLevelIds.has(node.id) && condNodes.length >= 2}
                  />
                ))
              )}
            </div>
          </div>

          {/* Right: scope + scan + results */}
          <div className="flex min-h-0 flex-col md:min-h-[11rem]">
            <div className="flex shrink-0 items-center justify-between gap-1 border-b border-border bg-muted/40 px-1.5 py-0.5">
              <span className="min-w-0 truncate text-[9px] font-medium text-muted-foreground">
                Scan results ({scanHits.length})
              </span>
              <button
                type="button"
                className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
                disabled={scanHits.length === 0}
                title="Open in floating panel"
                aria-label="Open in floating panel"
                onClick={openHitsInFloatingPanel}
              >
                <PanelTop className="h-3 w-3" aria-hidden />
              </button>
            </div>
            <div className="flex shrink-0 flex-col gap-1.5 border-b border-border p-1.5">
              {multiTxCount > 1 && (
                <div className="flex items-center gap-1.5">
                  <label htmlFor="condscan-tx" className="shrink-0 text-[9px] text-muted-foreground">
                    Scope
                  </label>
                  <select
                    id="condscan-tx"
                    className="h-6 flex-1 rounded border border-border bg-background px-1.5 text-[10px]"
                    value={conditionScanTransactionId === null ? "" : String(conditionScanTransactionId)}
                    onChange={(e) => {
                      const v = e.target.value;
                      storeSync({
                        conditionScanTransactionId: v === "" ? null : Number(v),
                      });
                    }}
                  >
                    <option value="">All transactions</option>
                    {Array.from({ length: multiTxCount }, (_, i) => (
                      <option key={i} value={i}>
                        Tx {i + 1} only
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="flex gap-1.5">
                <Button
                  type="button"
                  className="h-6 flex-1 px-2 text-[10px]"
                  disabled={condNodes.length === 0 || disabled || scanning}
                  onClick={() => void handleScan()}
                >
                  {scanning ? "…" : "Scan"}
                </Button>
                {condNodes.length > 0 && (
                  <Button
                    type="button"
                    variant="outline"
                    className="h-6 flex-1 px-2 text-[10px]"
                    onClick={() => onClearAllConditions()}
                  >
                    Clear all
                  </Button>
                )}
              </div>
            </div>
            <div className="scrollbar-hidden min-h-0 flex-1 overflow-hidden border-t">
              <ScanHitsList />
            </div>
          </div>
        </div>
      </div>
    </BottomSheetShell>
  );
}
