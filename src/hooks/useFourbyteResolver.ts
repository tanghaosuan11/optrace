import { useEffect, useRef } from "react";
import fourbyteDb from "@/lib/fourbyteDb.json";
import { getUserFn } from "@/lib/userFourbyteDb";
import { lookupSignature4Byte } from "@/lib/fourbyteUtils";
import { useDebugStore } from "@/store/debugStore";

const LOCAL_DB = fourbyteDb as Record<string, { fn?: string; ev?: string } | null>;

/**
 * 监听 callTreeNodes 变化，对 frame 节点中本地未识别的 4 字节 selector
 * 自动调用远端 4byte API 查询，结果写入 store.resolvedFnCache。
 * lookupSignature4Byte 内部会自动 saveUserFn，下次启动直接走本地缓存。
 *
 * 使用：在 App.tsx 顶层调用一次 useFourbyteResolver()。
 */
export function useFourbyteResolver() {
  const nodes = useDebugStore((s) => s.callTreeNodes);
  const attemptedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (nodes.length === 0) return;
    const { resolvedFnCache, sync } = useDebugStore.getState();

    const toFetch: string[] = [];
    const seen = new Set<string>();

    for (const n of nodes) {
      if (n.type !== "frame") continue;
      const inp = n.input;
      if (!inp) continue;
      const hex = inp.startsWith("0x") ? inp.slice(2) : inp;
      if (hex.length < 8) continue;
      const selector = "0x" + hex.slice(0, 8).toLowerCase();
      if (seen.has(selector)) continue;
      seen.add(selector);
      if (
        LOCAL_DB[selector]?.fn ||
        getUserFn(selector) ||
        resolvedFnCache[selector] ||
        attemptedRef.current.has(selector)
      )
        continue;
      toFetch.push(selector);
    }

    if (toFetch.length === 0) return;

    for (const sel of toFetch) attemptedRef.current.add(sel);

    for (const sel of toFetch) {
      lookupSignature4Byte(sel)
        .then(({ fn }) => {
          if (fn) {
            const { resolvedFnCache: current } = useDebugStore.getState();
            sync({ resolvedFnCache: { ...current, [sel]: fn } });
          }
        })
        .catch(() => {});
    }
  }, [nodes]);
}
