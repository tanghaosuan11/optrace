use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};

use super::debug_session::{CfgBuildCacheKey, DebugSession, FrameScopeKey};

/// 与 `CfgBuildCacheKey.payload_version` 对齐；改 opcode 折叠规则时 +1
const CFG_PAYLOAD_VERSION: u8 = 11;

const STOP: u8 = 0x00;
const JUMP: u8 = 0x56;
const JUMPI: u8 = 0x57;
const JUMPDEST: u8 = 0x5b;
const RETURN: u8 = 0xf3;
const REVERT: u8 = 0xfd;
const INVALID: u8 = 0xfe;
const SELFDESTRUCT: u8 = 0xff;

fn is_terminal(opcode: u8) -> bool {
    matches!(opcode, STOP | RETURN | REVERT | INVALID | SELFDESTRUCT)
}

/// PUSH1..PUSH32 immediate byte count
fn push_size(opcode: u8) -> usize {
    if opcode >= 0x60 && opcode <= 0x7f {
        (opcode - 0x5f) as usize
    } else {
        0
    }
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CfgBlock {
    pub id: String,
    pub start_pc: u32,
    pub end_pc: u32,
    pub opcode_lines: Vec<String>,
    pub executed: bool,
    pub hit_count: u32,
    pub first_enter_seq: u32,
    pub last_enter_seq: u32,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CfgEdge {
    pub id: String,
    pub source: String,
    pub target: String,
    pub executed: bool,
    pub hit_count: u32,
    /// First transition seq across this edge (chronological).
    pub first_seq: u32,
    /// Every `seq` when this (source→target) transition was taken (sorted, unique) — same static edge can repeat (e.g. loop).
    pub transition_seqs: Vec<u32>,
    pub is_back_edge: bool,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CfgMeta {
    pub only_executed: bool,
    pub unmapped_pcs: Vec<u32>,
    pub exit_kind: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CfgResult {
    pub transaction_id: u32,
    pub context_id: u16,
    pub blocks: Vec<CfgBlock>,
    pub edges: Vec<CfgEdge>,
    /// Each block entry in trace order (`seq` 1..=N on each step). Aligns with edge `transition_seqs`.
    pub block_entry_trace: Vec<String>,
    /// Global trace step index for each `block_entry_trace` entry (same session trace array).
    pub block_entry_global_step_indices: Vec<u32>,
    /// `gas_cost` 累加，与 `block_entry_trace` 一一对应（每次进入块的一段连续步直至离开）。
    pub block_visit_gas_totals: Vec<u64>,
    pub meta: CfgMeta,
}

fn opcode_name(op: u8) -> &'static str {
    match op {
        0x00 => "STOP",
        0x01 => "ADD", 0x02 => "MUL", 0x03 => "SUB", 0x04 => "DIV",
        0x05 => "SDIV", 0x06 => "MOD", 0x07 => "SMOD", 0x08 => "ADDMOD",
        0x09 => "MULMOD", 0x0a => "EXP", 0x0b => "SIGNEXTEND",
        0x10 => "LT", 0x11 => "GT", 0x12 => "SLT", 0x13 => "SGT",
        0x14 => "EQ", 0x15 => "ISZERO", 0x16 => "AND", 0x17 => "OR",
        0x18 => "XOR", 0x19 => "NOT", 0x1a => "BYTE", 0x1b => "SHL",
        0x1c => "SHR", 0x1d => "SAR",
        0x20 => "SHA3",
        0x30 => "ADDRESS", 0x31 => "BALANCE", 0x32 => "ORIGIN",
        0x33 => "CALLER", 0x34 => "CALLVALUE", 0x35 => "CALLDATALOAD",
        0x36 => "CALLDATASIZE", 0x37 => "CALLDATACOPY", 0x38 => "CODESIZE",
        0x39 => "CODECOPY", 0x3a => "GASPRICE", 0x3b => "EXTCODESIZE",
        0x3c => "EXTCODECOPY", 0x3d => "RETURNDATASIZE", 0x3e => "RETURNDATACOPY",
        0x3f => "EXTCODEHASH",
        0x40 => "BLOCKHASH", 0x41 => "COINBASE", 0x42 => "TIMESTAMP",
        0x43 => "NUMBER", 0x44 => "PREVRANDAO", 0x45 => "GASLIMIT",
        0x46 => "CHAINID", 0x47 => "SELFBALANCE", 0x48 => "BASEFEE",
        0x49 => "BLOBHASH", 0x4a => "BLOBBASEFEE",
        0x50 => "POP", 0x51 => "MLOAD", 0x52 => "MSTORE", 0x53 => "MSTORE8",
        0x54 => "SLOAD", 0x55 => "SSTORE", 0x56 => "JUMP", 0x57 => "JUMPI",
        0x58 => "PC", 0x59 => "MSIZE", 0x5a => "GAS", 0x5b => "JUMPDEST",
        0x5c => "TLOAD", 0x5d => "TSTORE", 0x5e => "MCOPY", 0x5f => "PUSH0",
        0x60..=0x7f => {
            const PUSHES: [&str; 32] = [
                "PUSH1","PUSH2","PUSH3","PUSH4","PUSH5","PUSH6","PUSH7","PUSH8",
                "PUSH9","PUSH10","PUSH11","PUSH12","PUSH13","PUSH14","PUSH15","PUSH16",
                "PUSH17","PUSH18","PUSH19","PUSH20","PUSH21","PUSH22","PUSH23","PUSH24",
                "PUSH25","PUSH26","PUSH27","PUSH28","PUSH29","PUSH30","PUSH31","PUSH32",
            ];
            PUSHES[(op - 0x60) as usize]
        }
        0x80..=0x8f => {
            const DUPS: [&str; 16] = [
                "DUP1","DUP2","DUP3","DUP4","DUP5","DUP6","DUP7","DUP8",
                "DUP9","DUP10","DUP11","DUP12","DUP13","DUP14","DUP15","DUP16",
            ];
            DUPS[(op - 0x80) as usize]
        }
        0x90..=0x9f => {
            const SWAPS: [&str; 16] = [
                "SWAP1","SWAP2","SWAP3","SWAP4","SWAP5","SWAP6","SWAP7","SWAP8",
                "SWAP9","SWAP10","SWAP11","SWAP12","SWAP13","SWAP14","SWAP15","SWAP16",
            ];
            SWAPS[(op - 0x90) as usize]
        }
        0xa0 => "LOG0", 0xa1 => "LOG1", 0xa2 => "LOG2", 0xa3 => "LOG3", 0xa4 => "LOG4",
        0xf0 => "CREATE", 0xf1 => "CALL", 0xf2 => "CALLCODE", 0xf3 => "RETURN",
        0xf4 => "DELEGATECALL", 0xf5 => "CREATE2", 0xfa => "STATICCALL",
        0xfd => "REVERT", 0xfe => "INVALID", 0xff => "SELFDESTRUCT",
        _ => "UNKNOWN",
    }
}

fn hex_imm_bytes(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

/// 全量 opcode 行：`0x{pc}` 前缀；PUSH1..PUSH32 / PUSH0 带完整立即数字节
fn format_instruction_line(bytecode: &[u8], pc: u32, op: u8) -> String {
    let p = pc as usize;
    let head = format!("0x{:x} ", pc);
    if p >= bytecode.len() {
        return format!("{}{}", head, opcode_name(op));
    }
    let psz = push_size(op);
    if psz > 0 && p + 1 + psz <= bytecode.len() {
        let imm = &bytecode[p + 1..p + 1 + psz];
        format!("{}{} 0x{}", head, opcode_name(op), hex_imm_bytes(imm))
    } else {
        format!("{}{}", head, opcode_name(op))
    }
}

fn opcode_lines_full(bytecode: &[u8], opcodes: &[(u32, u8)]) -> Vec<String> {
    opcodes
        .iter()
        .map(|&(pc, op)| format_instruction_line(bytecode, pc, op))
        .collect()
}

struct Instruction {
    pc: u32,
    opcode: u8,
}

/// Parse raw bytecode into instruction list (skipping PUSH immediates).
fn parse_instructions(bytecode: &[u8]) -> Vec<Instruction> {
    let mut instructions = Vec::new();
    let mut i = 0usize;
    while i < bytecode.len() {
        let opcode = bytecode[i];
        instructions.push(Instruction { pc: i as u32, opcode });
        i += 1 + push_size(opcode);
    }
    instructions
}

struct RawBlock {
    start_pc: u32,
    end_pc: u32,         // pc of last instruction in block
    end_opcode: u8,
    opcodes: Vec<(u32, u8)>, // (pc, opcode) pairs
}

/// Build static basic blocks from bytecode.
fn build_static_blocks(bytecode: &[u8]) -> Vec<RawBlock> {
    let instructions = parse_instructions(bytecode);
    if instructions.is_empty() {
        return Vec::new();
    }

    // Collect leader PCs
    let mut leader_set = std::collections::HashSet::new();
    leader_set.insert(0u32); // entry point is always a leader

    for (idx, inst) in instructions.iter().enumerate() {
        if inst.opcode == JUMPDEST {
            leader_set.insert(inst.pc);
        }
        if inst.opcode == JUMPI {
            // fallthrough of JUMPI is a leader
            if idx + 1 < instructions.len() {
                leader_set.insert(instructions[idx + 1].pc);
            }
        }
    }

    // Build blocks
    let mut blocks = Vec::new();
    let mut block_start = 0usize;

    for i in 0..instructions.len() {
        let is_last = i + 1 >= instructions.len();
        let next_is_leader = !is_last && leader_set.contains(&instructions[i + 1].pc);
        let is_jump = instructions[i].opcode == JUMP || instructions[i].opcode == JUMPI;
        let is_term = is_terminal(instructions[i].opcode);

        if is_last || next_is_leader || is_jump || is_term {
            let opcodes: Vec<(u32, u8)> = instructions[block_start..=i]
                .iter()
                .map(|inst| (inst.pc, inst.opcode))
                .collect();
            blocks.push(RawBlock {
                start_pc: instructions[block_start].pc,
                end_pc: instructions[i].pc,
                end_opcode: instructions[i].opcode,
                opcodes,
            });
            block_start = i + 1;
        }
    }

    blocks
}

pub fn build_cfg_for_frame(
    session: &DebugSession,
    transaction_id: u32,
    context_id: u16,
    only_executed: bool,
) -> CfgResult {
    let frame_key: FrameScopeKey = (transaction_id, context_id);

    // Get bytecode for this frame
    let bytecode = match session.frame_bytecodes.get(&frame_key) {
        Some(b) => b.as_slice(),
        None => {
            return CfgResult {
                transaction_id,
                context_id,
                blocks: Vec::new(),
                edges: Vec::new(),
                block_entry_trace: Vec::new(),
                block_entry_global_step_indices: Vec::new(),
                block_visit_gas_totals: Vec::new(),
                meta: CfgMeta {
                    only_executed,
                    unmapped_pcs: Vec::new(),
                    exit_kind: "no_bytecode".to_string(),
                },
            };
        }
    };

    let raw_blocks = build_static_blocks(bytecode);
    if raw_blocks.is_empty() {
        return CfgResult {
            transaction_id,
            context_id,
            blocks: Vec::new(),
            edges: Vec::new(),
            block_entry_trace: Vec::new(),
            block_entry_global_step_indices: Vec::new(),
            block_visit_gas_totals: Vec::new(),
            meta: CfgMeta {
                only_executed,
                unmapped_pcs: Vec::new(),
                exit_kind: "empty".to_string(),
            },
        };
    }

    // Build pc → block_index mapping
    let mut pc_to_block: HashMap<u32, usize> = HashMap::new();
    for (bi, blk) in raw_blocks.iter().enumerate() {
        for &(pc, _) in &blk.opcodes {
            pc_to_block.insert(pc, bi);
        }
    }

    // Prepare block IDs
    let block_ids: Vec<String> = raw_blocks
        .iter()
        .map(|b| {
            format!(
                "b:{}:{}:0x{:x}:0x{:x}",
                transaction_id, context_id, b.start_pc, b.end_pc
            )
        })
        .collect();

    // Initialize execution stats
    let n = raw_blocks.len();
    let mut block_hit_count = vec![0u32; n];
    let mut block_first_enter = vec![0u32; n];
    let mut block_last_enter = vec![0u32; n];
    let mut block_executed = vec![false; n];

    // Edge tracking: each block→block transition appends global step seq (loops → multiple seqs).
    let mut edge_stats: HashMap<(usize, usize), Vec<u32>> = HashMap::new();
    let mut unmapped_pcs: Vec<u32> = Vec::new();
    // One entry per block entry in chronological order (same `seq` as edge transition into that block).
    let mut block_entry_trace: Vec<String> = Vec::new();
    let mut block_entry_global_step_indices: Vec<u32> = Vec::new();
    let mut block_visit_gas_totals: Vec<u64> = Vec::new();

    // Get trace steps for this frame
    let step_indices = session.step_index.get(&frame_key);
    let mut seq: u32 = 0;
    let mut prev_block_idx: Option<usize> = None;
    let mut prev_in_block_idx: Option<usize> = None;
    let mut visit_gas_acc: u64 = 0;
    let mut visit_open: bool = false;

    if let Some(indices) = step_indices {
        for &gi in indices {
            let step = &session.trace[gi];
            let pc = step.pc;
            let gas_cost = step.gas_cost;

            match pc_to_block.get(&pc) {
                Some(&bi) => {
                    // Did we enter a new block?
                    let entered_new = prev_in_block_idx != Some(bi);
                    if entered_new {
                        if visit_open {
                            block_visit_gas_totals.push(visit_gas_acc);
                        }
                        seq += 1;
                        block_entry_trace.push(block_ids[bi].clone());
                        block_entry_global_step_indices.push(gi as u32);
                        visit_gas_acc = gas_cost;
                        visit_open = true;
                        block_hit_count[bi] += 1;
                        if !block_executed[bi] {
                            block_first_enter[bi] = seq;
                        }
                        block_last_enter[bi] = seq;
                        block_executed[bi] = true;

                        // Record edge from previous block
                        if let Some(from_bi) = prev_block_idx {
                            edge_stats.entry((from_bi, bi)).or_default().push(seq);
                        }
                        prev_block_idx = Some(bi);
                    } else {
                        visit_gas_acc = visit_gas_acc.saturating_add(gas_cost);
                    }
                    prev_in_block_idx = Some(bi);
                }
                None => {
                    if visit_open {
                        block_visit_gas_totals.push(visit_gas_acc);
                        visit_open = false;
                        visit_gas_acc = 0;
                    }
                    unmapped_pcs.push(pc);
                    prev_in_block_idx = None;
                    // 避免跨过未映射区域连一条虚假边
                    prev_block_idx = None;
                }
            }
        }
        if visit_open {
            block_visit_gas_totals.push(visit_gas_acc);
        }
    }

    // Dedupe unmapped PCs for meta (stable order)
    let unmapped_pcs: Vec<u32> = {
        let set: HashSet<u32> = unmapped_pcs.iter().copied().collect();
        let mut v: Vec<u32> = set.into_iter().collect();
        v.sort_unstable();
        v
    };

    // Detect exit kind (refine with frame success / gas / jump)
    let exit_kind = if let Some(indices) = step_indices {
        if let Some(&last_gi) = indices.last() {
            let last_step = &session.trace[last_gi];
            let last_op = last_step.opcode;
            let mut kind = match last_op {
                STOP => "stop",
                RETURN => "return",
                REVERT => "revert",
                INVALID => "invalid",
                SELFDESTRUCT => "selfdestruct",
                _ => "ok",
            };

            if let Some(rec) = session.frame_map.get(&frame_key) {
                if !rec.success {
                    if last_op == REVERT {
                        kind = "revert";
                    } else if last_op == INVALID {
                        kind = "invalid";
                    } else if last_step.gas_remaining == 0 {
                        kind = "oog";
                    } else if last_op == JUMP || last_op == JUMPI {
                        kind = "invalid_jump";
                    } else if kind == "ok" {
                        kind = "error";
                    }
                }
            }

            kind
        } else {
            "ok"
        }
    } else {
        "ok"
    };

    // Build static edges (fallthrough / conditional)
    let mut static_edges: HashMap<(usize, usize), bool> = HashMap::new(); // value = is_back_edge placeholder
    for (bi, blk) in raw_blocks.iter().enumerate() {
        match blk.end_opcode {
            JUMP => {
                // Dynamic target — edges come from trace only
            }
            JUMPI => {
                // Fallthrough edge
                if bi + 1 < n {
                    static_edges.insert((bi, bi + 1), false);
                }
                // Jump target comes from trace
            }
            op if is_terminal(op) => {
                // No outgoing edge
            }
            _ => {
                // Sequential fallthrough
                if bi + 1 < n {
                    static_edges.insert((bi, bi + 1), false);
                }
            }
        }
    }

    // Merge static + dynamic edges
    let mut all_edges: HashMap<(usize, usize), (u32, Vec<u32>, bool)> = HashMap::new(); // (hit, transition seqs, is_back)

    // Add static edges
    for (&(from, to), _) in &static_edges {
        all_edges.entry((from, to)).or_insert((0, Vec::new(), false));
    }

    // Add/update dynamic edges from trace
    for (&(from, to), seqs) in &edge_stats {
        let entry = all_edges.entry((from, to)).or_insert((0, Vec::new(), false));
        entry.0 = seqs.len() as u32;
        entry.1 = seqs.clone();
        // Back edge heuristic: target has smaller start_pc
        if raw_blocks[to].start_pc <= raw_blocks[from].start_pc {
            entry.2 = true;
        }
    }

    // Build output
    let mut blocks_out: Vec<CfgBlock> = Vec::with_capacity(n);
    for (bi, blk) in raw_blocks.iter().enumerate() {
        if only_executed && !block_executed[bi] {
            continue;
        }
        let opcode_lines = opcode_lines_full(bytecode, &blk.opcodes);
        blocks_out.push(CfgBlock {
            id: block_ids[bi].clone(),
            start_pc: blk.start_pc,
            end_pc: blk.end_pc,
            opcode_lines,
            executed: block_executed[bi],
            hit_count: block_hit_count[bi],
            first_enter_seq: block_first_enter[bi],
            last_enter_seq: block_last_enter[bi],
        });
    }

    // Collect kept block IDs for edge filtering
    let kept_block_ids: std::collections::HashSet<&str> =
        blocks_out.iter().map(|b| b.id.as_str()).collect();

    let mut edges_out: Vec<CfgEdge> = Vec::new();
    for (&(from, to), &(hit, ref seqs, is_back)) in &all_edges {
        let src = &block_ids[from];
        let tgt = &block_ids[to];
        if only_executed && (!kept_block_ids.contains(src.as_str()) || !kept_block_ids.contains(tgt.as_str())) {
            continue;
        }
        let executed = hit > 0;
        if only_executed && !executed {
            continue;
        }
        let mut transition_seqs: Vec<u32> = seqs.clone();
        transition_seqs.sort_unstable();
        transition_seqs.dedup();
        let first_seq = seqs.first().copied().unwrap_or(0);
        edges_out.push(CfgEdge {
            id: format!("e:{}->{}", src, tgt),
            source: src.clone(),
            target: tgt.clone(),
            executed,
            hit_count: hit,
            first_seq,
            transition_seqs,
            is_back_edge: is_back,
        });
    }

    // Add virtual exit node for abnormal termination
    if exit_kind != "ok" && exit_kind != "stop" && exit_kind != "return" {
        let exit_id = format!("exit:{}", exit_kind);
        blocks_out.push(CfgBlock {
            id: exit_id.clone(),
            start_pc: u32::MAX,
            end_pc: u32::MAX,
            opcode_lines: vec![exit_kind.to_uppercase()],
            executed: true,
            hit_count: 1,
            first_enter_seq: seq + 1,
            last_enter_seq: seq + 1,
        });
        // Connect last executed block to exit node
        if let Some(&last_bi) = prev_block_idx.as_ref() {
            let fs = seq + 1;
            edges_out.push(CfgEdge {
                id: format!("e:{}->{}", block_ids[last_bi], exit_id),
                source: block_ids[last_bi].clone(),
                target: exit_id.clone(),
                executed: true,
                hit_count: 1,
                first_seq: fs,
                transition_seqs: vec![fs],
                is_back_edge: false,
            });
            block_entry_trace.push(exit_id.clone());
            let last_gi = step_indices
                .and_then(|indices| indices.last().copied())
                .unwrap_or(0);
            block_entry_global_step_indices.push(last_gi as u32);
            block_visit_gas_totals.push(0);
        }
    }

    CfgResult {
        transaction_id,
        context_id,
        blocks: blocks_out,
        edges: edges_out,
        block_entry_trace,
        block_entry_global_step_indices,
        block_visit_gas_totals,
        meta: CfgMeta {
            only_executed,
            unmapped_pcs,
            exit_kind: exit_kind.to_string(),
        },
    }
}

fn digest_bytecode(bytecode: Option<&[u8]>) -> [u8; 32] {
    match bytecode {
        None => Sha256::digest(b"__CFG_NO_BYTECODE__").into(),
        Some(b) if b.is_empty() => Sha256::digest(b"__CFG_EMPTY_BYTECODE__").into(),
        Some(b) => Sha256::digest(b).into(),
    }
}

fn digest_trace_for_frame(session: &DebugSession, frame_key: FrameScopeKey) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update((session.trace.len() as u64).to_le_bytes());
    match session.step_index.get(&frame_key) {
        None => {
            h.update(b"no_step_index");
        }
        Some(indices) => {
            h.update((indices.len() as u64).to_le_bytes());
            for &gi in indices {
                if let Some(step) = session.trace.get(gi) {
                    h.update(step.pc.to_le_bytes());
                    h.update([step.opcode]);
                    h.update(step.gas_remaining.to_le_bytes());
                }
            }
        }
    }
    h.finalize().into()
}

fn frame_success_bucket(session: &DebugSession, frame_key: FrameScopeKey) -> u8 {
    match session.frame_map.get(&frame_key) {
        None => 0,
        Some(r) if r.success => 1,
        Some(_) => 2,
    }
}

pub fn cfg_build_cache_key(
    session: &DebugSession,
    transaction_id: u32,
    context_id: u16,
    only_executed: bool,
) -> CfgBuildCacheKey {
    let frame_key = (transaction_id, context_id);
    CfgBuildCacheKey {
        transaction_id,
        context_id,
        bytecode_digest: digest_bytecode(session.frame_bytecodes.get(&frame_key).map(|v| v.as_slice())),
        trace_digest: digest_trace_for_frame(session, frame_key),
        only_executed,
        frame_success_bucket: frame_success_bucket(session, frame_key),
        payload_version: CFG_PAYLOAD_VERSION,
    }
}

/// 带会话级缓存的 CFG 构建（新会话或 `DebugSession::new` 后缓存为空）
pub fn build_cfg_for_frame_cached(
    session: &mut DebugSession,
    transaction_id: u32,
    context_id: u16,
    only_executed: bool,
) -> Result<CfgResult, String> {
    let key = cfg_build_cache_key(session, transaction_id, context_id, only_executed);
    if let Some(bytes) = session.cfg_build_cache.get(&key) {
        return bincode::deserialize(bytes).map_err(|e| format!("cfg_build_cache decode: {e}"));
    }
    let result = build_cfg_for_frame(session, transaction_id, context_id, only_executed);
    let bytes = bincode::serialize(&result).map_err(|e| format!("cfg_build_cache encode: {e}"))?;
    session.cfg_build_cache.insert(key, bytes);
    Ok(result)
}
