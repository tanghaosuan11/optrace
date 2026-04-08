// Hook: 管理 CallTree 顶部复选框的显示/隐藏状态
import { useEffect, useState, useCallback } from "react";
import { storeGet, storeSet } from "@/lib/tauriStore";

export interface CallTreeFilters {
  showSload: boolean;
  showSstore: boolean;
  showTload: boolean;
  showTstore: boolean;
  showKeccak256: boolean;
  showStaticCall: boolean;
  showGas: boolean;
}

const STORE_KEY = "callTreeFilters";

const DEFAULT_FILTERS: CallTreeFilters = {
  showSload: false,
  showSstore: true,
  showTload: false,
  showTstore: true,
  showKeccak256: false,
  showStaticCall: true,
  showGas: false,
};

// Hook: 加载和管理 CallTree 过滤器状态
export function useCallTreeFilters() {
  const [filters, setFilters] = useState<CallTreeFilters>(DEFAULT_FILTERS);
  const [loading, setLoading] = useState(true);

  // 初始化：从 tauriStore 加载保存的过滤器配置
  useEffect(() => {
    const loadFilters = async () => {
      try {
        const saved = await storeGet<CallTreeFilters>(STORE_KEY);
        if (saved) {
          // 合并保存的值和默认值（处理新增字段）
          setFilters({ ...DEFAULT_FILTERS, ...saved });
        }
      } catch (err) {
        console.warn("[useCallTreeFilters] Failed to load filters:", err);
      } finally {
        setLoading(false);
      }
    };

    loadFilters();
  }, []);

  // 更新单个过滤器并保存
  const updateFilter = useCallback(
    async (key: keyof CallTreeFilters, value: boolean) => {
      setFilters((prev) => {
        const updated = { ...prev, [key]: value };
        // 异步保存到 store，不阻塞 UI
        storeSet(STORE_KEY, updated).catch((err) => {
          console.warn("[useCallTreeFilters] Failed to save filter:", err);
        });
        return updated;
      });
    },
    [],
  );

  return {
    filters,
    updateFilter,
    loading,
  };
}
