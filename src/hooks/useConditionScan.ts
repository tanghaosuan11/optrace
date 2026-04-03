import { useRef, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { useDebugStore } from "@/store/debugStore";
import { rebuildConditionHitSet, type ScanHit } from "@/lib/pauseConditions";

export type RunConditionScanOptions = {
  /** 抽屉自动刷新时不弹成功提示 */
  silent?: boolean;
};

export function useConditionScan(
  conditionHitSetRef: React.RefObject<Set<number>>,
) {
  const storeSync = useDebugStore.getState().sync;
  const isDebugging = useDebugStore((s) => s.isDebugging);
  const condNodeCount = useDebugStore((s) => s.condNodes.length);
  const sessionId = useDebugStore((s) => s.sessionId);
  const conditionScanTransactionId = useDebugStore((s) => s.conditionScanTransactionId);

  const clearConditionHits = useCallback(() => {
    const empty = new Set<number>();
    conditionHitSetRef.current = empty;
    storeSync({ conditionHitSet: empty, scanHits: [] });
  }, [conditionHitSetRef, storeSync]);

  const scanAndSync = useCallback(
    (
      tag: string,
      onError?: (err: unknown) => void,
      options?: RunConditionScanOptions,
    ): Promise<ScanHit[]> => {
      const { stepCount, condNodes } = useDebugStore.getState();
      if (stepCount === 0 || condNodes.length === 0) {
        clearConditionHits();
        return Promise.resolve([]);
      }
      const t0 = performance.now();
      return rebuildConditionHitSet(condNodes, sessionId, conditionScanTransactionId)
        .then(({ hitSet, hits }) => {
          const t1 = performance.now();
          conditionHitSetRef.current = hitSet;
          storeSync({ conditionHitSet: hitSet, scanHits: hits });
          console.log(
            `[ConditionScan${tag}] ${condNodes.length} nodes → ${hits.length} hits | ${(t1 - t0).toFixed(1)}ms`,
          );
          if (!options?.silent) {
            toast.success(`Scan complete — ${hits.length} hit(s)`, { duration: 2500 });
          }
          return hits;
        })
        .catch((err: unknown) => {
          if (onError) {
            onError(err);
            return [];
          }
          console.error("[ConditionScan] failed:", err);
          toast.error("Scan failed");
          throw err;
        });
    },
    [clearConditionHits, conditionHitSetRef, storeSync, sessionId, conditionScanTransactionId],
  );

  const runConditionScan = useCallback((options?: RunConditionScanOptions): Promise<ScanHit[]> => {
    return scanAndSync("", undefined, options);
  }, [scanAndSync]);

  const clearAllConditions = useCallback(() => {
    storeSync({ condNodes: [] });
    clearConditionHits();
  }, [storeSync, clearConditionHits]);

  const prevIsDebuggingRef = useRef(false);
  useEffect(() => {
    const justFinished = prevIsDebuggingRef.current && !isDebugging;
    prevIsDebuggingRef.current = isDebugging;
    if (!justFinished) return;
    let cancelled = false;
    void scanAndSync(" auto", (err) => {
      if (!cancelled) console.error("[ConditionScan] failed:", err);
    });
    return () => {
      cancelled = true;
    };
  }, [isDebugging, scanAndSync]);

  const prevCondNodeCountRef = useRef(condNodeCount);
  useEffect(() => {
    const becameEmpty = prevCondNodeCountRef.current > 0 && condNodeCount === 0;
    prevCondNodeCountRef.current = condNodeCount;
    if (!becameEmpty) return;
    clearConditionHits();
  }, [condNodeCount, clearConditionHits]);

  return { runConditionScan, clearConditionHits, clearAllConditions };
}
