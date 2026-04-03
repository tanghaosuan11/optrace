/** 条件扫描与命中结果相关类型/工具函数 */

import type { StepData } from "./stepPlayer";

/* Types */

export type PauseConditionType =
  | "sstore_key"
  | "sstore_value"
  | "sload_key"
  | "sload_value"
  /** @deprecated 使用 sstore_key */
  | "sstore_slot"
  /** @deprecated 使用 sload_key */
  | "sload_slot"
  | "call_address"
  | "call_selector"
  | "log_topic"
  | "contract_address"
  | "target_address"
  | "frame_call_address";

export interface PauseCondition {
  id: string;
  type: PauseConditionType;
  /** 匹配值（slot/address/selector/topic） */
  value: string;
  /** 是否启用 */
  enabled: boolean;
}

/** 条件树节点 */
export type CondNode =
  | { kind: "leaf"; id: string; cond: PauseCondition }
  | { kind: "compound"; id: string; op: "AND" | "OR"; left: CondNode; right: CondNode };

/** 收集叶子条件 */
export function collectLeaves(node: CondNode): PauseCondition[] {
  if (node.kind === "leaf") return [node.cond];
  return [...collectLeaves(node.left), ...collectLeaves(node.right)];
}

/** 叶子数量 */
export function leafCount(node: CondNode): number {
  if (node.kind === "leaf") return 1;
  return leafCount(node.left) + leafCount(node.right);
}

/** 条件组（组内 AND/OR，组间 OR） */
export interface ConditionGroup {
  id: string;
  /** "AND" | "OR" */
  logic: "AND" | "OR";
  conditions: PauseCondition[];
}

export const PAUSE_CONDITION_LABELS: Record<PauseConditionType, string> = {
  sstore_key: "SSTORE key",
  sstore_value: "SSTORE value",
  sload_key: "SLOAD key",
  sload_value: "SLOAD value",
  sstore_slot: "SSTORE slot",
  sload_slot: "SLOAD slot",
  call_address: "Call address",
  call_selector: "Call selector",
  log_topic: "LOG topic",
  contract_address: "Contract addr",
  target_address: "Target addr",
  frame_call_address: "Frame call addr",
};

/* Opcode bytes used in UI */

const OP_SSTORE       = 0x55;
const OP_SLOAD        = 0x54;
const OP_TLOAD        = 0x5c;
const OP_TSTORE       = 0x5d;
const OP_CALL         = 0xf1;
const OP_STATICCALL   = 0xfa;
const OP_DELEGATECALL = 0xf4;
const OP_LOG1         = 0xa1;
const OP_LOG4         = 0xa4;

/** 规范化 hex（小写，去 0x） */

function normalizeHex(s: string): string {
  return s.toLowerCase().replace(/^0x/, "");
}

/** 读取 StepData 的栈值（hex） */

function partialStackHex(step: StepData, pos: number): string | null {
  let v: string | undefined;
  if (pos === 0) v = step.stackTop;
  else if (pos === 1) v = step.stackSecond;
  else if (pos === 2) v = step.stackThird;
  if (v === undefined) return null;
  return normalizeHex(v);
}

/** 检查当前步骤是否命中条件组 */
export function checkPauseConditions(
  step: StepData,
  groups: ConditionGroup[]
): string | null {
  if (groups.length === 0) return null;
  const op = step.opcode;

  for (const group of groups) {
    if (group.conditions.length === 0) continue;
    const isAnd = group.logic === "AND";
    const descriptions: string[] = [];
    let groupHit = isAnd;

    for (const cond of group.conditions) {
      const target = normalizeHex(cond.value);
      if (!target) { if (isAnd) { groupHit = false; break; } continue; }
      const result = checkSingleCondition(step, op, cond.type, target);
      if (isAnd) {
        if (result) descriptions.push(result);
        else { groupHit = false; break; }
      } else {
        if (result) { descriptions.push(result); groupHit = true; break; }
      }
    }

    if (groupHit && descriptions.length > 0) return descriptions.join(" AND ");
  }
  return null;
}

function checkSingleCondition(
  step: StepData,
  op: number,
  type: PauseConditionType,
  target: string,
): string | null {
  switch (type) {
    case "sstore_key":
    case "sstore_slot": {
      if (op !== OP_SSTORE && op !== OP_TSTORE) return null;
      const slot = partialStackHex(step, 0);
      if (slot !== null && slot === target.padStart(64, "0").slice(-64)) {
        return op === OP_SSTORE ? `SSTORE key 0x${target}` : `TSTORE key 0x${target}`;
      }
      return null;
    }
    case "sstore_value": {
      if (op !== OP_SSTORE && op !== OP_TSTORE) return null;
      const v = partialStackHex(step, 1);
      if (v !== null && v === target.padStart(64, "0").slice(-64)) {
        return op === OP_SSTORE ? `SSTORE value 0x${target}` : `TSTORE value 0x${target}`;
      }
      return null;
    }
    case "sload_key":
    case "sload_slot": {
      if (op !== OP_SLOAD && op !== OP_TLOAD) return null;
      const slot = partialStackHex(step, 0);
      if (slot !== null && slot === target.padStart(64, "0").slice(-64)) {
        return op === OP_SLOAD ? `SLOAD key 0x${target}` : `TLOAD key 0x${target}`;
      }
      return null;
    }
    case "sload_value": {
      // 依赖后端 storage_changes
      return null;
    }
    case "call_address": {
      if (op !== OP_CALL && op !== OP_STATICCALL && op !== OP_DELEGATECALL) return null;
      const addr = partialStackHex(step, 1);
      if (addr !== null && addr.endsWith(target.replace(/^0+/, ""))) {
        const opName = op === OP_CALL ? "CALL" : op === OP_STATICCALL ? "STATICCALL" : "DELEGATECALL";
        return `${opName} → 0x${target}`;
      }
      return null;
    }
    case "call_selector": {
      if (op !== OP_CALL && op !== OP_STATICCALL && op !== OP_DELEGATECALL) return null;
      const cd = step.calldata;
      if (!cd) return null;
      const sel = normalizeHex(cd).slice(0, 8);
      if (sel === target.slice(0, 8)) return `Call selector 0x${target.slice(0, 8)}`;
      return null;
    }
    case "log_topic": {
      if (op < OP_LOG1 || op > OP_LOG4) return null;
      const topic = partialStackHex(step, 2);
      if (topic !== null && topic === target.padStart(64, "0").slice(-64)) return `LOG topic 0x${target}`;
      return null;
    }
    // 帧级字段由后端扫描
    case "contract_address":
    case "target_address":
    case "frame_call_address":
      return null;
  }
}

/* Scan hits */

export interface ScanHit {
  step_index: number;
  transaction_id: number;
  context_id: number;
  pc: number;
  opcode: number;
  description: string;
  /** 命中条件类型，与 PauseConditionType 一致；AND 组合时为多条 */
  cond_types?: string[];
}

/** 条件类型转主类/子类 */
export function condTypeToMainSub(condType: string): { main: string; sub: string } {
  const legacy: Record<string, { main: string; sub: string }> = {
    sstore_slot: { main: "sstore", sub: "key" },
    sload_slot: { main: "sload", sub: "key" },
  };
  if (legacy[condType]) return legacy[condType];
  const i = condType.indexOf("_");
  if (i <= 0) return { main: condType, sub: "" };
  return { main: condType.slice(0, i), sub: condType.slice(i + 1) };
}

/** 去掉描述里的类型前缀，仅保留细节 */
export function scanHitDetailOnly(description: string, condTypes?: string[]): string {
  if (!condTypes?.length) return description;
  const chunks = description.split(/\s+AND\s+/);
  if (chunks.length !== condTypes.length) return description;
  return chunks
    .map((chunk, i) => stripScanDescriptionPrefix(chunk.trim(), condTypes[i]))
    .join(" · ");
}

function stripScanDescriptionPrefix(s: string, condType: string): string {
  const re: Record<string, RegExp> = {
    sstore_key: /^(SSTORE|TSTORE)\s+key\s+slot\s+/i,
    sstore_slot: /^(SSTORE|TSTORE)\s+key\s+slot\s+/i,
    sstore_value: /^(SSTORE|TSTORE)\s+value\s+/i,
    sload_key: /^(SLOAD|TLOAD)\s+key\s+slot\s+/i,
    sload_slot: /^(SLOAD|TLOAD)\s+key\s+slot\s+/i,
    sload_value: /^(SLOAD|TLOAD)\s+loaded\s+value\s+/i,
    call_address: /^(CALL|STATICCALL|DELEGATECALL)\s+→\s+/i,
    call_selector: /^(CALL|STATICCALL|DELEGATECALL)\s+selector\s+/i,
    log_topic: /^LOG\s+topic\s+/i,
    contract_address: /^Contract\s+/i,
    target_address: /^Target\s+/i,
    frame_call_address: /^Frame\s+call\s+target\s+/i,
  };
  const pattern = re[condType];
  if (!pattern) return s;
  return s.replace(pattern, "").trim();
}

interface ScanConditionPayload {
  _id: string;
  type: PauseConditionType;
  value: string;
  enabled: boolean;
}

interface ScanGroupPayload {
  _id: string;
  logic: "AND" | "OR";
  conditions: ScanConditionPayload[];
}

function toScanCondition(cond: PauseCondition): ScanConditionPayload {
  return {
    _id: cond.id,
    type: cond.type,
    value: cond.value,
    enabled: cond.enabled,
  };
}

function toScanGroup(group: ConditionGroup): ScanGroupPayload {
  return {
    _id: group.id,
    logic: group.logic,
    conditions: group.conditions.map(toScanCondition),
  };
}

/** 扫描单个叶子条件 */
async function scanLeaf(
  cond: PauseCondition,
  sessionId?: string,
  transactionId?: number | null,
): Promise<Set<number>> {
  if (!cond.enabled) return new Set();
  const { invoke } = await import("@tauri-apps/api/core");
  const payload: Record<string, unknown> = {
    sessionId,
    conditions: [{ _id: "leaf", logic: "OR", conditions: [toScanCondition(cond)] }],
  };
  if (transactionId != null) payload.transactionId = transactionId;
  const hits: ScanHit[] = await invoke("scan_conditions", payload);
  return new Set<number>(hits.map(h => h.step_index));
}

/** 递归扫描 CondNode 树并合并结果 */
async function evalCondNode(
  node: CondNode,
  sessionId?: string,
  transactionId?: number | null,
): Promise<{ hitSet: Set<number>; hits: ScanHit[] }> {
  if (node.kind === "leaf") {
    const hitSet = await scanLeaf(node.cond, sessionId, transactionId);
    // 需要完整 ScanHit
    if (hitSet.size === 0) return { hitSet, hits: [] };
    const { invoke } = await import("@tauri-apps/api/core");
    const payload: Record<string, unknown> = {
      sessionId,
      conditions: [{ _id: "leaf", logic: "OR", conditions: [toScanCondition(node.cond)] }],
    };
    if (transactionId != null) payload.transactionId = transactionId;
    const hits: ScanHit[] = await invoke("scan_conditions", payload);
    return { hitSet, hits };
  }

  const [leftResult, rightResult] = await Promise.all([
    evalCondNode(node.left, sessionId, transactionId),
    evalCondNode(node.right, sessionId, transactionId),
  ]);

  let hitSet: Set<number>;
  if (node.op === "AND") {
    hitSet = new Set([...leftResult.hitSet].filter(i => rightResult.hitSet.has(i)));
  } else {
    hitSet = new Set([...leftResult.hitSet, ...rightResult.hitSet]);
  }

  // 仅保留最终命中步骤
  const combined = [...leftResult.hits, ...rightResult.hits].filter(h => hitSet.has(h.step_index));
  // 同一步骤去重
  const seen = new Set<number>();
  const hits = combined.filter(h => { if (seen.has(h.step_index)) return false; seen.add(h.step_index); return true; });
  hits.sort((a, b) => a.step_index - b.step_index);

  return { hitSet, hits };
}

/** 扫描 CondNode[]（新）或 ConditionGroup[]（兼容） */
export async function rebuildConditionHitSet(
  groupsOrNodes: ConditionGroup[] | CondNode[],
  sessionId?: string,
  /** 仅扫描指定 transactionId；空值表示全部 */
  transactionId?: number | null,
): Promise<{ hitSet: Set<number>; hits: ScanHit[] }> {
  if (groupsOrNodes.length === 0) return { hitSet: new Set(), hits: [] };

  // 新版 CondNode[] / 旧版 ConditionGroup[]
  if ((groupsOrNodes[0] as CondNode).kind !== undefined) {
    // 新路径：多根节点按 OR 合并
    const nodes = groupsOrNodes as CondNode[];
    const results = await Promise.all(nodes.map(n => evalCondNode(n, sessionId, transactionId)));
    const hitSet = new Set<number>(results.flatMap(r => [...r.hitSet]));
    const seen = new Set<number>();
    const hits = results.flatMap(r => r.hits)
      .filter(h => { if (seen.has(h.step_index)) return false; seen.add(h.step_index); return true; });
    hits.sort((a, b) => a.step_index - b.step_index);
    return { hitSet, hits };
  }

  // 旧路径：直接传 groups 给 Rust
  const groups = groupsOrNodes as ConditionGroup[];
  const { invoke } = await import("@tauri-apps/api/core");
  const legacyPayload: Record<string, unknown> = {
    sessionId,
    conditions: groups.map(toScanGroup),
  };
  if (transactionId != null) legacyPayload.transactionId = transactionId;
  const hits: ScanHit[] = await invoke("scan_conditions", legacyPayload);
  const hitSet = new Set<number>(hits.map(h => h.step_index));
  return { hitSet, hits };
}
