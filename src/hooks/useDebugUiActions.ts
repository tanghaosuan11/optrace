import { useCallback } from "react";
import { useDebugStore } from "@/store/debugStore";
import type { CondNode, PauseConditionType } from "@/lib/pauseConditions";
import { useDrawerActions } from "@/hooks/useDrawerActions";

export function useDebugUiActions() {
  const sync = useDebugStore.getState().sync;
  const { toggleCallTree, closeCallTree, openLog: openLogDrawer, openUtilities, openAnalysis, openCondList, openSymbolicSolve } = useDrawerActions();

  const appendLeafCondition = useCallback((condNodes: CondNode[], condType: PauseConditionType, value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return false;
    const id = crypto.randomUUID();
    const node: CondNode = {
      kind: "leaf",
      id,
      cond: {
        id,
        type: condType,
        value: trimmed,
        enabled: true,
      },
    };
    sync({ condNodes: [...condNodes, node] });
    return true;
  }, [sync]);

  return {
    toggleCallTree,
    closeCallTree,
    openLogDrawer,
    openUtilities,
    openAnalysis,
    openCondList,
    openSymbolicSolve,
    appendLeafCondition,
  };
}
