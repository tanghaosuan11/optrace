/**
 * 全局键盘快捷键 hook
 *
 * 挂载一个 window keydown 监听器，查 SHORTCUT_MAP，执行对应命令。
 * 在 App.tsx 顶层调用一次：useKeyboardShortcuts()
 *
 * 所有快捷键配置在 lib/shortcuts.ts，命令注册在 lib/commands.ts。
 * 本 hook 不含任何业务逻辑，只做分发。
 */

import { useEffect } from "react";
import { SHORTCUT_MAP, encodeKey } from "@/lib/shortcuts";
import { executeCommand } from "@/lib/commands";

/** 这些元素内不触发快捷键（用户正在输入） */
const INPUT_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

export function useKeyboardShortcuts() {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;

      // 用户正在输入时跳过（INPUT / TEXTAREA / contenteditable）
      if (INPUT_TAGS.has(target.tagName)) return;
      if (target.isContentEditable) return;

      const combo = encodeKey(e);
      if (!combo) return;

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
