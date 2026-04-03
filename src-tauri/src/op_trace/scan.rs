// 条件扫描：并行遍历 trace，返回命中步骤。

use super::debug_session;
use revm::primitives::U256;
use serde::{Deserialize, Serialize};


/// 单条扫描条件
#[derive(Deserialize)]
pub struct ScanCondition {
    pub _id: String,
    #[serde(rename = "type")]
    // sstore_key|sstore_value|sload_key|sload_value|call_address|call_selector|log_topic|contract_address|target_address|frame_call_address (+ legacy sstore_slot|sload_slot)
    pub cond_type: String,
    // hex string
    pub value: String,
}

/// 条件组（组内 AND/OR，组间 OR）
#[derive(Deserialize)]
pub struct ConditionGroup {
    pub _id: String,
    /// "AND" | "OR"
    pub logic: String,
    pub conditions: Vec<ScanCondition>,
}

/// 命中项
#[derive(Serialize)]
pub struct ScanHit {
    pub step_index: usize,
    pub transaction_id: u32,
    pub context_id: u16,
    pub pc: u32,
    pub opcode: u8,
    pub description: String,
    /// 命中的条件类型（与前端 PauseConditionType 一致）
    pub cond_types: Vec<String>,
}


/// 规范化 hex：去掉 0x，转小写
fn normalize_hex(s: &str) -> String {
    s.trim_start_matches("0x")
        .trim_start_matches("0X")
        .to_ascii_lowercase()
}

/// U256 转 64 位 hex（无 0x）
fn u256_to_hex64(v: &U256) -> String {
    format!("{:064x}", v)
}

/// 预处理后的条件
struct PreparedCond {
    cond_type: String,
    target: String,
    target_padded64: String,
}

impl PreparedCond {
    fn from(c: &ScanCondition) -> Self {
        let target = normalize_hex(&c.value);
        let target_padded64 = format!("{:0>64}", &target);
        PreparedCond {
            cond_type: c.cond_type.clone(),
            target,
            target_padded64,
        }
    }
}

/// 检查单条条件是否命中，返回描述和条件类型
/// `step_global_index` 是 `session.trace` 的下标（`storage_changes.step_index = global_index + 1`）
fn check_single(
    step_global_index: usize,
    step: &debug_session::TraceStep,
    pc: &PreparedCond,
    mem_cache: &mut std::collections::HashMap<(u32, u16, u32), Vec<u8>>,
    session: &debug_session::DebugSession,
) -> Option<(String, String)> {
    let op = step.opcode;
    let ct = || pc.cond_type.clone();
    match pc.cond_type.as_str() {
        "sstore_key" | "sstore_slot" => {
            if (op != 0x55 && op != 0x5d) || step.stack.is_empty() {
                return None;
            }
            let slot = u256_to_hex64(step.stack.last().unwrap());
            if slot == pc.target_padded64 {
                let opn = if op == 0x55 { "SSTORE" } else { "TSTORE" };
                Some((format!("{} key slot 0x{}", opn, pc.target), ct()))
            } else {
                None
            }
        }
        "sstore_value" => {
            if (op != 0x55 && op != 0x5d) || step.stack.len() < 2 {
                return None;
            }
            let val = u256_to_hex64(&step.stack[step.stack.len() - 2]);
            if val == pc.target_padded64 {
                let opn = if op == 0x55 { "SSTORE" } else { "TSTORE" };
                Some((format!("{} value 0x{}", opn, pc.target), ct()))
            } else {
                None
            }
        }
        "sload_key" | "sload_slot" => {
            if (op != 0x54 && op != 0x5c) || step.stack.is_empty() {
                return None;
            }
            let slot = u256_to_hex64(step.stack.last().unwrap());
            if slot == pc.target_padded64 {
                let opn = if op == 0x54 { "SLOAD" } else { "TLOAD" };
                Some((format!("{} key slot 0x{}", opn, pc.target), ct()))
            } else {
                None
            }
        }
        "sload_value" => {
            if op != 0x54 && op != 0x5c {
                return None;
            }
            let expect = step_global_index.saturating_add(1);
            for c in &session.storage_changes {
                if !c.is_read || c.transaction_id != step.transaction_id || c.frame_id != step.context_id {
                    continue;
                }
                if c.step_index != expect {
                    continue;
                }
                let val = u256_to_hex64(&c.new_value);
                if val == pc.target_padded64 {
                    let opn = if op == 0x54 { "SLOAD" } else { "TLOAD" };
                    return Some((format!("{} loaded value 0x{}", opn, pc.target), ct()));
                }
            }
            None
        }
        "call_address" => {
            if op != 0xf1 && op != 0xfa && op != 0xf4 {
                return None;
            }
            if step.stack.len() < 2 {
                return None;
            }
            let addr = u256_to_hex64(&step.stack[step.stack.len() - 2]);
            let addr_low = &addr[24..];
            let target_trimmed = pc.target.trim_start_matches('0');
            if addr_low.ends_with(target_trimmed) || addr_low == &pc.target_padded64[24..] {
                let op_name = match op {
                    0xf1 => "CALL",
                    0xfa => "STATICCALL",
                    _ => "DELEGATECALL",
                };
                Some((format!("{} → 0x{}", op_name, pc.target), ct()))
            } else {
                None
            }
        }
        "call_selector" => {
            if op != 0xf1 && op != 0xfa && op != 0xf4 {
                return None;
            }
            let (offset_idx, size_idx) = if op == 0xf1 {
                if step.stack.len() < 5 {
                    return None;
                }
                (step.stack.len() - 4, step.stack.len() - 5)
            } else {
                if step.stack.len() < 4 {
                    return None;
                }
                (step.stack.len() - 3, step.stack.len() - 4)
            };
            let args_offset: usize = step.stack[offset_idx].try_into().unwrap_or(usize::MAX);
            let args_size: usize = step.stack[size_idx].try_into().unwrap_or(0);
            if args_size < 4 {
                return None;
            }
            let mem = mem_cache
                .entry((step.transaction_id, step.context_id, step.frame_step))
                .or_insert_with(|| {
                    session.compute_memory_at_step(
                        step.transaction_id,
                        step.context_id,
                        step.frame_step,
                    )
                });
            if args_offset + 4 > mem.len() {
                return None;
            }
            let selector = format!(
                "{:02x}{:02x}{:02x}{:02x}",
                mem[args_offset],
                mem[args_offset + 1],
                mem[args_offset + 2],
                mem[args_offset + 3],
            );
            let target_sel = if pc.target.len() >= 8 {
                &pc.target[..8]
            } else {
                &pc.target
            };
            if selector == target_sel {
                let op_name = match op {
                    0xf1 => "CALL",
                    0xfa => "STATICCALL",
                    _ => "DELEGATECALL",
                };
                Some((format!("{} selector 0x{}", op_name, target_sel), ct()))
            } else {
                None
            }
        }
        "log_topic" => {
            if op < 0xa1 || op > 0xa4 || step.stack.len() < 3 {
                return None;
            }
            let topic = u256_to_hex64(&step.stack[step.stack.len() - 3]);
            if topic == pc.target_padded64 {
                Some((format!("LOG topic 0x{}", pc.target), ct()))
            } else {
                None
            }
        }
        "contract_address" => {
            let addr_hex = format!("{:040x}", step.contract_address);
            let target_trimmed = pc.target.trim_start_matches('0');
            if addr_hex.ends_with(target_trimmed) {
                Some((format!("Contract 0x{}", pc.target), ct()))
            } else {
                None
            }
        }
        "target_address" => {
            let addr_hex = format!("{:040x}", step.call_target);
            let target_trimmed = pc.target.trim_start_matches('0');
            if addr_hex.ends_with(target_trimmed) {
                Some((format!("Target 0x{}", pc.target), ct()))
            } else {
                None
            }
        }
        "frame_call_address" => {
            let addr_hex = format!("{:040x}", step.call_target);
            let target_trimmed = pc.target.trim_start_matches('0');
            if addr_hex.ends_with(target_trimmed) {
                Some((format!("Frame call target 0x{}", pc.target), ct()))
            } else {
                None
            }
        }
        _ => None,
    }
}

pub fn scan_conditions_impl(
    session: &debug_session::DebugSession,
    groups: &[ConditionGroup],
    transaction_id: Option<u32>,
) -> Vec<ScanHit> {
    use rayon::prelude::*;

    if groups.is_empty() || session.trace.is_empty() {
        return Vec::new();
    }

    // 预处理条件，减少循环内分配
    struct PreparedGroup {
        logic: String,
        conditions: Vec<PreparedCond>,
    }
    let prepared_groups: Vec<PreparedGroup> = groups
        .iter()
        .map(|g| PreparedGroup {
            logic: g.logic.clone(),
            conditions: g.conditions.iter().map(PreparedCond::from).collect(),
        })
        .collect();

    const CHUNK: usize = 8192;

    let mut hits: Vec<ScanHit> = session
        .trace
        .par_chunks(CHUNK)
        .enumerate()
        .flat_map(|(chunk_idx, chunk)| {
            let base = chunk_idx * CHUNK;
            let mut mem_cache: std::collections::HashMap<(u32, u16, u32), Vec<u8>> =
                std::collections::HashMap::new();
            let mut local_hits = Vec::new();

            'step: for (j, step) in chunk.iter().enumerate() {
                let i = base + j;
                if let Some(tid) = transaction_id {
                    if step.transaction_id != tid {
                        continue 'step;
                    }
                }
                // 组间 OR
                for group in &prepared_groups {
                    let is_and = group.logic == "AND";
                    if group.conditions.is_empty() {
                        continue;
                    }

                    let mut descriptions: Vec<String> = Vec::new();
                    let mut cond_types_hit: Vec<String> = Vec::new();
                    let mut group_hit = is_and;

                    for cond in &group.conditions {
                        let result = check_single(i, step, cond, &mut mem_cache, session);
                        if is_and {
                            if let Some((desc, cty)) = result {
                                descriptions.push(desc);
                                cond_types_hit.push(cty);
                            } else {
                                group_hit = false;
                                break;
                            }
                        } else {
                            if let Some((desc, cty)) = result {
                                group_hit = true;
                                descriptions.push(desc);
                                cond_types_hit.push(cty);
                                break;
                            }
                        }
                    }

                    if group_hit && !descriptions.is_empty() {
                        local_hits.push(ScanHit {
                            step_index: i,
                            transaction_id: step.transaction_id,
                            context_id: step.context_id,
                            pc: step.pc,
                            opcode: step.opcode,
                            description: descriptions.join(" AND "),
                            cond_types: cond_types_hit,
                        });
                        continue 'step;
                    }
                }
            }
            local_hits
        })
        .collect();

    hits.sort_unstable_by_key(|h| h.step_index);
    hits
}
