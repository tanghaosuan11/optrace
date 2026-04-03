import { useState, useMemo, useEffect, useRef } from "react";
import { ChevronRight, ChevronDown, Copy, Check, ListTree, PanelTop } from "lucide-react";
import type { CallTreeNode } from "@/lib/types";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import fourbyteDb from "@/lib/fourbyteDb.json";
import { getUserFn } from "@/lib/userFourbyteDb";
import { useDebugStore } from "@/store/debugStore";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useCallTreeAddressLabels, type AddressLabelMap } from "@/hooks/useCallTreeAddressLabels";
import { useCallTreeFilters, type CallTreeFilters } from "@/hooks/useCallTreeFilters";
import { frameTabId } from "@/lib/frameScope";
import { useFloatingPanelBodyRoot } from "@/components/floating-panel/FloatingPanelBodyContext";

/** 默认展开深度 */
const CALLTREE_DEFAULT_DEPTH_LIMIT = 3;

const CALLTREE_FILTER_TOGGLES: { label: string; key: keyof CallTreeFilters; title?: string }[] = [
  { label: "SLOAD", key: "showSload", title: "Show storage load ops" },
  { label: "SSTORE", key: "showSstore", title: "Show storage store ops" },
  { label: "TLOAD", key: "showTload", title: "Show transient load ops" },
  { label: "TSTORE", key: "showTstore", title: "Show transient store ops" },
  { label: "STATIC", key: "showStaticCall", title: "Show STATICCALL frames" },
  { label: "GAS", key: "showGas", title: "Show gas used per frame" },
];

/** 解析 activeTab: `frame-tid-cid` / `frame-cid` */
function parseActiveFrameTab(tab: string | undefined): { tid: number; cid: number } | null {
  if (!tab?.startsWith("frame-")) return null;
  const m = /^frame-(\d+)-(\d+)$/.exec(tab);
  if (m) return { tid: Number(m[1]), cid: Number(m[2]) };
  const legacy = /^frame-(\d+)$/.exec(tab);
  if (legacy) return { tid: 0, cid: Number(legacy[1]) };
  return null;
}

function nodeInScope(n: CallTreeNode, scope: { tid: number; cid: number }): boolean {
  return (n.transactionId ?? 0) === scope.tid && n.contextId === scope.cid;
}

// 更新全局地址高亮样式
const STYLE_ID = "calltree-addr-highlight";
function setGlobalAddrHighlight(addr: string | null) {
  let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!addr) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement("style");
    el.id = STYLE_ID;
    document.head.appendChild(el);
  }
  el.textContent = `[data-addr="${addr}"] { background-color: rgb(251 191 36 / 0.52); border-radius: 3px; }`;
}

const ROW_H = 26;
const GUIDE_COL_W = 20; // width per depth level (vertical guide lines)
const ROW_NUM_W = 36;   // row index column width

interface CallTreeViewerProps {
  onSeekTo?: (index: number) => void;
  onSelectFrame?: (frameId: string) => void;
  onNavigateTo?: (stepIndex: number, frameId: string) => void;
  /** 标题栏右侧显示浮动面板按钮 */
  onOpenInFloating?: () => void;
  /** 在浮动面板内嵌时隐藏该按钮 */
  hideFloatingOpenButton?: boolean;
}

function fullAddr(addr?: string): string {
  if (!addr || addr === '0x0000000000000000000000000000000000000000') return '—';
  return addr;
}

function fullHex(h?: string): string {
  if (!h) return '—';
  const c = h.replace(/^0x/, '');
  return '0x' + (c || '0');
}

function badgeClass(type?: string): string {
  switch (type) {
    case 'delegatecall': return 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-500/15 dark:text-amber-400 dark:border-amber-500/30';
    case 'staticcall':   return 'bg-green-100 text-green-700 border-green-200 dark:bg-green-500/15 dark:text-green-400 dark:border-green-500/30';
    case 'create':
    case 'create2':      return 'bg-purple-100 text-purple-700 border-purple-200 dark:bg-purple-500/15 dark:text-purple-400 dark:border-purple-500/30';
    case 'sstore':       return 'bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-500/15 dark:text-rose-400 dark:border-rose-500/30';
    case 'sload':        return 'bg-pink-100 text-pink-700 border-pink-200 dark:bg-pink-500/15 dark:text-pink-400 dark:border-pink-500/30';
    case 'tstore':       return 'bg-fuchsia-100 text-fuchsia-700 border-fuchsia-200 dark:bg-fuchsia-500/15 dark:text-fuchsia-400 dark:border-fuchsia-500/30';
    case 'tload':        return 'bg-cyan-100 text-cyan-700 border-cyan-200 dark:bg-cyan-500/15 dark:text-cyan-400 dark:border-cyan-500/30';
    case 'log':          return 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-400 dark:border-emerald-500/30';
    default:             return 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-500/15 dark:text-blue-400 dark:border-blue-500/30';
  }
}

function badgeLabel(type?: string, extra?: string | number): string {
  if (type === 'log') return `LOG${extra ?? ''}`;
  return (type ?? 'call').toUpperCase();
}

function OpBadge({ type, depth, extra }: { type?: string; depth: number; extra?: string | number }) {
  return (
    <span className={`inline-flex items-center gap-1 flex-shrink-0 border rounded-sm px-2 py-0.5 leading-none text-[11px] ${badgeClass(type)}`} style={{textDecoration:'none'}}>
      <span className="opacity-60">{depth - 1}</span>
      <svg width="8" height="8" viewBox="0 0 8 8" fill="none" className="opacity-70"><path d="M1 4h6M5 1.5l2.5 2.5L5 6.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
      {badgeLabel(type, extra)}
    </span>
  );
}

function CalldataPopover({ input }: { input: string }) {
  const floatingPortalContainer = useFloatingPanelBodyRoot();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(input);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const hex = input.startsWith('0x') ? input.slice(2) : input;
  const selector = '0x' + hex.slice(0, 8);
  const rest = hex.slice(8);
  const color = { color: 'rgb(80 157 224 / 0.85)', borderColor: 'rgb(80 157 224 / 0.4)' };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <span
          onClick={e => { e.stopPropagation(); setOpen(o => !o); }}
          className="inline-flex items-center font-mono flex-shrink-0 border rounded-sm px-2 py-0.5 leading-none text-[11px] cursor-pointer transition-colors"
          style={color}
        >
          calldata
          <span onClick={handleCopy} className="ml-0.5 opacity-50 hover:opacity-100 transition-opacity">
            {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
          </span>
        </span>
      </PopoverTrigger>
      <PopoverContent
        container={floatingPortalContainer ?? undefined}
        side="bottom"
        align="start"
        sideOffset={4}
        className="w-auto max-w-[560px] p-2 font-mono text-[11px]"
        onOpenAutoFocus={e => e.preventDefault()}
      >
        <div className="flex flex-col gap-px">
          <div><span style={{color:'rgb(80 157 224)'}}>{selector}</span></div>
          {rest && <div><span className="text-foreground/80 break-all">{rest}</span></div>}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function getFnLabel(input?: string, resolvedFns?: Record<string, string>): string | null {
  if (!input) return null;
  const hex = input.startsWith('0x') ? input.slice(2) : input;
  if (hex.length < 8) return null;
  const selector = '0x' + hex.slice(0, 8).toLowerCase();
  const db = fourbyteDb as Record<string, { fn?: string; ev?: string } | null>;
  return db[selector]?.fn ?? getUserFn(selector) ?? resolvedFns?.[selector] ?? ('0x' + hex.slice(0, 8));
}

/** 地址展示文本，优先标签 */
function getAddrDisplay(addr: string | undefined, addressLabels: AddressLabelMap): {
  display: string;
  hasLabel: boolean;
} {
  if (!addr) return { display: '—', hasLabel: false };
  const normalized = addr.toLowerCase();
  const label = addressLabels[normalized];
  if (label) {
    return { display: label.name || label.label, hasLabel: true };
  }
  return { display: fullAddr(addr), hasLabel: false };
}

interface NodeRowProps {
  node: CallTreeNode;
  rowIndex: number | string;
  isCollapsed: boolean;
  isActive: boolean;
  isActiveEvent: boolean;
  hoveredAddr: string | null;
  onHoverAddr: (addr: string | null) => void;
  onToggle: () => void;
  onSeekTo?: (index: number) => void;
  onSelectFrame?: (frameId: string) => void;
  onNavigateTo?: (stepIndex: number, frameId: string) => void;
  showGas: boolean;
  txGasUsed?: bigint;
  resolvedFns: Record<string, string>;
  addressLabels: AddressLabelMap;
}

/** 行号 + 深度导线 */
function RowPrefix({ rowIndex, depth }: { rowIndex: number | string; depth: number }) {
  return (
    <>
      {/* row index */}
      <div
        className="flex-shrink-0 flex items-center justify-end text-muted-foreground/65 border-r border-border/40 pr-1"
        style={{ width: ROW_NUM_W, height: '100%' }}
      >
        {rowIndex}
      </div>
      {/* depth guide columns */}
      {Array.from({ length: depth }, (_, i) => (
        <div
          key={i}
          className="flex-shrink-0 border-r border-border/40"
          style={{ width: GUIDE_COL_W, height: '100%' }}
        />
      ))}
    </>
  );
}

function NodeRow({ node, rowIndex, isCollapsed, isActive, isActiveEvent, hoveredAddr: _hoveredAddr, onHoverAddr, onToggle, onSeekTo, onSelectFrame, onNavigateTo, showGas, txGasUsed, resolvedFns, addressLabels }: NodeRowProps) {
  if (node.type === 'frame') {
    const fnLabel = getFnLabel(node.input, resolvedFns);
    const isCreateType = node.callType === 'create' || node.callType === 'create2';
    const targetAddr = (node.target ?? node.address)?.toLowerCase() ?? null;
    const gasDisplay = node.depth === 1 && txGasUsed != null
      ? Number(txGasUsed)
      : node.gasUsed;
    return (
      <div
        className={`flex items-center h-full cursor-pointer select-none ${
          isActive ? 'bg-primary/10 hover:bg-primary/15' : 'hover:bg-muted/40'
        }`}
        onClick={() => {
          const fid = frameTabId(node.transactionId ?? 0, node.contextId);
          if (onNavigateTo) {
            onNavigateTo(node.stepIndex, fid);
          } else {
            onSelectFrame?.(fid);
            onSeekTo?.(node.stepIndex);
          }
        }}
      >
        <RowPrefix rowIndex={rowIndex} depth={node.depth} />
        {/* toggle */}
        <span
          className="flex-shrink-0 w-[14px] h-full flex items-center justify-center text-muted-foreground hover:text-foreground border-r border-border/40"
          onClick={e => { e.stopPropagation(); onToggle(); }}
        >
          {isCollapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </span>
        {/* content */}
        <div className="flex items-center gap-1.5 px-1.5 min-w-0">
          <OpBadge type={node.callType} depth={node.depth} />
          {showGas && gasDisplay != null && (
            <span className="inline-flex items-center font-mono flex-shrink-0 border border-muted-foreground/50 rounded-sm px-2 py-0.5 leading-none text-[11px] text-muted-foreground">
              {gasDisplay.toLocaleString()}
            </span>
          )}
          {targetAddr && targetAddr !== '0x0000000000000000000000000000000000000000' ? (
            <span
              className="inline-flex items-center font-mono font-semibold flex-shrink-0 border rounded-sm px-2 py-0.5 leading-none text-[11px] cursor-default"
              style={{color:'rgb(37 131 224)', borderColor:'rgb(20 90 160 / 0.4)'}}
              data-addr={targetAddr}
              onMouseEnter={() => onHoverAddr(targetAddr)}
              onMouseLeave={() => onHoverAddr(null)}
            >
              {getAddrDisplay(node.target ?? node.address, addressLabels).display}
            </span>
          ) : (
            <span className="inline-flex items-center font-mono font-semibold flex-shrink-0 border rounded-sm px-2 py-0.5 leading-none text-[11px]" style={{color:'rgb(20 90 160)', borderColor:'rgb(20 90 160 / 0.4)'}}>
              {getAddrDisplay(node.target ?? node.address, addressLabels).display}
            </span>
          )}
          {!isCreateType && fnLabel && (
            <span className="inline-flex items-center font-mono flex-shrink-0 border border-foreground/20 rounded-sm px-2 py-0.5 leading-none text-[11px]" style={{color:'rgb(255 118 35)', borderColor:'rgb(255 118 35 / 0.3)'}}>
              {fnLabel}
            </span>
          )}
          {!isCreateType && node.input && node.input.replace(/^0x/, '').length >= 8 && (
            <CalldataPopover input={node.input} />
          )}
          {node.selfdestructTarget ? (
            <span className="flex-shrink-0 text-[9px] font-bold text-orange-300 bg-orange-400/10 px-1 rounded ml-0.5">
              💀 SELFDESTRUCT → {node.selfdestructTarget.slice(0, 6)}…{node.selfdestructTarget.slice(-4)}
              {node.selfdestructValue && node.selfdestructValue !== '0' && (
                <span className="ml-1 text-yellow-300">({node.selfdestructValue} wei)</span>
              )}
            </span>
          ) : node.success === true ? (
            <span className="flex-shrink-0 text-[9px] font-bold text-green-400 bg-green-400/10 px-1 rounded ml-0.5">✓</span>
          ) : node.success === false ? (
            <span className="flex-shrink-0 text-[9px] font-bold text-red-400 bg-red-400/10 px-1 rounded ml-0.5">✗ REVERT</span>
          ) : null}
        </div>
      </div>
    );
  }

  if (node.type === 'sstore') {
    return (
      <div
        className={`flex items-center h-full cursor-pointer select-none ${node.reverted ? 'text-orange-400/40' : 'text-orange-500'} ${isActiveEvent ? 'bg-amber-400/10 border-l-2 border-l-amber-400' : 'hover:bg-muted/40'}`}
        onClick={() => onSeekTo?.(node.stepIndex)}
      >
        <RowPrefix rowIndex={rowIndex} depth={node.depth} />
        <span className="flex-shrink-0 w-[14px] h-full border-r border-border/40" />
        <div className={`flex items-center gap-1.5 px-1.5 min-w-0 ${node.reverted ? 'line-through decoration-red-400/60' : ''}`}>
          {node.reverted && <span className="no-underline line-through-none text-red-400/80 flex-shrink-0" style={{textDecoration:'none'}}>✗</span>}
          <OpBadge type="sstore" depth={node.depth} />
          <span className="inline-flex items-center font-mono flex-shrink-0 border border-foreground/20 rounded-sm px-2 py-0.5 leading-none text-[11px] text-foreground/75">[{fullHex(node.slot)}]</span>
          <span className="text-muted-foreground/70 flex-shrink-0">:</span>
          <span className="inline-flex items-center font-mono flex-shrink-0 border border-foreground/20 rounded-sm px-2 py-0.5 leading-none text-[11px] text-foreground/75">{fullHex(node.oldValue)}</span>
          <span className="text-muted-foreground/70 flex-shrink-0">→</span>
          <span className="inline-flex items-center font-mono flex-shrink-0 border border-foreground/20 rounded-sm px-2 py-0.5 leading-none text-[11px] text-foreground/75">{fullHex(node.newValue)}</span>
        </div>
      </div>
    );
  }

  if (node.type === 'tstore') {
    return (
      <div
        className={`flex items-center h-full cursor-pointer select-none ${node.reverted ? 'text-fuchsia-400/40' : 'text-fuchsia-600'} ${isActiveEvent ? 'bg-amber-400/10 border-l-2 border-l-amber-400' : 'hover:bg-muted/40'}`}
        onClick={() => onSeekTo?.(node.stepIndex)}
      >
        <RowPrefix rowIndex={rowIndex} depth={node.depth} />
        <span className="flex-shrink-0 w-[14px] h-full border-r border-border/40" />
        <div className={`flex items-center gap-1.5 px-1.5 min-w-0 ${node.reverted ? 'line-through decoration-red-400/60' : ''}`}>
          {node.reverted && <span className="no-underline line-through-none text-red-400/80 flex-shrink-0" style={{textDecoration:'none'}}>✗</span>}
          <OpBadge type="tstore" depth={node.depth} />
          <span className="inline-flex items-center font-mono flex-shrink-0 border border-foreground/20 rounded-sm px-2 py-0.5 leading-none text-[11px] text-foreground/75">[{fullHex(node.slot)}]</span>
          <span className="text-muted-foreground/70 flex-shrink-0">:</span>
          <span className="inline-flex items-center font-mono flex-shrink-0 border border-foreground/20 rounded-sm px-2 py-0.5 leading-none text-[11px] text-foreground/75">{fullHex(node.oldValue)}</span>
          <span className="text-muted-foreground/70 flex-shrink-0">→</span>
          <span className="inline-flex items-center font-mono flex-shrink-0 border border-foreground/20 rounded-sm px-2 py-0.5 leading-none text-[11px] text-foreground/75">{fullHex(node.newValue)}</span>
        </div>
      </div>
    );
  }

  if (node.type === 'tload') {
    return (
      <div
        className={`flex items-center h-full text-cyan-600 cursor-pointer select-none ${isActiveEvent ? 'bg-amber-400/10 border-l-2 border-l-amber-400' : 'hover:bg-muted/40'}`}
        onClick={() => onSeekTo?.(node.stepIndex)}
      >
        <RowPrefix rowIndex={rowIndex} depth={node.depth} />
        <span className="flex-shrink-0 w-[14px] h-full border-r border-border/40" />
        <div className="flex items-center gap-1.5 px-1.5 min-w-0">
          <OpBadge type="tload" depth={node.depth} />
          <span className="inline-flex items-center font-mono flex-shrink-0 border border-foreground/20 rounded-sm px-2 py-0.5 leading-none text-[11px] text-foreground/75">{fullHex(node.slot)}</span>
        </div>
      </div>
    );
  }

  if (node.type === 'sload') {
    return (
      <div
        className={`flex items-center h-full text-slate-500 cursor-pointer select-none ${isActiveEvent ? 'bg-amber-400/10 border-l-2 border-l-amber-400' : 'hover:bg-muted/40'}`}
        onClick={() => onSeekTo?.(node.stepIndex)}
      >
        <RowPrefix rowIndex={rowIndex} depth={node.depth} />
        <span className="flex-shrink-0 w-[14px] h-full border-r border-border/40" />
        <div className="flex items-center gap-1.5 px-1.5 min-w-0">
          <OpBadge type="sload" depth={node.depth} />
          <span className="inline-flex items-center font-mono flex-shrink-0 border border-foreground/20 rounded-sm px-2 py-0.5 leading-none text-[11px] text-foreground/75">[{fullHex(node.slot)}]</span>
          {node.oldValue != null && (
            <>
              <span className="text-muted-foreground/70 flex-shrink-0">:</span>
              <span className="inline-flex items-center font-mono flex-shrink-0 border border-foreground/20 rounded-sm px-2 py-0.5 leading-none text-[11px] text-foreground/75">{fullHex(node.oldValue)}</span>
            </>
          )}
        </div>
      </div>
    );
  }

  // log
  const topicCount = node.topics?.length ?? 0;
  const topic0 = node.topics?.[0];
  return (
    <div
      className={`flex items-center h-full cursor-pointer select-none ${node.reverted ? 'text-violet-400/40' : 'text-violet-500'} ${isActiveEvent ? 'bg-amber-400/10 border-l-2 border-l-amber-400' : 'hover:bg-muted/40'}`}
      onClick={() => onSeekTo?.(node.stepIndex)}
    >
      <RowPrefix rowIndex={rowIndex} depth={node.depth} />
      <span className="flex-shrink-0 w-[14px] h-full border-r border-border/40" />
      <div className={`flex items-center gap-1.5 px-1.5 min-w-0 ${node.reverted ? 'line-through decoration-red-400/60' : ''}`}>
        {node.reverted && <span className="text-red-400/80 flex-shrink-0" style={{textDecoration:'none'}}>✗</span>}
          <OpBadge type="log" depth={node.depth} extra={topicCount} />
        {topic0 && <span className="inline-flex items-center font-mono flex-shrink-0 border border-foreground/20 rounded-sm px-2 py-0.5 leading-none text-[11px] text-foreground/75">{fullHex(topic0)}</span>}
      </div>
    </div>
  );
}

function getVisibleNodes(nodes: CallTreeNode[], collapsed: Set<number>): CallTreeNode[] {
  const result: CallTreeNode[] = [];
  let hiddenDepth = Infinity;
  for (const node of nodes) {
    if (node.depth > hiddenDepth) continue;
    hiddenDepth = Infinity;
    result.push(node);
    if (node.type === 'frame' && collapsed.has(node.id)) {
      hiddenDepth = node.depth;
    }
  }
  return result;
}

export function CallTreeViewer({
  onSeekTo,
  onSelectFrame,
  onNavigateTo,
  onOpenInFloating,
  hideFloatingOpenButton = false,
}: CallTreeViewerProps) {
  const nodes = useDebugStore((s) => s.callTreeNodes);
  const activeTab = useDebugStore((s) => s.activeTab);
  const currentStepIndex = useDebugStore((s) => s.currentStepIndex);
  const txGasUsed = useDebugStore((s) => s.txData?.gasUsed);
  const chainId = useDebugStore((s) => s.currentDebugChainId);

  // 地址标签
  const { labels: addressLabels } = useCallTreeAddressLabels(nodes, chainId);

  // CallTree 过滤器（持久化）
  const { filters, updateFilter } = useCallTreeFilters();
  
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [hoveredAddr, setHoveredAddr] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerHeight, setContainerHeight] = useState(300);
  const [scrollTop, setScrollTop] = useState(0);
  const scrollToScopeRef = useRef<{ tid: number; cid: number } | null>(null);

  // fourbyte 解析结果
  const resolvedFns = useDebugStore((s) => s.resolvedFnCache);
  const floatingPortalContainer = useFloatingPanelBodyRoot();

  const handleHoverAddr = (addr: string | null) => {
    setHoveredAddr(addr);
    setGlobalAddrHighlight(addr);
  };

  useEffect(() => {
    return () => setGlobalAddrHighlight(null);
  }, []);

  const activeScope = useMemo(() => parseActiveFrameTab(activeTab), [activeTab]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(entries => {
      setContainerHeight(entries[0].contentRect.height);
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const filtered = useMemo(() => {
    let result = nodes;
    if (!filters.showSload) result = result.filter(n => n.type !== 'sload');
    if (!filters.showSstore) result = result.filter(n => n.type !== 'sstore');
    if (!filters.showTload) result = result.filter(n => n.type !== 'tload');
    if (!filters.showTstore) result = result.filter(n => n.type !== 'tstore');
    if (!filters.showStaticCall) result = result.filter(n => !(n.type === 'frame' && n.callType === 'staticcall'));
    return result;
  }, [nodes, filters]);

  const visible = useMemo(() => getVisibleNodes(filtered, collapsed), [filtered, collapsed]);

  const maxTreeDepth = useMemo(
    () => (nodes.length === 0 ? 0 : Math.max(...nodes.map((n) => n.depth))),
    [nodes],
  );

  /** `default` 使用默认深度；否则使用指定深度 */
  const [depthSelection, setDepthSelection] = useState<"default" | number>("default");

  const effectiveDepthLimit =
    depthSelection === "default" ? CALLTREE_DEFAULT_DEPTH_LIMIT : depthSelection;

  useEffect(() => {
    if (nodes.length === 0) return;
    const limit = effectiveDepthLimit;
    setCollapsed(
      new Set(nodes.filter((n) => n.type === "frame" && n.depth > limit).map((n) => n.id)),
    );
  }, [nodes, maxTreeDepth, effectiveDepthLimit]);

  // 当前 frame 内最近的事件节点
  const activeEventNode = useMemo(() => {
    if (currentStepIndex < 0 || activeScope == null) return null;
    let last: CallTreeNode | null = null;
    for (const n of filtered) {
      if (n.type === 'frame') continue;
      if (!nodeInScope(n, activeScope)) continue;
      if (n.stepIndex > currentStepIndex) break;
      last = n;
    }
    return last;
  }, [filtered, currentStepIndex, activeScope]);

  // 活动事件变化时滚动到可见区域
  useEffect(() => {
    if (!activeEventNode) return;
    const idx = visible.findIndex(n => n.id === activeEventNode.id);
    if (idx === -1) return;
    const el = containerRef.current;
    if (!el) return;
    const targetTop = idx * ROW_H;
    const targetBottom = targetTop + ROW_H;
    if (targetTop < el.scrollTop || targetBottom > el.scrollTop + el.clientHeight) {
      el.scrollTop = Math.max(0, targetTop - el.clientHeight / 2 + ROW_H / 2);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeEventNode]);

  // 切换 active frame 时展开祖先节点
  useEffect(() => {
    if (activeScope == null || nodes.length === 0) return;
    const targetNode = nodes.find(n => n.type === 'frame' && nodeInScope(n, activeScope));
    if (!targetNode) return;
    scrollToScopeRef.current = { ...activeScope };
    setCollapsed(prev => {
      const stack: { id: number; depth: number }[] = [];
      for (const n of nodes) {
        if (n.type === 'frame' && nodeInScope(n, activeScope)) break;
        if (n.type === 'frame') {
          while (stack.length > 0 && stack[stack.length - 1].depth >= n.depth) stack.pop();
          stack.push({ id: n.id, depth: n.depth });
        }
      }
      const next = new Set(prev);
      let changed = false;
      for (const { id } of stack) {
        if (next.has(id)) { next.delete(id); changed = true; }
      }
      return changed ? next : prev;
    });
  }, [activeScope, nodes]);

  // 祖先展开后再滚动到目标节点
  useEffect(() => {
    const scope = scrollToScopeRef.current;
    if (scope == null) return;
    const idx = visible.findIndex(n => n.type === 'frame' && nodeInScope(n, scope));
    if (idx === -1) return;
    scrollToScopeRef.current = null;
    const el = containerRef.current;
    if (!el) return;
    el.scrollTop = Math.max(0, idx * ROW_H - el.clientHeight / 2 + ROW_H / 2);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const startIdx = Math.max(0, Math.floor(scrollTop / ROW_H) - 2);
  const endIdx = Math.min(visible.length, startIdx + Math.ceil(containerHeight / ROW_H) + 5);

  const toggleCollapse = (id: number) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  if (nodes.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        尚未构建 Call Tree
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      {/* toolbar */}
      <div className="flex min-h-0 flex-nowrap items-center gap-x-1.5 overflow-x-auto border-b border-border bg-muted/60 px-2 py-1 text-[11px] flex-shrink-0">
        <ListTree className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
        <span className="shrink-0 text-[11px] font-semibold tracking-wide text-foreground">Call Tree</span>
        <span className="shrink-0 text-[10px] font-medium text-muted-foreground">expand</span>
        <Select
          value={depthSelection === "default" ? "default" : String(depthSelection)}
          onValueChange={(v) => {
            if (v === "default") {
              setDepthSelection("default");
              return;
            }
            const N = Number.parseInt(v, 10);
            if (Number.isNaN(N)) return;
            setDepthSelection(N);
          }}
        >
          <SelectTrigger
            className="h-5 w-fit min-w-[4.5rem] shrink-0 gap-1 rounded border px-1.5 py-0 text-[11px] leading-none shadow-none [&_svg]:h-2.5 [&_svg]:w-2.5 [&_svg]:shrink-0"
            aria-label="Expand depth"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent
            container={floatingPortalContainer ?? undefined}
            position="popper"
            side="bottom"
            align="start"
            sideOffset={2}
            className="max-h-[min(9rem,var(--radix-select-content-available-height))] w-[var(--radix-select-trigger-width)] min-w-[var(--radix-select-trigger-width)]"
          >
            <SelectItem value="default" className="py-1 pl-2 pr-8 text-xs">
              default
            </SelectItem>
            {Array.from({ length: maxTreeDepth + 1 }, (_, i) => (
              <SelectItem key={i} value={String(i)} className="py-1 pl-2 pr-8 font-mono text-xs">
                {i}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex flex-nowrap items-center gap-x-2">
          {CALLTREE_FILTER_TOGGLES.map(({ label, key, title }) => (
            <div key={key} className="flex shrink-0 items-center gap-1">
              <Checkbox
                id={`calltree-filter-${key}`}
                checked={filters[key]}
                onCheckedChange={(v) => updateFilter(key, v === true)}
                className="h-3 w-3"
                title={title}
              />
              <Label
                htmlFor={`calltree-filter-${key}`}
                className="cursor-pointer select-none font-mono text-[10px] font-normal text-muted-foreground leading-none peer-disabled:cursor-not-allowed"
              >
                {label}
              </Label>
            </div>
          ))}
        </div>
        {onOpenInFloating && !hideFloatingOpenButton ? (
          <div className="ml-auto flex shrink-0 items-center">
            <button
              type="button"
              className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
              title="Open in floating panel"
              aria-label="Open in floating panel"
              onClick={onOpenInFloating}
            >
              <PanelTop className="h-3 w-3" aria-hidden />
            </button>
          </div>
        ) : null}
      </div>

      {/* virtual list */}
      <div
        ref={containerRef}
        className="flex-1 overflow-auto font-mono text-[12px]"
        onScroll={e => setScrollTop(e.currentTarget.scrollTop)}
      >
        <div style={{ height: visible.length * ROW_H, position: 'relative' }}>
          {visible.slice(startIdx, endIdx).map((node, i) => (
            <div
              key={node.id}
              style={{
                position: 'absolute',
                top: (startIdx + i) * ROW_H,
                height: ROW_H,
                left: 0,
                right: 0,
              }}
            >
              <NodeRow
                node={node}
                rowIndex={node.id}
                isCollapsed={collapsed.has(node.id)}
                isActive={node.type === 'frame' && activeScope != null && nodeInScope(node, activeScope)}
                isActiveEvent={node.id === activeEventNode?.id}
                hoveredAddr={hoveredAddr}
                onHoverAddr={handleHoverAddr}
                onToggle={() => toggleCollapse(node.id)}
                onSeekTo={onSeekTo}
                onSelectFrame={onSelectFrame}
                onNavigateTo={onNavigateTo}
                showGas={filters.showGas}
                txGasUsed={txGasUsed}
                resolvedFns={resolvedFns}
                addressLabels={addressLabels}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
