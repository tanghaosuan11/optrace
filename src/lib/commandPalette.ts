import type { CommandId } from "@/lib/commands";
import { SHORTCUT_MAP, formatShortcutCombo, getShortcutKeysForCommand } from "@/lib/shortcuts";

export interface CommandPaletteItem {
  commandId: CommandId;
  title: string;
  group: "Debugging" | "Navigation" | "Interface";
  shortcut?: string;
  enabled: boolean;
  keywords: string;
}

function groupFor(commandId: CommandId): CommandPaletteItem["group"] {
  if (commandId.startsWith("debug.")) return "Debugging";
  if (commandId.startsWith("nav.")) return "Navigation";
  return "Interface";
}

function keywordsFor(commandId: CommandId, title: string, shortcutKeys: string[]): string {
  const alias: Record<CommandId, string[]> = {
    "debug.stepInto": ["step", "into", "next"],
    "debug.stepOver": ["step", "over"],
    "debug.stepOut": ["step", "out"],
    "debug.stepBack": ["step", "back", "previous"],
    "debug.continue": ["continue", "pause", "play"],
    "debug.seekToStart": ["start", "first"],
    "debug.seekToEnd": ["end", "last"],
    "nav.back": ["back", "history"],
    "nav.forward": ["forward", "history"],
    "ui.toggleUtilities": ["utilities", "tool"],
    "ui.toggleLogs": ["logs", "events"],
    "ui.toggleAnalysis": ["analysis", "script"],
    "ui.toggleBookmarks": ["bookmark"],
    "ui.toggleCondList": ["condition", "scan"],
    "ui.toggleCallTree": ["call", "tree"],
    "ui.toggleNotes": ["note", "mark"],
    "ui.enterHintMode": ["hint", "click"],
    "ui.openPanelSelector": ["panel", "selector"],
    "debug.prevJump": ["jump", "previous"],
    "debug.nextJump": ["jump", "next"],
    "debug.prevCall": ["call", "previous"],
    "debug.nextCall": ["call", "next"],
    "debug.prevFrame": ["frame", "previous", "upper"],
    "debug.nextFrame": ["frame", "next", "lower"],
    "ui.focusNextPanel": ["focus", "panel", "next"],
    "ui.focusPrevPanel": ["focus", "panel", "previous"],
    "ui.scrollUp": ["scroll", "up", "w"],
    "ui.scrollDown": ["scroll", "down", "e"],
    "ui.pageUp": ["page", "up"],
    "ui.pageDown": ["page", "down"],
    "ui.openKeyboardShortcutsHelp": ["help", "shortcuts", "?"],
    "ui.openCommandPalette": ["command", "palette", "search"],
    "ui.openCommandPaletteStepJump": ["jump", "step", ":", "goto"],
    "ui.openCommandPaletteFrameJump": ["jump", "frame", ":f", "goto"],
  };
  return [commandId, title, ...shortcutKeys, ...(alias[commandId] ?? [])]
    .join(" ")
    .toLowerCase();
}

export function getCommandPaletteItems(): CommandPaletteItem[] {
  const seen = new Set<CommandId>();
  const items: CommandPaletteItem[] = [];
  for (const def of Object.values(SHORTCUT_MAP)) {
    if (seen.has(def.commandId)) continue;
    seen.add(def.commandId);
    const shortcutKeys = getShortcutKeysForCommand(def.commandId);
    const shortcut = shortcutKeys[0] ? formatShortcutCombo(shortcutKeys[0]) : undefined;
    const enabled = def.when ? def.when() : true;
    items.push({
      commandId: def.commandId,
      title: def.description,
      group: groupFor(def.commandId),
      shortcut,
      enabled,
      keywords: keywordsFor(def.commandId, def.description, shortcutKeys),
    });
  }
  return items;
}

