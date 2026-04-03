/**
 * 命令注册表
 *
 * 所有可被快捷键触发的命令都在此注册。
 * 命令本身是纯函数引用，由 App.tsx 在 mount 后注册，解决回调依赖问题。
 *
 * 添加新命令：
 *   1. 在 CommandId 联合类型中声明 ID
 *   2. 在 App.tsx 的 registerCommands() 调用中传入回调
 *   3. 在 shortcuts.ts 中绑定快捷键（可选）
 */

export type CommandId =
  // 调试播放
  | "debug.stepInto"
  | "debug.stepOver"
  | "debug.stepOut"
  | "debug.stepBack"
  | "debug.continue"
  | "debug.seekToStart"
  | "debug.seekToEnd"
  // 导航历史
  | "nav.back"
  | "nav.forward"
  // 界面
  | "ui.toggleUtilities"
  | "ui.toggleLogs"
  | "ui.toggleAnalysis"
  | "ui.toggleBookmarks"
  | "ui.toggleCondList"
  | "ui.toggleCallTree";

const _registry = new Map<CommandId, () => void>();

/** 批量注册命令。在 App.tsx 的 useEffect 中调用一次。 */
export function registerCommands(map: Partial<Record<CommandId, () => void>>) {
  for (const [id, fn] of Object.entries(map) as [CommandId, () => void][]) {
    if (fn) _registry.set(id, fn);
  }
}

/** 批量注销命令（组件卸载时调用）。 */
export function unregisterCommands(ids: CommandId[]) {
  for (const id of ids) _registry.delete(id);
}

/** 执行命令。若命令未注册则静默忽略。 */
export function executeCommand(id: CommandId) {
  _registry.get(id)?.();
}
