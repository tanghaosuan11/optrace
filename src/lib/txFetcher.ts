import { createPublicClient, http } from "viem";
import { getBackendConfig } from "./appConfig";

export interface TxData {
  txHash: string;
  from?: string;
  to?: string | null;
  value?: bigint;
  gasPrice?: bigint;
  gasLimit?: bigint;
  gasUsed?: bigint;
  data?: string;
  status?: "success" | "reverted";
}

export interface BlockData {
  blockNumber?: bigint;
  timestamp?: bigint;
  gasLimit?: bigint;
  baseFeePerGas?: bigint;
  beneficiary?: string;
  difficulty?: bigint;
  mixHash?: string;
}

/** 顶部栏多笔 TX：每笔独立 hash / Get Tx / 详情 */
export interface TxSlot {
  hash: string;
  txData: TxData | null;
  blockData: BlockData | null;
  error: string;
  isFetching: boolean;
}

export function emptyTxSlot(hash = ""): TxSlot {
  return { hash, txData: null, blockData: null, error: "", isFetching: false };
}

/** 用第一笔作为锚点，同步旧字段 `tx` / `txData` / `blockData` */
export function deriveFromTxSlots(slots: TxSlot[]): {
  tx: string;
  txData: TxData | null;
  blockData: BlockData | null;
} {
  const s0 = slots[0];
  if (!s0) return { tx: "", txData: null, blockData: null };
  let h = s0.hash.trim();
  if (h.startsWith("0x")) h = h.slice(2);
  return { tx: h, txData: s0.txData, blockData: s0.blockData };
}

// 用于传递给后端调试的数据结构
export interface TxDebugData {
  from: string;
  to: string;
  value: string;
  gasPrice: string;
  gasLimit: string;
  data: string;
}

export interface BlockDebugData {
  number: string;
  timestamp: string;
  baseFee: string;
  beneficiary: string;
  difficulty: string;
  mixHash: string;
  gasLimit: string;
}

/** 多笔手填列表（与后端 `TxDebugData` 字段一一对应，传给 `txDataList`） */
export interface TxListRow {
  from: string;
  to: string;
  value: string;
  gasPrice: string;
  gasLimit: string;
  data: string;
}

export function emptyTxListRow(): TxListRow {
  return {
    from: "",
    to: "",
    value: "",
    gasPrice: "",
    gasLimit: "",
    data: "",
  };
}

export async function fetchTxInfo(txHash: string): Promise<{ tx: TxData; block: BlockData }> {
  const { rpcUrl } = getBackendConfig();

  if (!rpcUrl) {
    throw new Error("No RPC URL configured. Please enter an RPC URL.");
  }

  // Create viem client with selected RPC
  const client = createPublicClient({
    transport: http(rpcUrl),
  });

  // Fetch transaction and receipt in parallel
  const [tx, receipt] = await Promise.all([
    client.getTransaction({ hash: txHash as `0x${string}` }),
    client.getTransactionReceipt({ hash: txHash as `0x${string}` }),
  ]);

  // Fetch block info
  const block = tx.blockNumber 
    ? await client.getBlock({ blockNumber: tx.blockNumber })
    : undefined;

  return {
    tx: {
      txHash,
      from: tx.from,
      to: tx.to,
      value: tx.value,
      gasPrice: tx.gasPrice ?? undefined,
      gasLimit: tx.gas,
      gasUsed: receipt.gasUsed,
      data: tx.input,
      status: receipt.status === "success" ? "success" : "reverted",
    },
    block: {
      blockNumber: tx.blockNumber ?? undefined,
      timestamp: block?.timestamp,
      gasLimit: block?.gasLimit,
      baseFeePerGas: block?.baseFeePerGas ?? undefined,
      beneficiary: block?.miner,
      difficulty: block?.difficulty,
      mixHash: block?.mixHash,
    }
  };
}

/** 拉取链上最新块并映射为 `BlockData`（与 `fetchTxInfo` 中 block 字段一致） */
export async function fetchLatestBlock(): Promise<BlockData> {
  const { rpcUrl } = getBackendConfig();
  if (!rpcUrl) {
    throw new Error("No RPC URL configured. Please enter an RPC URL.");
  }
  const client = createPublicClient({
    transport: http(rpcUrl),
  });
  const block = await client.getBlock();
  return {
    blockNumber: block.number ?? undefined,
    timestamp: block.timestamp,
    gasLimit: block.gasLimit,
    baseFeePerGas: block.baseFeePerGas ?? undefined,
    beneficiary: block.miner,
    difficulty: block.difficulty,
    mixHash: block.mixHash,
  };
}

/** 后端 `TxDebugData`（snake_case JSON） */
export interface BackendTxDebugData {
  from: string;
  to: string;
  value: string;
  gas_price: string;
  gas_limit: string;
  data: string;
  tx_hash?: string;
  cache_block?: string;
}

export function txListRowToBackend(r: TxListRow): BackendTxDebugData {
  return {
    from: r.from.trim(),
    to: r.to.trim(),
    value: r.value.trim() || "0",
    gas_price: r.gasPrice.trim() || "0",
    gas_limit: r.gasLimit.trim() || "21000",
    data: r.data.trim() || "0x",
  };
}

export function consecutiveTxSlotsReady(slots: TxSlot[]): TxSlot[] {
  const out: TxSlot[] = [];
  for (const s of slots) {
    if (s.txData && s.blockData) out.push(s);
    else break;
  }
  return out;
}

export function txSlotToBackendDebugData(slot: TxSlot): BackendTxDebugData | null {
  if (!slot.txData || !slot.blockData) return null;
  const t = slot.txData;
  const b = slot.blockData;
  const parentBlockStr =
    b.blockNumber != null ? String(BigInt(b.blockNumber) - 1n) : undefined;
  const o: BackendTxDebugData = {
    from: t.from || "",
    to: (t.to ?? "") || "",
    value: t.value?.toString() || "0",
    gas_price: t.gasPrice?.toString() || "0",
    gas_limit: t.gasLimit?.toString() || "0",
    data: t.data || "0x",
  };
  if (t.txHash?.trim()) o.tx_hash = t.txHash.trim();
  if (parentBlockStr !== undefined) o.cache_block = parentBlockStr;
  return o;
}

export function isValidTxListRow(r: TxListRow): boolean {
  const f = r.from.trim();
  if (!f) return false;
  const hex = f.startsWith("0x") ? f.slice(2) : f;
  return /^[0-9a-fA-F]{40}$/.test(hex);
}
