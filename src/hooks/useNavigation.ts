import { useRef, useCallback } from "react";
import { useDebugStore } from "@/store/debugStore";
import type { DebugState } from "@/store/debugStore";

export function useNavigation(
  seekTo: (index: number) => void,
  activeTabRef: { readonly current: string },
) {
  const navHistoryRef = useRef<{ stepIndex: number; frameId: string }[]>([]);
  const navPtrRef = useRef(-1);
  const syncStore = useCallback((partial: Partial<DebugState>) => {
    useDebugStore.getState().sync(partial);
  }, []);

  const revealHiddenFrame = useCallback((frameId: string) => {
    const { hiddenFrameIds } = useDebugStore.getState();
    if (!hiddenFrameIds.has(frameId)) return null;
    const next = new Set(hiddenFrameIds);
    next.delete(frameId);
    return next;
  }, []);

  const navigateTo = useCallback((stepIndex: number, frameId: string) => {
    const newHist = [...navHistoryRef.current.slice(0, navPtrRef.current + 1), { stepIndex, frameId }];
    navHistoryRef.current = newHist;
    navPtrRef.current = newHist.length - 1;
    const syncPayload: Partial<DebugState> = {
      canNavBack: newHist.length - 1 > 0,
      canNavForward: false,
      activeTab: frameId,
    };
    const nextHidden = revealHiddenFrame(frameId);
    if (nextHidden) syncPayload.hiddenFrameIds = nextHidden;
    syncStore(syncPayload);
    seekTo(stepIndex);
  }, [seekTo, revealHiddenFrame, syncStore]);

  const seekToWithHistory = useCallback((stepIndex: number) => {
    const frameId = activeTabRef.current;
    const newHist = [...navHistoryRef.current.slice(0, navPtrRef.current + 1), { stepIndex, frameId }];
    navHistoryRef.current = newHist;
    navPtrRef.current = newHist.length - 1;
    syncStore({
      canNavBack: newHist.length - 1 > 0,
      canNavForward: false,
    });
    seekTo(stepIndex);
  }, [seekTo, activeTabRef, syncStore]);

  const navBack = useCallback(() => {
    const ptr = navPtrRef.current;
    if (ptr <= 0) return;
    const entry = navHistoryRef.current[ptr - 1];
    navPtrRef.current = ptr - 1;
    syncStore({
      canNavBack: ptr - 1 > 0,
      canNavForward: true,
      activeTab: entry.frameId,
    });
    seekTo(entry.stepIndex);
  }, [seekTo, syncStore]);

  const navForward = useCallback(() => {
    const ptr = navPtrRef.current;
    const hist = navHistoryRef.current;
    if (ptr >= hist.length - 1) return;
    const entry = hist[ptr + 1];
    navPtrRef.current = ptr + 1;
    syncStore({
      canNavBack: true,
      canNavForward: ptr + 1 < hist.length - 1,
      activeTab: entry.frameId,
    });
    seekTo(entry.stepIndex);
  }, [seekTo, syncStore]);

  const handleSelectFrame = useCallback((id: string) => {
    const { activeTab, tabHistory } = useDebugStore.getState();
    const syncPayload: Partial<DebugState> = {
      tabHistory: [...tabHistory, activeTab],
      activeTab: id,
    };
    const nextHidden = revealHiddenFrame(id);
    if (nextHidden) syncPayload.hiddenFrameIds = nextHidden;
    syncStore(syncPayload);
  }, [revealHiddenFrame, syncStore]);

  const handleGoBack = useCallback(() => {
    const { tabHistory } = useDebugStore.getState();
    if (tabHistory.length === 0) return;
    const prev = tabHistory[tabHistory.length - 1];
    syncStore({ tabHistory: tabHistory.slice(0, -1), activeTab: prev });
  }, [syncStore]);

  const resetNav = useCallback(() => {
    navHistoryRef.current = [];
    navPtrRef.current = -1;
    syncStore({ canNavBack: false, canNavForward: false });
  }, [syncStore]);

  return {
    navigateTo,
    seekToWithHistory,
    navBack,
    navForward,
    handleSelectFrame,
    handleGoBack,
    resetNav,
  };
}
