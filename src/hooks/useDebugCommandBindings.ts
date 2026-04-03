import { useEffect } from "react";
import { useDebugStore } from "@/store/debugStore";
import { registerCommands, unregisterCommands } from "@/lib/commands";
import { useKeyboardShortcuts } from "./useKeyboardShortcuts";

interface UseDebugCommandBindingsParams {
  stepForward: () => void;
  stepOver: () => void;
  stepOut: () => void;
  stepBackward: () => void;
  togglePlayback: () => void;
  seekTo: (index: number) => void;
  navBack: () => void;
  navForward: () => void;
}

export function useDebugCommandBindings({
  stepForward,
  stepOver,
  stepOut,
  stepBackward,
  togglePlayback,
  seekTo,
  navBack,
  navForward,
}: UseDebugCommandBindingsParams) {
  useEffect(() => {
    registerCommands({
      "debug.stepInto": stepForward,
      "debug.stepOver": stepOver,
      "debug.stepOut": stepOut,
      "debug.stepBack": stepBackward,
      "debug.continue": togglePlayback,
      "debug.seekToStart": () => seekTo(0),
      "debug.seekToEnd": () => {
        const total = useDebugStore.getState().stepCount;
        if (total > 0) seekTo(total - 1);
      },
      "nav.back": navBack,
      "nav.forward": navForward,
      "ui.toggleUtilities": () => {
        const s = useDebugStore.getState();
        s.sync({ isUtilitiesOpen: !s.isUtilitiesOpen });
      },
      "ui.toggleLogs": () => {
        const s = useDebugStore.getState();
        s.sync({ isLogDrawerOpen: !s.isLogDrawerOpen });
      },
      "ui.toggleAnalysis": () => {
        const s = useDebugStore.getState();
        s.sync({ isAnalysisOpen: !s.isAnalysisOpen });
      },
      "ui.toggleBookmarks": () => {
        const s = useDebugStore.getState();
        s.sync({ isBookmarksOpen: !s.isBookmarksOpen });
      },
      "ui.toggleCondList": () => {
        const s = useDebugStore.getState();
        s.sync({ isCondListOpen: !s.isCondListOpen });
      },
      "ui.toggleCallTree": () => {
        const s = useDebugStore.getState();
        s.sync({ isCallTreeOpen: !s.isCallTreeOpen });
      },
    });

    return () =>
      unregisterCommands([
        "debug.stepInto",
        "debug.stepOver",
        "debug.stepOut",
        "debug.stepBack",
        "debug.continue",
        "debug.seekToStart",
        "debug.seekToEnd",
        "nav.back",
        "nav.forward",
        "ui.toggleUtilities",
        "ui.toggleLogs",
        "ui.toggleAnalysis",
        "ui.toggleBookmarks",
        "ui.toggleCondList",
        "ui.toggleCallTree",
      ]);
  }, [stepForward, stepOver, stepOut, stepBackward, togglePlayback, seekTo, navBack, navForward]);

  useKeyboardShortcuts();
}
