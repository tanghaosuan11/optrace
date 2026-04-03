import { useRef } from "react";
import { type StepData } from "@/lib/stepPlayer";
import { type CallFrame, type CallTreeNode } from "@/lib/types";
import { createMessageRuntimeState } from "@/lib/messageHandlers";
import type { StepFullData } from "@/hooks/useDebugPlayback";

export function useDebugRuntimeRefs() {
  const initialSid = (() => {
    try {
      const sp = new URLSearchParams(window.location.search);
      const fromUrl = sp.get("sessionId") || sp.get("session_id");
      if (fromUrl && fromUrl.trim()) return fromUrl.trim();
    } catch {
      // ignore
    }
    return `sess_${crypto.randomUUID()}`;
  })();
  const sessionIdRef = useRef(initialSid);
  const allStepsRef = useRef<StepData[]>([]);
  const callFramesRef = useRef<CallFrame[]>([]);
  const callTreeRef = useRef<CallTreeNode[]>([]);
  const messageRuntimeRef = useRef(createMessageRuntimeState());
  const stepIndexByContextRef = useRef<Map<string, number[]>>(new Map());
  const opcodeIndexRef = useRef<Map<number, number[]>>(new Map());
  const isPlayingRef = useRef(false);
  const currentStepIndexRef = useRef(-1);
  const activeTabRef = useRef<string>("main");
  const batchSizeRef = useRef(10);
  const breakOpcodesRef = useRef<Set<number>>(new Set());
  const fullDataThresholdRef = useRef(0);
  const fullDataCacheRef = useRef<StepFullData[] | null>(null);
  const cacheVersionRef = useRef(0);
  const cacheTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const breakpointPcsRef = useRef<Map<string, Set<number>>>(new Map());
  const conditionHitSetRef = useRef<Set<number>>(new Set());

  return {
    sessionIdRef,
    allStepsRef,
    callFramesRef,
    callTreeRef,
    messageRuntimeRef,
    stepIndexByContextRef,
    opcodeIndexRef,
    isPlayingRef,
    currentStepIndexRef,
    activeTabRef,
    batchSizeRef,
    breakOpcodesRef,
    fullDataThresholdRef,
    fullDataCacheRef,
    cacheVersionRef,
    cacheTimerRef,
    breakpointPcsRef,
    conditionHitSetRef,
  };
}
