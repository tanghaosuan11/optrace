import { useEffect } from "react";
import type React from "react";
import { pickKeyboardScrollScope, useDebugStore } from "@/store/debugStore";
import { scrollKeyboardDrawerScope } from "@/lib/keyboardScroll";
import { registerCommands, unregisterCommands } from "@/lib/commands";
import { useKeyboardShortcuts } from "./useKeyboardShortcuts";
import type { StepData } from "@/lib/stepPlayer";
import { frameTabId } from "@/lib/frameScope";

// JUMP/JUMPI opcode
const JUMP_OPCODES = [0x56, 0x57];
// CALL 系列 opcode（CREATE/CALL/CALLCODE/DELEGATECALL/CREATE2/STATICCALL）
const CALL_OPCODES = [0xf0, 0xf1, 0xf2, 0xf4, 0xf5, 0xfa];

/** 在已排序的下标列表中找第一个 > cur 的值 */
function findNext(indices: number[], cur: number): number | undefined {
  let lo = 0, hi = indices.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (indices[mid] <= cur) lo = mid + 1;
    else hi = mid;
  }
  return indices[lo];
}

/** 在已排序的下标列表中找最后一个 < cur 的值 */
function findPrev(indices: number[], cur: number): number | undefined {
  let lo = 0, hi = indices.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (indices[mid] < cur) lo = mid + 1;
    else hi = mid;
  }
  return indices[lo - 1];
}

/** 合并多个 opcode 的下标，并排序去重 */
function mergeOpcodeIndices(
  opcodeIndex: Map<number, number[]>,
  opcodes: number[],
): number[] {
  const all: number[] = [];
  for (const op of opcodes) {
    const list = opcodeIndex.get(op);
    if (list) all.push(...list);
  }
  return all.sort((a, b) => a - b);
}

interface UseDebugCommandBindingsParams {
  stepForward: () => void;
  stepOver: () => void;
  stepOut: () => void;
  stepBackward: () => void;
  togglePlayback: () => void;
  seekTo: (index: number) => void;
  navBack: () => void;
  navForward: () => void;
  // 用于跳到下一个/上一个 jump 或 call 指令
  allStepsRef: React.RefObject<StepData[]>;
  opcodeIndexRef: React.RefObject<Map<number, number[]>>;
  currentStepIndexRef: React.RefObject<number>;
  // 用于键盘滚动各面板
  panelRefs?: {
    opcode: React.RefObject<HTMLDivElement | null>;
    stack: React.RefObject<HTMLDivElement | null>;
    memory: React.RefObject<HTMLDivElement | null>;
    storage: React.RefObject<HTMLDivElement | null>;
  };
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
  allStepsRef,
  opcodeIndexRef,
  currentStepIndexRef,
  panelRefs,
}: UseDebugCommandBindingsParams) {
  useEffect(() => {
    // 跳到下一个 JUMP/JUMPI
    const seekNextJump = () => {
      const cur = currentStepIndexRef.current;
      if (cur < 0 || !opcodeIndexRef.current.size) return;
      const indices = mergeOpcodeIndices(opcodeIndexRef.current, JUMP_OPCODES);
      const next = findNext(indices, cur);
      if (next !== undefined) seekTo(next);
    };

    // 跳到上一个 JUMP/JUMPI
    const seekPrevJump = () => {
      const cur = currentStepIndexRef.current;
      if (cur < 0 || !opcodeIndexRef.current.size) return;
      const indices = mergeOpcodeIndices(opcodeIndexRef.current, JUMP_OPCODES);
      const prev = findPrev(indices, cur);
      if (prev !== undefined) seekTo(prev);
    };

    // 跳到下一个 CALL 类指令
    const seekNextCall = () => {
      const cur = currentStepIndexRef.current;
      if (cur < 0 || !opcodeIndexRef.current.size) return;
      const indices = mergeOpcodeIndices(opcodeIndexRef.current, CALL_OPCODES);
      const next = findNext(indices, cur);
      if (next !== undefined) seekTo(next);
    };

    // 跳到上一个 CALL 类指令
    const seekPrevCall = () => {
      const cur = currentStepIndexRef.current;
      if (cur < 0 || !opcodeIndexRef.current.size) return;
      const indices = mergeOpcodeIndices(opcodeIndexRef.current, CALL_OPCODES);
      const prev = findPrev(indices, cur);
      if (prev !== undefined) seekTo(prev);
    };

    const findFrameStartStep = (transactionId: number, contextId: number): number | null => {
      const nodes = useDebugStore
        .getState()
        .callTreeNodes.filter(
          (n) =>
            n.type === "frame" &&
            (n.transactionId ?? 0) === transactionId &&
            n.contextId === contextId,
        );
      if (nodes.length === 0) return null;
      let minStep = nodes[0].stepIndex;
      for (let i = 1; i < nodes.length; i++) {
        if (nodes[i].stepIndex < minStep) minStep = nodes[i].stepIndex;
      }
      return minStep;
    };

    const jumpFrame = (dir: -1 | 1) => {
      const s = useDebugStore.getState();
      const frames = s.callFrames;
      if (frames.length === 0) return;
      const curIdx = frames.findIndex((f) => f.id === s.activeTab);
      const base = curIdx >= 0 ? curIdx : 0;
      const targetIdx = Math.max(0, Math.min(base + dir, frames.length - 1));
      if (targetIdx === base) return;
      const frame = frames[targetIdx];
      const tx = frame.transactionId ?? 0;
      const tabId = frameTabId(tx, frame.contextId);
      s.sync({ activeTab: tabId });
      const startStep = findFrameStartStep(tx, frame.contextId);
      if (startStep != null) seekTo(startStep);
    };

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
      "debug.prevJump": seekPrevJump,
      "debug.nextJump": seekNextJump,
      "debug.prevCall": seekPrevCall,
      "debug.nextCall": seekNextCall,
      "debug.prevFrame": () => jumpFrame(-1),
      "debug.nextFrame": () => jumpFrame(1),
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
      "ui.toggleNotes": () => {
        const s = useDebugStore.getState();
        s.sync({ isNotesDrawerOpen: !s.isNotesDrawerOpen });
      },
      "ui.enterHintMode": () => {
        useDebugStore.getState().sync({ isHintMode: true });
      },
      "ui.openPanelSelector": () => {
        useDebugStore.getState().sync({ isPanelSelectorOpen: true });
      },
      "ui.openKeyboardShortcutsHelp": () => {
        const s = useDebugStore.getState();
        s.sync({ isKeyboardShortcutsHelpOpen: !s.isKeyboardShortcutsHelpOpen });
      },
      "ui.openCommandPalette": () => {
        const s = useDebugStore.getState();
        s.sync({
          isCommandPaletteOpen: !s.isCommandPaletteOpen,
          isHintMode: false,
          commandPalettePrefill: "",
        });
      },
      "ui.openCommandPaletteStepJump": () => {
        useDebugStore.getState().sync({
          isCommandPaletteOpen: true,
          isHintMode: false,
          commandPalettePrefill: ":",
        });
      },
      "ui.openCommandPaletteFrameJump": () => {
        useDebugStore.getState().sync({
          isCommandPaletteOpen: true,
          isHintMode: false,
          commandPalettePrefill: ":f",
        });
      },
      // 面板焦点切换（循环）
      "ui.focusNextPanel": () => {
        const PANELS = ["opcode", "stack", "memory", "storage"];
        const s = useDebugStore.getState();
        if (pickKeyboardScrollScope(s) !== "main") return;
        const cur = s.activePanelId;
        const idx = PANELS.indexOf(cur);
        const next = PANELS[(idx + 1) % PANELS.length];
        s.sync({ activePanelId: next });
      },
      "ui.focusPrevPanel": () => {
        const PANELS = ["opcode", "stack", "memory", "storage"];
        const s = useDebugStore.getState();
        if (pickKeyboardScrollScope(s) !== "main") return;
        const cur = s.activePanelId;
        const idx = PANELS.indexOf(cur);
        const prev = PANELS[(idx - 1 + PANELS.length) % PANELS.length];
        s.sync({ activePanelId: prev });
      },
      "ui.scrollUp": () => {
        const s = useDebugStore.getState();
        const scope = pickKeyboardScrollScope(s);
        if (scope !== "main") {
          scrollKeyboardDrawerScope(scope, -100);
          return;
        }
        const panelId = s.activePanelId;
        if (panelRefs && ["opcode", "stack", "memory", "storage"].includes(panelId)) {
          const ref = panelRefs[panelId as keyof typeof panelRefs];
          if (ref?.current) {
            ref.current.scrollBy({ top: -100, behavior: "smooth" });
            return;
          }
        }
        const el = document.querySelector(`[data-panel-id="${panelId}"]`) as HTMLElement;
        if (el) el.scrollBy({ top: -100, behavior: "smooth" });
      },
      "ui.scrollDown": () => {
        const s = useDebugStore.getState();
        const scope = pickKeyboardScrollScope(s);
        if (scope !== "main") {
          scrollKeyboardDrawerScope(scope, 100);
          return;
        }
        const panelId = s.activePanelId;
        if (panelRefs && ["opcode", "stack", "memory", "storage"].includes(panelId)) {
          const ref = panelRefs[panelId as keyof typeof panelRefs];
          if (ref?.current) {
            ref.current.scrollBy({ top: 100, behavior: "smooth" });
            return;
          }
        }
        const el = document.querySelector(`[data-panel-id="${panelId}"]`) as HTMLElement;
        if (el) el.scrollBy({ top: 100, behavior: "smooth" });
      },
      "ui.pageUp": () => {
        const s = useDebugStore.getState();
        const scope = pickKeyboardScrollScope(s);
        if (scope !== "main") {
          const nodes = document.querySelectorAll<HTMLElement>(
            `[data-keyboard-scroll-root="${scope}"]`,
          );
          if (nodes.length > 0) {
            const h = nodes[0]?.clientHeight ?? 400;
            const distance = h * 0.8;
            scrollKeyboardDrawerScope(scope, -distance);
          }
          return;
        }
        const panelId = s.activePanelId;
        let el: HTMLElement | null = null;
        if (panelRefs && ["opcode", "stack", "memory", "storage"].includes(panelId)) {
          el = panelRefs[panelId as keyof typeof panelRefs]?.current || null;
        } else {
          el = document.querySelector(`[data-panel-id="${panelId}"]`) as HTMLElement;
        }
        if (el) {
          const distance = el.clientHeight * 0.8;
          el.scrollBy({ top: -distance, behavior: "smooth" });
        }
      },
      "ui.pageDown": () => {
        const s = useDebugStore.getState();
        const scope = pickKeyboardScrollScope(s);
        if (scope !== "main") {
          const nodes = document.querySelectorAll<HTMLElement>(
            `[data-keyboard-scroll-root="${scope}"]`,
          );
          if (nodes.length > 0) {
            const h = nodes[0]?.clientHeight ?? 400;
            const distance = h * 0.8;
            scrollKeyboardDrawerScope(scope, distance);
          }
          return;
        }
        const panelId = s.activePanelId;
        let el: HTMLElement | null = null;
        if (panelRefs && ["opcode", "stack", "memory", "storage"].includes(panelId)) {
          el = panelRefs[panelId as keyof typeof panelRefs]?.current || null;
        } else {
          el = document.querySelector(`[data-panel-id="${panelId}"]`) as HTMLElement;
        }
        if (el) {
          const distance = el.clientHeight * 0.8;
          el.scrollBy({ top: distance, behavior: "smooth" });
        }
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
        "debug.prevJump",
        "debug.nextJump",
        "debug.prevCall",
        "debug.nextCall",
        "debug.prevFrame",
        "debug.nextFrame",
        "nav.back",
        "nav.forward",
        "ui.toggleUtilities",
        "ui.toggleLogs",
        "ui.toggleAnalysis",
        "ui.toggleBookmarks",
        "ui.toggleCondList",
        "ui.toggleCallTree",
        "ui.toggleNotes",
        "ui.enterHintMode",
        "ui.openPanelSelector",
        "ui.openKeyboardShortcutsHelp",
        "ui.openCommandPalette",
        "ui.openCommandPaletteStepJump",
        "ui.openCommandPaletteFrameJump",
        "ui.focusNextPanel",
        "ui.focusPrevPanel",
        "ui.scrollUp",
        "ui.scrollDown",
        "ui.pageUp",
        "ui.pageDown",
      ]);
  }, [stepForward, stepOver, stepOut, stepBackward, togglePlayback, seekTo, navBack, navForward, allStepsRef, opcodeIndexRef, currentStepIndexRef]);

  useKeyboardShortcuts();
}
