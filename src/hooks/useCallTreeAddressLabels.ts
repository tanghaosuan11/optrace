// Hook: 为 CallTree / Logs 等批量获取地址标签

import { useEffect, useState, useMemo } from "react";
import type { CallTreeNode } from "@/lib/types";
import type { AddressLabelItem } from "@/lib/addressLabel";
import { getAddressLabels } from "@/lib/addressLabel";

export interface AddressLabelMap {
  [address: string]: AddressLabelItem | null;
}

// 从 CallTree 节点中提取所有地址
function extractAddressesFromTree(nodes: CallTreeNode[]): Set<string> {
  const addresses = new Set<string>();
  for (const node of nodes) {
    if (node.type === "frame") {
      const addr = (node.target ?? node.address)?.toLowerCase();
      if (addr && addr !== "0x0000000000000000000000000000000000000000") {
        addresses.add(addr);
      }
    }
  }
  return addresses;
}

/** 从 Event Logs 行提取 log 合约地址与 frame 地址（去重、小写） */
export function extractAddressesFromLogEntries(
  logs: Array<{ address: string; frameAddress: string }>,
): string[] {
  const addresses = new Set<string>();
  for (const log of logs) {
    for (const raw of [log.address, log.frameAddress]) {
      const a = raw?.trim().toLowerCase();
      if (a?.startsWith("0x") && a.length === 42 && a !== "0x0000000000000000000000000000000000000000") {
        addresses.add(a);
      }
    }
  }
  return Array.from(addresses).sort();
}

function useAddressLabelsMap(
  addressesToFetch: string[],
  chainId: number | undefined,
  logPrefix: string,
): {
  labels: AddressLabelMap;
  loading: boolean;
} {
  const [labels, setLabels] = useState<AddressLabelMap>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!chainId || addressesToFetch.length === 0) {
      // 避免反复 setLabels({}) 触发无意义的重渲染（与不稳定 [] 依赖叠加会导致 maximum update depth）
      setLabels((prev) => (Object.keys(prev).length === 0 ? prev : {}));
      return;
    }

    const fetchLabels = async () => {
      setLoading(true);
      try {
        const results = await getAddressLabels(chainId, addressesToFetch);
        const labelMap: AddressLabelMap = {};
        for (let i = 0; i < addressesToFetch.length; i++) {
          labelMap[addressesToFetch[i]] = results[i];
        }
        setLabels(labelMap);
      } catch (err) {
        console.warn(`[${logPrefix}] Fetch failed:`, err);
        setLabels((prev) => (Object.keys(prev).length === 0 ? prev : {}));
      } finally {
        setLoading(false);
      }
    };

    fetchLabels();
  }, [addressesToFetch, chainId, logPrefix]);

  return { labels, loading };
}

// Hook: 批量获取 CallTree 中所有地址的标签
export function useCallTreeAddressLabels(
  callTreeNodes: CallTreeNode[],
  chainId: number | undefined,
): {
  labels: AddressLabelMap;
  loading: boolean;
} {
  const addressesToFetch = useMemo(() => {
    return Array.from(extractAddressesFromTree(callTreeNodes)).sort();
  }, [callTreeNodes]);

  return useAddressLabelsMap(addressesToFetch, chainId, "useCallTreeAddressLabels");
}

/** 批量获取当前 Logs 列表中出现的地址标签（与 CallTree 同源缓存/API） */
export function useLogAddressLabels(
  logs: Array<{ address: string; frameAddress: string }>,
  chainId: number | undefined,
): {
  labels: AddressLabelMap;
  loading: boolean;
} {
  const addressesToFetch = useMemo(
    () => extractAddressesFromLogEntries(logs),
    [logs],
  );

  return useAddressLabelsMap(addressesToFetch, chainId, "useLogAddressLabels");
}
