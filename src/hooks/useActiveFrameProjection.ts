import { useEffect } from "react";
import type { CallFrame } from "@/lib/types";
import { syncFrameProjectionToStore } from "@/lib/frameProjection";

interface UseActiveFrameProjectionParams {
  callFramesRef: React.RefObject<CallFrame[]>;
  activeTab: string;
  currentStepIndex: number;
  breakpointPcsMap: Map<string, Set<number>>;
}

export function useActiveFrameProjection({
  callFramesRef,
  activeTab,
  currentStepIndex,
  breakpointPcsMap,
}: UseActiveFrameProjectionParams) {
  useEffect(() => {
    const frame = callFramesRef.current.find((f) => f.id === activeTab);
    if (!frame) return;
    syncFrameProjectionToStore(frame, currentStepIndex);
  }, [callFramesRef, activeTab, currentStepIndex, breakpointPcsMap]);
}
