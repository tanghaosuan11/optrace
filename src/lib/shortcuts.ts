/**
 * 快捷键定义表
 */

import type { CommandId } from "./commands";
import { useDebugStore } from "@/store/debugStore";

export interface ShortcutDef {
  commandId: CommandId;
  description: string;
  /**
   * 可选条件：返回 false 时快捷键不触发。
   * 保持轻量 —— 直接读 store.getState()，不订阅。
   */
  when?: () => boolean;
}

const isDebugging = () => useDebugStore.getState().stepCount > 0;

// 后期添加新快捷键直接在此追加一行即可。

export const SHORTCUT_MAP: Record<string, ShortcutDef> = {
  // 调试步进
  "j":                { commandId: "debug.stepInto",   description: "Step Into",    when: isDebugging },
  "k":                { commandId: "debug.stepBack",   description: "Step Back",    when: isDebugging },
  // "":              { commandId: "debug.stepOver",   description: "Step Over",    when: isDebugging },
  // "":        { commandId: "debug.stepOut",    description: "Step Out",     when: isDebugging },
  "space":            { commandId: "debug.continue",   description: "Continue / Pause", when: isDebugging },

  // 导航历史
  "alt+ArrowLeft":    { commandId: "nav.back",         description: "Navigate Back" },
  "alt+ArrowRight":   { commandId: "nav.forward",      description: "Navigate Forward" },

  // 调试跳转（对齐 Foundry）
  "a":         { commandId: "debug.prevJump",   description: "Prev Jump",   when: isDebugging },
  "s":         { commandId: "debug.nextJump",   description: "Next Jump",   when: isDebugging },
  "c":         { commandId: "debug.prevCall",   description: "Prev Call",   when: isDebugging },
  "shift+c":   { commandId: "debug.nextCall",   description: "Next Call",   when: isDebugging },
  "shift+j":   { commandId: "debug.prevFrame",  description: "Prev Frame",  when: isDebugging },
  "shift+k":   { commandId: "debug.nextFrame",  description: "Next Frame",  when: isDebugging },
  "g":         { commandId: "debug.seekToStart", description: "Seek to Start", when: isDebugging },
  "shift+g":   { commandId: "debug.seekToEnd",  description: "Seek to End",   when: isDebugging },

  // 界面
  "t":         { commandId: "ui.toggleCallTree",  description: "Toggle Call Tree",
                 when: () => useDebugStore.getState().callTreeNodes.length > 0 },
  "u":         { commandId: "ui.toggleUtilities", description: "Toggle Utilities" },
  "l":         { commandId: "ui.toggleLogs",      description: "Toggle Log Drawer" },
  "shift+a":   { commandId: "ui.toggleAnalysis",  description: "Toggle Analysis" },
  "n":         { commandId: "ui.toggleNotes",     description: "Toggle Notes" },
  "f":         { commandId: "ui.enterHintMode",   description: "Hint Mode (click via keyboard)" },
  "shift+f":   { commandId: "ui.openPanelSelector", description: "Open Panel Selector" },
  // 面板焦点与滚动
  "Tab":       { commandId: "ui.focusNextPanel",  description: "Focus Next Panel" },
  "shift+Tab": { commandId: "ui.focusPrevPanel",  description: "Focus Previous Panel" },
  "w":         { commandId: "ui.scrollUp",        description: "Scroll Up Active Panel" },
  "e":         { commandId: "ui.scrollDown",      description: "Scroll Down Active Panel" },
  "shift+w":   { commandId: "ui.pageUp",          description: "Page Up Active Panel" },
  "shift+e":   { commandId: "ui.pageDown",        description: "Page Down Active Panel" },
  "ctrl+k":    { commandId: "ui.openCommandPalette", description: "Open Command Palette" },
  "ctrl+g":    { commandId: "ui.openCommandPaletteStepJump", description: "Open Step Jump (:)" },
  "ctrl+shift+g": { commandId: "ui.openCommandPaletteFrameJump", description: "Open Frame Jump (:f)" },
  /** 多数键盘为 Shift+/；部分 WebView 会编成 shift+/，见 encodeKey 归一化 */
  "shift+?":   { commandId: "ui.openKeyboardShortcutsHelp", description: "Keyboard Shortcuts Help" },
  "?":         { commandId: "ui.openKeyboardShortcutsHelp", description: "Keyboard Shortcuts Help" },
  // "ctrl+shift+b": { commandId: "ui.toggleBookmarks", description: "Toggle Bookmarks" },
  // "L": { commandId: "ui.toggleCondList", description: "Toggle Condition List" },
};

export type ShortcutHelpGroup = "debug" | "nav" | "ui";

const GROUP_LABEL: Record<ShortcutHelpGroup, string> = {
  debug: "Debugging",
  nav: "Navigation",
  ui: "Interface",
};

const KEY_PART_DISPLAY: Record<string, string> = {
  space: "Space",
  ArrowLeft: "←",
  ArrowRight: "→",
  ArrowUp: "↑",
  ArrowDown: "↓",
  Tab: "Tab",
};

/** 将 SHORTCUT_MAP 的 combo 键转为界面展示用文案（字母等与表中一致，区分大小写） */
export function formatShortcutCombo(combo: string): string {
  const parts = combo.split("+");
  const out: string[] = [];
  for (const p of parts) {
    if (p === "ctrl") out.push("Ctrl");
    else if (p === "alt") out.push("Alt");
    else if (p === "shift") out.push("Shift");
    else if (KEY_PART_DISPLAY[p]) out.push(KEY_PART_DISPLAY[p]);
    else out.push(p);
  }
  return out.join(" + ");
}

function groupForCommand(id: CommandId): ShortcutHelpGroup {
  if (id.startsWith("debug.")) return "debug";
  if (id.startsWith("nav.")) return "nav";
  return "ui";
}

/** 帮助列表同组内顺序：相近功能挨着（如 w/e、翻页） */
const HELP_ORDER: Partial<Record<CommandId, number>> = {
  "debug.stepInto": 10,
  "debug.stepBack": 20,
  "debug.continue": 30,
  "debug.prevJump": 40,
  "debug.nextJump": 50,
  "debug.prevCall": 60,
  "debug.nextCall": 70,
  "debug.prevFrame": 80,
  "debug.nextFrame": 90,
  "debug.seekToStart": 100,
  "debug.seekToEnd": 110,
  "nav.back": 10,
  "nav.forward": 20,
  "ui.toggleCallTree": 10,
  "ui.toggleUtilities": 20,
  "ui.toggleLogs": 30,
  "ui.toggleAnalysis": 40,
  "ui.toggleNotes": 50,
  "ui.enterHintMode": 60,
  "ui.openPanelSelector": 70,
  "ui.focusNextPanel": 80,
  "ui.focusPrevPanel": 90,
  "ui.scrollUp": 100,
  "ui.scrollDown": 110,
  "ui.pageUp": 120,
  "ui.pageDown": 130,
  "ui.openCommandPalette": 140,
  "ui.openCommandPaletteStepJump": 145,
  "ui.openCommandPaletteFrameJump": 146,
  "ui.openKeyboardShortcutsHelp": 150,
};

export interface ShortcutHelpRow {
  combo: string;
  commandId: CommandId;
  keysDisplay: string;
  description: string;
  conditional: boolean;
  group: ShortcutHelpGroup;
}

/** 供帮助弹窗渲染：与 SHORTCUT_MAP 一致，按分组排序 */
export function getShortcutHelpRows(): ShortcutHelpRow[] {
  const rows: ShortcutHelpRow[] = [];
  const seenCommand = new Set<string>();
  for (const [combo, def] of Object.entries(SHORTCUT_MAP)) {
    const id = def.commandId;
    if (seenCommand.has(id)) continue;
    seenCommand.add(id);
    rows.push({
      combo,
      commandId: def.commandId,
      keysDisplay: formatShortcutCombo(combo),
      description: def.description,
      conditional: !!def.when,
      group: groupForCommand(def.commandId),
    });
  }
  const groupOrder: ShortcutHelpGroup[] = ["debug", "nav", "ui"];
  rows.sort((a, b) => {
    const ia = groupOrder.indexOf(a.group);
    const ib = groupOrder.indexOf(b.group);
    if (ia !== ib) return ia - ib;
    const orderA = HELP_ORDER[a.commandId] ?? 1000;
    const orderB = HELP_ORDER[b.commandId] ?? 1000;
    if (orderA !== orderB) return orderA - orderB;
    return a.keysDisplay.localeCompare(b.keysDisplay);
  });
  return rows;
}

export { GROUP_LABEL };

export function getShortcutKeysForCommand(commandId: CommandId): string[] {
  const keys: string[] = [];
  for (const [combo, def] of Object.entries(SHORTCUT_MAP)) {
    if (def.commandId === commandId) keys.push(combo);
  }
  return keys;
}

/** e.key → 规范名称映射（覆盖浏览器原始值） */
const KEY_ALIASES: Record<string, string> = {
  " ": "space",
};

/** 将 KeyboardEvent 编码为与 SHORTCUT_MAP 的 key 格式一致的字符串。 */
export function encodeKey(e: KeyboardEvent): string {
  // 单独按下修饰键时不产生 combo
  if (["Control", "Alt", "Shift", "Meta"].includes(e.key)) return "";
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push("ctrl");
  if (e.altKey) parts.push("alt");
  if (e.shiftKey) parts.push("shift");
  let key = KEY_ALIASES[e.key] ?? (e.key.length === 1 ? e.key.toLowerCase() : e.key);
  // 中文键盘等会产出全角「？」「／」，与 ASCII 统一后才能命中 SHORTCUT_MAP
  if (key === "？") key = "?";
  if (key === "／") key = "/";
  parts.push(key);
  let combo = parts.join("+");
  // Shift+/ 打出「?」时，有的引擎仍给 key "Slash"，与 shift+? 视为同一快捷键
  if (combo === "shift+/") combo = "shift+?";
  return combo;
}
