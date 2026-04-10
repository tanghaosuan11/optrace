/**
 * 集中管理项目中使用的共享类型
 * 解决类型定义分散在 messageHandlers / debugStore / StorageViewer 等多处的问题
 */

import type { Opcode } from "./opcodes";
import type { ParsedStepBatchResult, StepData, StepStackEntry } from "./stepPlayer";

export enum MsgType {
    StepBatch = 1,
    ContractSource = 2,
    ContextUpdateAddress = 3,
    Logs = 4,
    MemoryUpdate = 5,
    ReturnData = 6,
    StorageChange = 7,
    FrameEnter = 8,
    FrameExit = 9,
    SelfDestruct = 10,
    BalanceChanges = 11,
    KeccakOp = 12,
    StateChange = 13,
    FoundrySourceJson = 14,
    Finished = 255,
}

export enum InstructionResult {
    Stop = 0x01,
    Return = 0x02,
    SelfDestruct = 0x03,
    Revert = 0x10,
    CallTooDeep = 0x11,
    OutOfFunds = 0x12,
    CreateInitCodeStartingEF00 = 0x13,
    InvalidEOFInitCode = 0x14,
    InvalidExtDelegateCallTarget = 0x15,
    OutOfGas = 0x20,
    MemoryOOG = 0x21,
    MemoryLimitOOG = 0x22,
    PrecompileOOG = 0x23,
    InvalidOperandOOG = 0x24,
    ReentrancySentryOOG = 0x25,
    OpcodeNotFound = 0x26,
    CallNotAllowedInsideStatic = 0x27,
    StateChangeDuringStaticCall = 0x28,
    InvalidFEOpcode = 0x29,
    InvalidJump = 0x2a,
    NotActivated = 0x2b,
    StackUnderflow = 0x2c,
    StackOverflow = 0x2d,
    OutOfOffset = 0x2e,
    CreateCollision = 0x2f,
    OverflowPayment = 0x30,
    PrecompileError = 0x31,
    NonceOverflow = 0x32,
    CreateContractSizeLimit = 0x33,
    CreateContractStartingWithEF = 0x34,
    CreateInitCodeSizeLimit = 0x35,
    FatalExternalError = 0x36,
}

export interface LogEntry {
    address: string;
    topics: string[];
    data: string;
    stepIndex: number;
    contextId: number;
    /** 多笔调试：全局 trace 中该步所属交易下标（0 起，与后端一致）；单笔或未附带时可缺省 */
    transactionId?: number;
}

export interface MemoryPatch {
    frameStepCount: number;
    dstOffset: number;
    data: Uint8Array;
}

export interface MemorySnapshot {
    frameStepCount: number;
    memory: string;
}

export interface ReturnDataEntry {
    stepIndex: number;
    contextId: number;
    data: string;
    transactionId?: number;
}

export interface StorageChangeEntry {
    storageType: "storage" | "tstorage";
    isRead: boolean;
    stepIndex: number;
    contextId: number;
    address: string;
    key: string;
    hadValue: string;
    newValue: string;
    /** 多笔调试：交易下标（0 起）；旧包体或未附带时可缺省 */
    transactionId?: number;
}

export type StateChangeCategory = "account" | "balance" | "nonce";
export type StateChangeKind =
    | "AccountCreated" | "AccountDestroyed"
    | "BalanceChange" | "BalanceTransfer"
    | "NonceChange" | "NonceBump";

/** EVM journal 中捕获的账户/余额/nonce 变化事件 */
export interface StateChangeEntry {
    stepIndex: number;
    transactionId: number;
    frameId: number;
    category: StateChangeCategory;
    kind: StateChangeKind;
    // AccountCreated / AccountDestroyed / NonceChange / NonceBump / BalanceChange
    address?: string;
    // AccountCreated
    isCreatedGlobally?: boolean;
    // AccountDestroyed
    target?: string;
    hadBalance?: string;
    // BalanceChange
    oldBalance?: string;
    newBalance?: string;
    // BalanceTransfer
    from?: string;
    to?: string;
    balance?: string;
    // NonceChange / NonceBump
    previousNonce?: number;
    newNonce?: number;
}

export interface StateDiff {
    address: string;
    key: string;
    oldValue: string;
    newValue: string;
}

// 余额变化（由 BalanceChanges 消息传输）
interface BalanceTokenChange {
    contract: string;  // 代币合约地址
    delta: string;     // "+123456" 或 "-123456"
}

export interface AddressBalance {
    /** 多笔调试：该余额变化所属交易下标（0 起）；单笔可缺省 */
    transactionId?: number;
    address: string;
    eth: string | null;   // "+xxx" | "-xxx" | null
    tokens: BalanceTokenChange[];
}

export interface CallFrame {
    id: string;
    contextId: number;
    /** 多笔调试：交易下标（0 起）；单笔缺省为 0 */
    transactionId?: number;
    parentId?: number;
    depth: number;
    callType?: "call" | "staticcall" | "delegatecall" | "create" | "create2";
    address?: string;
    caller?: string;
    target?: string;
    contract?: string;
    gasLimit?: number;
    gasUsed?: number;
    value?: string;
    input?: string;
    bytecode?: string;
    opcodes: Opcode[];
    stack: string[];
    memory: string;
    storageChanges: StorageChangeEntry[];
    currentPc?: number;
    currentGasCost?: number;
    logs: LogEntry[];
    memoryPatches: MemoryPatch[];
    memorySnapshots: MemorySnapshot[];
    returnDataList: ReturnDataEntry[];
    exitCode?: number;
    success?: boolean;
    exitOutput?: string;
    selfdestructContract?: string;
    selfdestructTarget?: string;
    selfdestructValue?: string;
    /** Foundry VM cheat code 帧（assertEq/prank 等），无 EVM 步骤 */
    isVmHelper?: boolean;
    /** VM cheat code 调用参数原始文本，如 `10000 [1e4], 10000 [1e4]` */
    vmHelperArgs?: string;
    /** VM helper 专用：calltree 中紧随其后的第一个真实 EVM 兄弟帧 contextId，前端据此精确插入 */
    vmInsertBeforeCtxId?: number;
    /** Foundry 模式：Sourcify 兼容的源码+sourcemap JSON，仅内存，不持久化到磁盘 */
    foundrySourceJson?: string;
}

export type CallTreeNodeType = 'frame' | 'sload' | 'sstore' | 'tload' | 'tstore' | 'log' | 'keccak256';

export interface CallTreeNode {
    id: number;
    type: CallTreeNodeType;
    stepIndex: number;
    /** 多笔调试：与 contextId 共同区分一帧；缺省 0 */
    transactionId?: number;
    contextId: number;
    depth: number;
    callType?: string;
    address?: string;
    caller?: string;
    target?: string;
    value?: string;
    input?: string;
    success?: boolean;
    gasUsed?: number;
    reverted?: boolean;
    /** True when this frame itself succeeded but an ancestor frame failed, causing its state changes to be rolled back. */
    revertedByParent?: boolean;
    slot?: string;
    newValue?: string;
    oldValue?: string;
    topics?: string[];
    logData?: string;
    /** KECCAK256: input byte length */
    keccakInputLength?: number;
    /** KECCAK256: short hex preview of input (full input may be large) */
    keccakInputPreview?: string;
    /** KECCAK256: 32-byte result 0x… */
    keccakHash?: string;
    selfdestructContract?: string;
    selfdestructTarget?: string;
    selfdestructValue?: string;
    /** VM helper 帧的参数原始文本 */
    vmHelperArgs?: string;
}

/** KeccakOp 消息解析结果 */
export interface KeccakEntry {
    transactionId: number;
    contextId: number;
    stepIndex: number;
    /** 32字节 hash， hex 0x... */
    hash: string;
    /** 完整输入 hex 0x... */
    input: string;
    /** 输入字节数 */
    inputLength: number;
}

export interface MessageRuntimeState {
    /** key = `${transactionId}:${contextId}` */
    pendingFrameEnters: Map<string, Record<string, unknown>>;
    /** key = `${transactionId}:${contextId}` */
    frameByCtx: Map<string, CallFrame>;
    /** 每个 scope 在全局 trace 中首次出现的步下标 — 避免 ContractSource 时对 allSteps findIndex。 */
    firstStepIndexByScope: Map<string, number>;
    disasmCache: Map<string, Opcode[]>;
    callFramesFlushTimer: ReturnType<typeof setTimeout> | null;
    debugStartPerfMs: number | null;
    finishedPerfLogged: boolean;
    perfStreamLastLogMs: number;
    perfStepBatchCount: number;
    perfStepParseMs: number;
    perfStepIndexMs: number;
    perfContractSourceCount: number;
    perfContractDisasmMs: number;
    perfContractHexMs: number;
    stepBatchWorker: Worker | null;
    stepBatchRequestSeq: number;
    stepBatchNextResultSeq: number;
    stepBatchPendingCount: number;
    stepBatchPendingResults: Map<number, ParsedStepBatchResult>;
    finishedDeferred: boolean;
    startDebugInFlight: boolean;
    /** 流式阶段暂存的 compact 批次，Finished 时一次性展开 */
    allCompactBatches: Array<{ compact: Float64Array; stackEntries: StepStackEntry[] }>;
    /** 流式阶段已接收总步数（allStepsRef 在 Finished 后才填充） */
    totalStreamedStepCount: number;
    /** KeccakOp 消息橊，tid → contextId → stepIndex，与 storageChangeMap 结构一致 */
    keccakOps: Map<number, Map<number, Map<number, KeccakEntry>>>;
}

export interface MessageHandlerContext {
    allStepsRef: React.RefObject<StepData[]>;
    callFramesRef: React.RefObject<CallFrame[]>;
    currentStepIndexRef: React.RefObject<number>;
    /** key = `${transactionId}:${contextId}` */
    stepIndexByContext: React.RefObject<Map<string, number[]>>;
    opcodeIndex: React.RefObject<Map<number, number[]>>;
    setStepCount: (count: number) => void;
    setCallFrames: React.Dispatch<React.SetStateAction<CallFrame[]>>;
    setActiveTab: (tabId: string) => void;
    setIsDebugging: (isDebugging: boolean) => void;
    applyStep: (index: number) => void;
    callTreeRef: React.RefObject<CallTreeNode[]>;
    runtime: MessageRuntimeState;
}
