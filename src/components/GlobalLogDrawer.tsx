import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { BottomSheetShell } from "@/components/ui/bottom-sheet-shell";
import { SheetClose } from "@/components/ui/sheet";
import { useDebugStore } from "@/store/debugStore";
import { useDrawerActions } from "@/hooks/useDrawerActions";
import { useLogAddressLabels } from "@/hooks/useCallTreeAddressLabels";
import { getEvLocal, lookupSignature4Byte, decodeLogEntry } from "@/lib/fourbyteUtils";
import { toast } from "sonner";
import { Search, Loader2, ExternalLink, ScrollText, X } from "lucide-react";

interface GlobalLogEntry {
  address: string;
  topics: string[];
  data: string;
  stepIndex: number;
  contextId: number;
  frameAddress: string;
  transactionId?: number;
}

interface Props {
  onSeekTo?: (index: number) => void;
}

async function openScanAddress(scanUrl: string, address: string) {
  try {
    const base = scanUrl.replace(/\/$/, '');
    const url = `${base}/address/${address}`;
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(url);
  } catch {
    // fallback: window.open (web mode)
    window.open(`${scanUrl.replace(/\/$/, '')}/address/${address}`, '_blank', 'noopener');
  }
}

// Colour stripe per log index (cycles through 5 colours like Etherscan)
const STRIPE_COLORS = [
  'bg-blue-500',
  'bg-violet-500',
  'bg-emerald-500',
  'bg-amber-500',
  'bg-rose-500',
];

/** 稳定引用，避免 `isOpen ? allLogs : []` 每次渲染新 [] 导致 useLogAddressLabels 死循环 */
const EMPTY_LOG_ENTRIES: GlobalLogEntry[] = [];

export function GlobalLogDrawer({ onSeekTo }: Props) {
  const isOpen = useDebugStore((s) => s.isLogDrawerOpen);
  const { closeLog } = useDrawerActions();
  const callFrames = useDebugStore((s) => s.callFrames);
  const txBoundaries = useDebugStore((s) => s.txBoundaries);
  const scanUrl = useDebugStore((s) => s.config.scanUrl);
  const chainId = useDebugStore((s) => s.currentDebugChainId);
  const showLogTxColumn = Boolean(txBoundaries && txBoundaries.length > 0);

  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  const scrollElRef = useRef<HTMLDivElement | null>(null);
  const parentRef = useCallback((el: HTMLDivElement | null) => {
    scrollElRef.current = el;
    setScrollEl(el);
  }, []);
  const [resolvedEvents, setResolvedEvents] = useState<Record<string, string>>({});
  const [lookingUp, setLookingUp] = useState<string | null>(null);
  const attemptedRef = useRef<Set<string>>(new Set());

  const allLogs = useMemo<GlobalLogEntry[]>(() =>
    callFrames
      .flatMap(f => f.logs.map(l => ({
        ...l,
        contextId: f.contextId,
        frameAddress: f.address ?? '',
        transactionId: l.transactionId,
      })))
      .sort((a, b) => a.stepIndex - b.stepIndex),
    [callFrames]
  );

  const logsForAddressLabels = useMemo(
    () => (isOpen ? allLogs : EMPTY_LOG_ENTRIES),
    [isOpen, allLogs],
  );
  const { labels: addressLabels } = useLogAddressLabels(
    logsForAddressLabels,
    chainId,
  );

  useEffect(() => {
    if (!isOpen || allLogs.length === 0) return;
    const seen = new Set<string>();
    for (const log of allLogs) {
      const t0 = log.topics[0];
      if (t0 && !seen.has(t0) && !resolvedEvents[t0] && !getEvLocal(t0) && !attemptedRef.current.has(t0)) {
        seen.add(t0);
        attemptedRef.current.add(t0);
        lookupSignature4Byte(t0)
          .then(({ ev }) => { if (ev) setResolvedEvents(prev => ({ ...prev, [t0]: ev })); })
          .catch(() => {});
      }
    }
  }, [isOpen, allLogs]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleEventLookup(topic0: string) {
    if (lookingUp) return;
    setLookingUp(topic0);
    try {
      const { ev } = await lookupSignature4Byte(topic0);
      if (ev) setResolvedEvents(prev => ({ ...prev, [topic0]: ev }));
      else toast.error('No matching event signature found');
    } catch {
      toast.error('Lookup failed');
    } finally {
      setLookingUp(null);
    }
  }

  // 等容器布局稳定后再交给 virtualizer 渲染，避免 Sheet 动画期间定位错乱
  const [virtualizerReady, setVirtualizerReady] = useState(false);
  useEffect(() => {
    if (!isOpen) { setVirtualizerReady(false); return; }
    // double-rAF: 等 CSS 动画完成首帧、容器尺寸真正稳定
    const id1 = requestAnimationFrame(() => {
      const id2 = requestAnimationFrame(() => { setVirtualizerReady(true); });
      return () => cancelAnimationFrame(id2);
    });
    return () => cancelAnimationFrame(id1);
  }, [isOpen]);

  const logsPerRow = 2;
  const rowCount = Math.ceil(allLogs.length / logsPerRow);

  const virtualizer = useVirtualizer({
    count: virtualizerReady ? rowCount : 0,
    getScrollElement: () => scrollElRef.current,
    estimateSize: () => 96,
    overscan: 5,
  });

  useEffect(() => {
    if (!scrollEl) return;
    virtualizer.measure();
    const ro = new ResizeObserver(() => { virtualizer.measure(); });
    ro.observe(scrollEl);
    return () => ro.disconnect();
  }, [scrollEl]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { virtualizer.measure(); }, [resolvedEvents, addressLabels]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <BottomSheetShell
      open={isOpen}
      onOpenChange={(o) => { if (!o) closeLog(); }}
      sheetTitle="All Logs"
      defaultHeightVh={55}
    >
        <div className="flex flex-nowrap items-center justify-between gap-x-1.5 border-b border-border bg-muted/60 px-2 py-1 text-[11px] shrink-0">
          <div className="flex min-w-0 items-center gap-1.5">
            <ScrollText className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
            <span className="shrink-0 font-semibold tracking-wide text-foreground">Event Logs</span>
            <span className="inline-flex h-5 shrink-0 items-center justify-center rounded border border-border bg-muted px-1.5 font-mono text-[10px] tabular-nums leading-tight text-muted-foreground">
              {allLogs.length}
            </span>
          </div>
          <SheetClose className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-secondary">
            <X className="h-3 w-3" />
            <span className="sr-only">Close</span>
          </SheetClose>
        </div>

        <div
          ref={parentRef}
          className="flex-1 min-h-0 overflow-auto"
          data-keyboard-scroll-root="logs"
        >
          {allLogs.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground text-sm">No logs emitted</div>
          ) : (
            <div style={{ height: `${virtualizer.getTotalSize()}px`, width: "100%", position: "relative" }}>
              {virtualizer.getVirtualItems().map((vRow) => {
                const leftIdx = vRow.index * logsPerRow;
                const pair = allLogs.slice(leftIdx, leftIdx + logsPerRow);
                return (
                  <div
                    key={vRow.index}
                    ref={virtualizer.measureElement}
                    data-index={vRow.index}
                    style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${vRow.start}px)` }}
                    className="border-b border-border/50"
                  >
                    <div className="grid grid-cols-2 gap-x-1 gap-y-2 px-1.5 py-1">
                      {pair.map((log, idxInRow) => {
                        const logNum = leftIdx + idxInRow;
                        const topic0 = log.topics[0];
                        const evName = topic0 ? (resolvedEvents[topic0] ?? getEvLocal(topic0)) : undefined;
                        const decoded = evName ? decodeLogEntry(evName, log.topics, log.data) : null;
                        const contractAddr = log.address || log.frameAddress;
                        const addrLabelItem = addressLabels[contractAddr.trim().toLowerCase()];
                        const addrLabelText =
                          addrLabelItem && (addrLabelItem.name || addrLabelItem.label || "").trim();
                        const stripe = STRIPE_COLORS[logNum % STRIPE_COLORS.length];
                        const indexedArgs = decoded?.args.filter(a => a.indexed) ?? [];
                        const nonIndexedArgs = decoded?.args.filter(a => !a.indexed) ?? [];
                        return (
                          <div key={logNum} className="min-w-0 rounded border border-border/50 bg-muted/10">
                            <div className="flex min-h-0">
                              <div className={`w-0.5 flex-shrink-0 rounded-l ${stripe}`} />
                              <div className="flex-shrink-0 w-6 flex items-center justify-center py-0.5">
                                <span className="text-[9px] font-mono text-muted-foreground tabular-nums leading-none">{logNum}</span>
                              </div>
                              <div className="flex-1 min-w-0 py-0.5 pr-1 font-mono text-[10px] leading-tight">
                                {/* 左列：地址紧贴事件/topics；右列仅 frame/step，避免把事件名顶到地址下方很远 */}
                                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-1 gap-y-0">
                                  <div className="min-w-0 flex flex-col gap-0">
                                    <div className="flex flex-wrap items-center gap-x-1 gap-y-0.5">
                                      <span
                                        className="text-sky-500 hover:text-sky-300 cursor-pointer transition-colors break-all inline-flex flex-wrap items-center gap-0.5"
                                        title={`Open ${contractAddr} in explorer`}
                                        onClick={() => openScanAddress(scanUrl, contractAddr)}
                                      >
                                        {contractAddr}
                                        <ExternalLink className="h-2.5 w-2.5 opacity-60 shrink-0 self-center" />
                                      </span>
                                      {addrLabelText ? (
                                        <span
                                          className="inline-flex items-center font-mono flex-shrink-0 rounded-sm border border-border/70 bg-muted/40 px-1 py-0 leading-none text-[9px] text-foreground"
                                          title={addrLabelText}
                                        >
                                          {addrLabelText}
                                        </span>
                                      ) : null}
                                    </div>

                                <div className="space-y-0 min-w-0 mt-0">
                                  {evName ? (
                                    <span className="text-violet-600 dark:text-violet-300 font-medium break-all leading-tight block">{evName}</span>
                                  ) : topic0 ? (
                                    <div className="flex items-center gap-1">
                                      <span className="text-muted-foreground/60 italic text-[10px]">Unknown</span>
                                      <button
                                        className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground border border-border rounded px-1 py-0 transition-colors disabled:opacity-40"
                                        onClick={() => handleEventLookup(topic0)}
                                        disabled={lookingUp === topic0}
                                      >
                                        {lookingUp === topic0 ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Search className="h-2.5 w-2.5" />}
                                      </button>
                                    </div>
                                  ) : (
                                    <span className="text-muted-foreground/50 italic text-[10px]">Anonymous</span>
                                  )}

                                {log.topics.length > 0 && (
                                  <div className="min-w-0">
                                    <div className="flex flex-col gap-0 min-w-0">
                                      {log.topics.map((topic, ti) => {
                                        const isSignature = ti === 0;
                                        const indexedArg = !isSignature ? indexedArgs[ti - 1] : undefined;
                                        return (
                                          <div key={ti} className="flex items-baseline gap-1 min-w-0 leading-tight py-px">
                                            <span className="text-[9px] text-muted-foreground/60 flex-shrink-0 w-3.5 text-right">[{ti}]</span>
                                            {isSignature ? (
                                              <span className="text-foreground break-all">{topic}</span>
                                            ) : indexedArg ? (
                                              <span className="min-w-0 break-all">
                                                <span className="text-foreground break-all">{indexedArg.value}</span>
                                                <span className="text-muted-foreground/50 ml-1 text-[10px]">{indexedArg.type}</span>
                                              </span>
                                            ) : (
                                              <span className="text-foreground break-all">{topic}</span>
                                            )}
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                )}

                                {nonIndexedArgs.length > 0 ? (
                                  <div className="min-w-0">
                                    <div className="flex flex-col gap-0 min-w-0">
                                      {nonIndexedArgs.map((arg, i) => (
                                        <div key={i} className="flex items-baseline gap-1 min-w-0 leading-tight py-px">
                                          <span className="text-[9px] text-muted-foreground/60 flex-shrink-0 w-3.5 text-right">[{i}]</span>
                                          <span className="text-foreground break-all">{arg.value}</span>
                                          <span className="text-muted-foreground/50 text-[10px]">{arg.type}</span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                ) : log.data && log.data !== '0x' ? (
                                  <div className="min-w-0">
                                    <span className="text-foreground break-all">{log.data}</span>
                                  </div>
                                ) : null}
                                </div>
                                  </div>

                                  <div className="flex flex-col items-end gap-px shrink-0 self-start text-right leading-tight pl-0.5">
                                    <span className="text-[9px] text-muted-foreground/80 tabular-nums whitespace-nowrap">
                                      {showLogTxColumn && log.transactionId !== undefined
                                        ? `Tx${log.transactionId + 1}#${log.contextId}`
                                        : `F${log.contextId}`}
                                    </span>
                                    {onSeekTo ? (
                                      <span
                                        className="text-[9px] font-mono text-blue-500 hover:text-blue-300 cursor-pointer transition-colors tabular-nums whitespace-nowrap"
                                        onClick={() => onSeekTo(log.stepIndex)}
                                        title={`Seek to step ${log.stepIndex}`}
                                      >
                                        step {log.stepIndex}
                                      </span>
                                    ) : null}
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
    </BottomSheetShell>
  );
}
