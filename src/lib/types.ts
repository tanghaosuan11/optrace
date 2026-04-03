/**
 * 集中管理项目中使用的共享类型
 * 解决类型定义分散在 messageHandlers / debugStore / StorageViewer 等多处的问题
 */

import type { Opcode } from "./opcodes";
import type { ParsedStepBatchResult, StepData } from "./stepPlayer";

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
}

export type CallTreeNodeType = 'frame' | 'sload' | 'sstore' | 'tload' | 'tstore' | 'log';

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
    slot?: string;
    newValue?: string;
    oldValue?: string;
    topics?: string[];
    logData?: string;
    selfdestructContract?: string;
    selfdestructTarget?: string;
    selfdestructValue?: string;
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
