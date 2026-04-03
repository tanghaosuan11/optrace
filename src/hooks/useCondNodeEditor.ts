import { useCallback, useMemo, useState } from "react";
import { useDebugStore } from "@/store/debugStore";
import type { CondNode } from "@/lib/pauseConditions";

function removeFromTree(node: CondNode, id: string): CondNode | null {
  if (node.id === id) return null;
  if (node.kind === "leaf") return node;
  const left = removeFromTree(node.left, id);
  const right = removeFromTree(node.right, id);
  if (!left && !right) return null;
  if (!left) return right;
  if (!right) return left;
  return { ...node, left, right };
}

function toggleEnabledInTree(node: CondNode, leafId: string): CondNode {
  if (node.kind === "leaf") {
    if (node.id !== leafId) return node;
    return { ...node, cond: { ...node.cond, enabled: !node.cond.enabled } };
  }
  return {
    ...node,
    left: toggleEnabledInTree(node.left, leafId),
    right: toggleEnabledInTree(node.right, leafId),
  };
}

export function useCondNodeEditor(condNodes: CondNode[]) {
  const sync = useDebugStore.getState().sync;
  const setCondNodes = useCallback((next: CondNode[]) => {
    sync({ condNodes: next });
  }, [sync]);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mergeOp, setMergeOp] = useState<"AND" | "OR">("AND");

  const totalLeaves = useMemo(() => {
    const countLeaves = (nd: CondNode): number => nd.kind === "leaf" ? 1 : countLeaves(nd.left) + countLeaves(nd.right);
    return condNodes.reduce((sum, n) => sum + countLeaves(n), 0);
  }, [condNodes]);

  const canMerge = selected.size === 2 && condNodes.length >= 2;
  const topLevelIds = useMemo(() => new Set(condNodes.map((n) => n.id)), [condNodes]);

  const handleRemove = useCallback((id: string) => {
    const next = condNodes
      .map((n) => removeFromTree(n, id))
      .filter((n): n is CondNode => n !== null);
    setCondNodes(next);
    setSelected((prev) => {
      const s = new Set(prev);
      s.delete(id);
      return s;
    });
  }, [condNodes, setCondNodes]);

  const handleToggleEnabled = useCallback((leafId: string) => {
    const next = condNodes.map((n) => toggleEnabledInTree(n, leafId));
    setCondNodes(next);
  }, [condNodes, setCondNodes]);

  const handleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const s = new Set(prev);
      if (s.has(id)) {
        s.delete(id);
        return s;
      }
      if (s.size >= 2) return prev;
      s.add(id);
      return s;
    });
  }, []);

  const handleMerge = useCallback(() => {
    if (selected.size !== 2) return;
    const [idA, idB] = [...selected];
    const nodeA = condNodes.find((n) => n.id === idA);
    const nodeB = condNodes.find((n) => n.id === idB);
    if (!nodeA || !nodeB) return;
    const compound: CondNode = {
      kind: "compound",
      id: crypto.randomUUID(),
      op: mergeOp,
      left: nodeA,
      right: nodeB,
    };
    const next = condNodes
      .filter((n) => n.id !== idA && n.id !== idB)
      .concat(compound);
    setCondNodes(next);
    setSelected(new Set());
  }, [selected, condNodes, mergeOp, setCondNodes]);

  const clearSelection = useCallback(() => {
    setSelected(new Set());
  }, []);

  return {
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
  };
}
