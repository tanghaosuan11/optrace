import { useCallback } from "react";
import { useDebugStore } from "@/store/debugStore";

export function useDrawerActions() {
  const sync = useDebugStore.getState().sync;

  const openBookmarks = useCallback(() => {
    sync({ isBookmarksOpen: true });
  }, [sync]);

  const closeBookmarks = useCallback(() => {
    sync({ isBookmarksOpen: false });
  }, [sync]);

  const openLog = useCallback(() => {
    sync({ isLogDrawerOpen: true });
  }, [sync]);

  const openUtilities = useCallback(() => {
    sync({ isUtilitiesOpen: true });
  }, [sync]);

  const openAnalysis = useCallback(() => {
    sync({ isAnalysisOpen: true });
  }, [sync]);

  const openCondList = useCallback(() => {
    sync({ isCondListOpen: true });
  }, [sync]);

  const toggleCallTree = useCallback(() => {
    const state = useDebugStore.getState();
    state.sync({ isCallTreeOpen: !state.isCallTreeOpen });
  }, []);

  const closeCallTree = useCallback(() => {
    sync({ isCallTreeOpen: false });
  }, [sync]);

  const closeLog = useCallback(() => {
    sync({ isLogDrawerOpen: false });
  }, [sync]);

  const closeUtilities = useCallback(() => {
    sync({ isUtilitiesOpen: false });
  }, [sync]);

  const closeAnalysis = useCallback(() => {
    sync({ isAnalysisOpen: false });
  }, [sync]);

  const closeNotes = useCallback(() => {
    sync({ isNotesDrawerOpen: false });
  }, [sync]);

  const closeCondList = useCallback(() => {
    sync({ isCondListOpen: false });
  }, [sync]);

  const openSymbolicSolve = useCallback((prefillStep?: number) => {
    sync({
      isSymbolicSolveOpen: true,
      symbolicPrefillStep: prefillStep ?? null,
    });
  }, [sync]);

  const closeSymbolicSolve = useCallback(() => {
    sync({ isSymbolicSolveOpen: false, symbolicPrefillStep: null });
  }, [sync]);

  return {
    openBookmarks,
    closeBookmarks,
    openLog,
    openUtilities,
    openAnalysis,
    openCondList,
    toggleCallTree,
    closeCallTree,
    closeLog,
    closeUtilities,
    closeAnalysis,
    closeNotes,
    closeCondList,
    openSymbolicSolve,
    closeSymbolicSolve,
  };
}
