// Hook: 为 CallTree 中的所有地址批量获取标签

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

// Hook: 批量获取 CallTree 中所有地址的标签
export function useCallTreeAddressLabels(
  callTreeNodes: CallTreeNode[],
  chainId: number | undefined,
): {
  labels: AddressLabelMap;
  loading: boolean;
} {
  const [labels, setLabels] = useState<AddressLabelMap>({});
  const [loading, setLoading] = useState(false);

  // 提取所有需要查询的地址
  const addressesToFetch = useMemo(() => {
    return Array.from(extractAddressesFromTree(callTreeNodes));
  }, [callTreeNodes]);

  // 批量查询标签
  useEffect(() => {
    if (!chainId || addressesToFetch.length === 0) {
      setLabels({});
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
        console.warn("[useCallTreeAddressLabels] Fetch failed:", err);
        setLabels({});
      } finally {
        setLoading(false);
      }
    };

    fetchLabels();
  }, [addressesToFetch, chainId]);

  return { labels, loading };
}
