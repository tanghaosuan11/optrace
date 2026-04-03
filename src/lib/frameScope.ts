/** 多笔调试：每笔 frame_id 从 1 起，用 transactionId + contextId 唯一标识一帧 */

export function frameScopeKey(transactionId: number, contextId: number): string {
  return `${transactionId}:${contextId}`;
}

/** 与 StepData / CallFrame 一致的 scope（缺省 transactionId 视为 0） */
export function frameScopeKeyFromStep(step: { transactionId: number; contextId: number }): string {
  return frameScopeKey(step.transactionId, step.contextId);
}

export function frameScopeKeyFromFrame(frame: {
  transactionId?: number;
  contextId: number;
}): string {
  return frameScopeKey(frame.transactionId ?? 0, frame.contextId);
}

/** 与 CallFrame.id / store activeTab 一致 */
export function frameTabId(transactionId: number, contextId: number): string {
  return `frame-${transactionId}-${contextId}`;
}
