import { useEffect } from "react";
import { SHORTCUT_MAP, encodeKey } from "@/lib/shortcuts";
import { executeCommand } from "@/lib/commands";
import { useDebugStore } from "@/store/debugStore";

/** 这些元素内不触发快捷键（用户正在输入） */
const INPUT_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

export function useKeyboardShortcuts() {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;

      // 输入框内：Esc 失焦（浏览器对 text input 不一定默认 blur）
      if (INPUT_TAGS.has(target.tagName)) {
        if (e.key === "Escape") {
          e.preventDefault();
          (target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).blur();
        }
        return;
      }
      if (target.isContentEditable) {
        if (e.key === "Escape") {
          e.preventDefault();
          target.blur();
        }
        return;
      }

      const combo = encodeKey(e);
      if (!combo) return;

      // Command Palette 打开时，仅允许这些全局组合；其余交给面板内部处理
      if (
        useDebugStore.getState().isCommandPaletteOpen &&
        combo !== "ctrl+k" &&
        combo !== "ctrl+g" &&
        combo !== "ctrl+shift+g"
      ) {
        return;
      }

      // Hint 模式：仅允许 ? 打开快捷键帮助，其余交给 HintOverlay（capture）
      const opensHelp = combo === "shift+?" || combo === "?";
      if (useDebugStore.getState().isHintMode && !opensHelp) return;

      const def = SHORTCUT_MAP[combo];
      if (!def) return;

      // 检查条件
      if (def.when && !def.when()) return;

      e.preventDefault();
      executeCommand(def.commandId);
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []); // 空依赖：handler 只查注册表（模块级 Map），无需重建
}
