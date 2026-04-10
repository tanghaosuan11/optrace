//! Foundry dump JSON 解析
//! forge test --debug --dump <path> 输出的解析
//! 
//! 优化：
//! - mimalloc 多线程分配
//! - mmap + Sequential advise 预读
//! - memchr SIMD 搜索
//! - sonic-rs SIMD 迭代
//! - rayon 并行解析
//! - msgpack 缓存

use memmap2::Mmap;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::path::Path;
use std::time::SystemTime;
use revm::primitives::U256;

// ─── 数据结构 ────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct FoundryDebugNode {
    pub address: String,
    pub kind: String,
    pub calldata: String,
    pub steps: Vec<FoundryDebugStep>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct FoundryDebugStep {
    pub pc: u32,
    pub op: u8,
    pub stack: Vec<String>,
    pub push_stack: Option<Vec<String>>,
    pub memory: Option<String>,
    pub returndata: Option<String>,
    pub gas_remaining: u64,
    pub gas_refund_counter: u64,
    pub gas_used: u64,
    pub gas_cost: u64,
    pub storage_change: Option<FoundryStorageChange>,
    pub status: Option<String>,
    pub immediate_bytes: Option<String>,
    pub decoded: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct FoundryStorageChange {
    pub key: String,
    pub value: String,
    pub had_value: Option<String>,
    pub is_write: Option<bool>,
}

// ─── 缓存 ────────────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize)]
struct CacheFile {
    dump_mtime_secs: u64,
    nodes: Vec<FoundryDebugNode>,
}

fn cache_path_for(dump_path: &str) -> String {
    let p = Path::new(dump_path);
    let stem = p.file_stem().unwrap_or_default().to_string_lossy();
    let parent = p.parent().map(|x| x.to_string_lossy().to_string()).unwrap_or_default();
    format!("{}/.{}.optrace.msgpack", parent, stem)
}

fn dump_mtime_secs(dump_path: &str) -> Option<u64> {
    std::fs::metadata(dump_path)
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
}

fn try_load_cache(dump_path: &str) -> Option<Vec<FoundryDebugNode>> {
    let cache = cache_path_for(dump_path);
    let mtime = dump_mtime_secs(dump_path)?;
    let bytes = std::fs::read(&cache).ok()?;
    let cf: CacheFile = rmp_serde::from_slice(&bytes).ok()?;
    if cf.dump_mtime_secs == mtime { Some(cf.nodes) } else { None }
}

fn write_cache(dump_path: &str, nodes: &[FoundryDebugNode]) {
    let Some(mtime) = dump_mtime_secs(dump_path) else { return };
    let cf = CacheFile { dump_mtime_secs: mtime, nodes: nodes.to_vec() };
    let Ok(bytes) = rmp_serde::to_vec(&cf) else { return };
    let _ = std::fs::write(cache_path_for(dump_path), bytes);
}

// ─── 数组定位 ─────────────────────────────────────────────────────────────────────

/// 找 debug_arena 数组的完整范围（memchr SIMD + 状态机）
#[allow(dead_code)]
fn find_debug_arena_range(bytes: &[u8]) -> Result<(usize, usize), String> {
    const MARKER: &[u8] = b"\"debug_arena\"";

    let marker_pos = memchr::memmem::find(bytes, MARKER)
        .ok_or("debug_arena not found in JSON")?;

    let mut i = marker_pos + MARKER.len();
    while i < bytes.len() && bytes[i] != b'[' { i += 1; }
    if i >= bytes.len() { return Err("No [ after debug_arena".into()); }
    let array_start = i;

    i += 1;
    let mut depth: i32 = 0;
    let mut in_string = false;
    let mut escape_next = false;

    while i < bytes.len() {
        let b = bytes[i];
        if escape_next { escape_next = false; i += 1; continue; }
        if b == b'\\' && in_string { escape_next = true; i += 1; continue; }
        if b == b'"' { in_string = !in_string; i += 1; continue; }
        if in_string { i += 1; continue; }

        match b {
            b'{' => depth += 1,
            b'}' => depth -= 1,
            b']' if depth == 0 => return Ok((array_start, i)),
            _ => {}
        }
        i += 1;
    }
    Err("debug_arena array ] not found".into())
}

/// 找 debug_arena 数组 `[` 起点（memchr SIMD，只扫描开头）
fn find_debug_arena_start(bytes: &[u8]) -> Result<usize, String> {
    const MARKER: &[u8] = b"\"debug_arena\"";
    let pos = memchr::memmem::find(bytes, MARKER)
        .ok_or_else(|| "debug_arena not found in JSON".to_string())?;
    let mut i = pos + MARKER.len();
    while i < bytes.len() && bytes[i] != b'[' { i += 1; }
    if i >= bytes.len() { return Err("No [ found after debug_arena".to_string()); }
    Ok(i)
}

/// 逐 frame 找边界（备用）
#[allow(dead_code)]
fn find_frame_boundaries(bytes: &[u8]) -> Vec<(usize, usize)> {
    let mut boundaries = Vec::new();
    let mut depth: i32 = 0;
    let mut in_string = false;
    let mut escape_next = false;
    let mut frame_start: Option<usize> = None;

    let marker_pos = match memchr::memmem::find(bytes, b"\"debug_arena\"") {
        Some(pos) => pos,
        None => return boundaries,
    };

    let mut i = marker_pos + b"\"debug_arena\"".len();
    while i < bytes.len() && bytes[i] != b'[' { i += 1; }
    i += 1;

    while i < bytes.len() {
        let b = bytes[i];
        if escape_next { escape_next = false; i += 1; continue; }
        if b == b'\\' && in_string { escape_next = true; i += 1; continue; }
        if b == b'"' { in_string = !in_string; i += 1; continue; }
        if in_string { i += 1; continue; }

        match b {
            b'{' => { if depth == 0 { frame_start = Some(i); } depth += 1; }
            b'}' => { depth -= 1; if depth == 0 { if let Some(s) = frame_start.take() { boundaries.push((s, i)); } } }
            b']' if depth == 0 => break,
            _ => {}
        }
        i += 1;
    }
    boundaries
}

// ─── 主入口 ──────────────────────────────────────────────────────────────────

/// 解析 Foundry dump JSON（SIMD + 并行 + 缓存）
/// 1. memchr 找数组起点 2. sonic-rs iter 元素 3. rayon 并行解析
pub fn load_foundry_dump(dump_path: &str) -> Result<Vec<FoundryDebugNode>, String> {
    if let Some(cached) = try_load_cache(dump_path) {
        return Ok(cached);
    }

    let t_mmap = std::time::Instant::now();
    let file = File::open(dump_path)
        .map_err(|e| format!("Cannot open '{}': {}", dump_path, e))?;
    let mmap = unsafe { Mmap::map(&file).map_err(|e| format!("mmap: {}", e))? };
    #[cfg(unix)]
    { let _ = mmap.advise(memmap2::Advice::Sequential); }
    let t_mmap = t_mmap.elapsed();

    // 1. memchr 找 [ 起点
    let t_locate = std::time::Instant::now();
    let arr_start = find_debug_arena_start(&mmap)?;
    let t_locate = t_locate.elapsed();

    // 2. sonic-rs SIMD 迭代元素
    let t_scan = std::time::Instant::now();
    let raw_frames: Vec<sonic_rs::LazyValue<'_>> =
        sonic_rs::to_array_iter(&mmap[arr_start..])
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Array iteration error: {}", e))?;
    let t_scan = t_scan.elapsed();

    if raw_frames.is_empty() {
        return Err("No frames found in debug_arena".into());
    }

    // 3. rayon 并行解析 + clone（分摊到各线程）
    let t_parse = std::time::Instant::now();
    let pairs: Result<Vec<(FoundryDebugNode, FoundryDebugNode)>, String> = raw_frames
        .par_iter()
        .map(|lv| {
            let node = sonic_rs::from_str::<FoundryDebugNode>(lv.as_raw_faststr().as_ref())
                .map_err(|e| format!("Frame parse error: {}", e))?;
            let cache = node.clone();
            Ok((node, cache))
        })
        .collect();
    let t_parse = t_parse.elapsed();

    if std::env::var("OPTRACE_DEBUG").is_ok() {
        eprintln!("[foundry_dump] mmap={:?} locate={:?} iter={:?} parse+clone={:?} frames={}",
            t_mmap, t_locate, t_scan, t_parse, raw_frames.len());
    }

    let (nodes, cache_nodes) = pairs?.into_iter().unzip::<_, _, Vec<_>, Vec<_>>();
    let path = dump_path.to_string();
    std::thread::spawn(move || write_cache(&path, &cache_nodes));

    Ok(nodes)
}

/// 备选：单次解析数组版
#[allow(dead_code)]
pub fn load_foundry_dump_single_pass(dump_path: &str) -> Result<Vec<FoundryDebugNode>, String> {
    if let Some(cached) = try_load_cache(dump_path) {
        return Ok(cached);
    }

    let t_mmap = std::time::Instant::now();
    let file = File::open(dump_path)
        .map_err(|e| format!("Cannot open '{}': {}", dump_path, e))?;
    let mmap = unsafe { Mmap::map(&file).map_err(|e| format!("mmap: {}", e))? };
    #[cfg(unix)]
    { let _ = mmap.advise(memmap2::Advice::Sequential); }
    let t_mmap = t_mmap.elapsed();

    let t_scan = std::time::Instant::now();
    let (arr_start, arr_end) = find_debug_arena_range(&mmap)?;
    let t_scan = t_scan.elapsed();

    let t_parse = std::time::Instant::now();
    let nodes: Vec<FoundryDebugNode> = sonic_rs::from_slice(&mmap[arr_start..=arr_end])
        .map_err(|e| format!("Parse error: {}", e))?;
    let t_parse = t_parse.elapsed();

    if std::env::var("OPTRACE_DEBUG").is_ok() {
        eprintln!("[single-pass] mmap={:?} scan={:?} parse={:?} frames={}", t_mmap, t_scan, t_parse, nodes.len());
    }

    let path = dump_path.to_string();
    let cache_nodes = nodes.clone();
    std::thread::spawn(move || write_cache(&path, &cache_nodes));

    Ok(nodes)
}

// ─── 完整 dump 文件结构 ──────────────────────────────────────────────────────────

/// dump 文件中 contracts.sources.sources_by_id 的单个条目
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct FoundrySourceEntry {
    pub source: String,
    pub language: String,
    pub path: String,
}

/// sourcemap 单条：offset/length/index 对应 source_by_id 中的 file_id, jump 类型
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct FoundrySourceMapEntry {
    pub offset: u32,
    pub length: u32,
    /// -1 表示无源码映射（Foundry 使用 -1 作为哨兵值）
    pub index: i32,
    pub jump: u8,
    pub modifier_depth: u32,
}

/// 每个合约名下的编译制品（含 sourcemap 和 pc→ic 映射）
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct FoundryArtifact {
    pub source_map: Option<Vec<FoundrySourceMapEntry>>,
    pub source_map_runtime: Option<Vec<FoundrySourceMapEntry>>,
    /// "0" → ic_index（部署字节码）
    pub pc_ic_map: Option<HashMap<String, usize>>,
    /// "0" → ic_index（运行时字节码）
    pub pc_ic_map_runtime: Option<HashMap<String, usize>>,
    pub build_id: String,
    pub file_id: u32,
}

/// contracts.sources 字段
#[derive(Debug, Deserialize, Serialize)]
pub struct FoundrySources {
    /// build_id → ( file_id_str → SourceEntry )
    pub sources_by_id: HashMap<String, HashMap<String, FoundrySourceEntry>>,
    /// contract_name → artifacts list (同名可能多个版本)
    pub artifacts_by_name: HashMap<String, Vec<FoundryArtifact>>,
}

/// dump 文件顶层 contracts 字段
#[derive(Debug, Deserialize, Serialize)]
pub struct FoundryContracts {
    /// addr_lowercase → contract_name
    pub identified_contracts: HashMap<String, String>,
    pub sources: FoundrySources,
}

// ─── 逻辑 Frame（分组后） ─────────────────────────────────────────────────────────

/// stack 分组算法得出的「逻辑调用帧」
/// 一个逻辑帧 = 一次 EVM CALL，可能对应 debug_arena 中多个连续/非连续节点（主帧+返回后继续段）
#[derive(Debug, Clone, Serialize)]
pub struct FoundryLogicalFrame {
    pub frame_id: u16,
    pub parent_id: Option<u16>,
    pub depth: u16,
    /// 小写 hex，如 "0x9101..."
    pub address: String,
    /// "CALL" | "STATICCALL" | "DELEGATECALL" | "CREATE" | "CREATE2"
    pub kind: String,
    /// 完整 calldata hex
    pub calldata: String,
    /// 归属该逻辑帧的 debug_arena 下标（有序）
    pub node_indices: Vec<usize>,
    /// 第一个节点第一步的 gas_remaining（= gas limit 传入值）
    pub gas_limit: u64,
    /// 最终执行完后消耗的 gas
    pub gas_used: u64,
    /// 最终状态："Return" | "Stop" | "Revert" | None（root 无 status step）
    pub status: Option<String>,
    /// 返回数据 hex
    pub returndata: Option<String>,
    /// 所有节点 steps 合计数
    pub total_step_count: usize,
}

/// 用 stack 分组 debug_arena → 逻辑帧
/// 遇到新 (addr, selector) 压栈；遇到已存在的合并为续帧
pub fn group_arena_into_frames(arena: &[FoundryDebugNode]) -> Vec<FoundryLogicalFrame> {
    let mut stack: Vec<((String, String), u16)> = Vec::new(); // ((addr, sel4), frame_id)
    let mut frames: Vec<FoundryLogicalFrame> = Vec::new();

    for (i, node) in arena.iter().enumerate() {
        let addr = node.address.to_lowercase();
        // 用前 10 字节（"0x" + 8 hex chars = 4 字节 selector）做匹配键
        let sel4 = node.calldata[..node.calldata.len().min(10)].to_lowercase();
        let key = (addr.clone(), sel4);

        // 从栈顶向下搜索匹配的帧
        let match_pos = stack.iter().rposition(|(k, _)| *k == key);

        if let Some(pos) = match_pos {
            // 续帧：合并入已有帧，截断栈（子调用已返回）
            let frame_id = stack[pos].1 as usize;
            frames[frame_id].node_indices.push(i);
            stack.truncate(pos + 1);
        } else {
            // 新子帧
            let parent_id = stack.last().map(|(_, fid)| *fid);
            let depth = stack.len() as u16 + 1; // 与 inspector journaled_state.depth() 对齐，从 1 起
            let frame_id = frames.len() as u16;
            let gas_limit = node.steps.first().map_or(0, |s| s.gas_remaining);

            frames.push(FoundryLogicalFrame {
                frame_id,
                parent_id,
                depth,
                address: addr.clone(),
                kind: node.kind.clone(),
                calldata: node.calldata.clone(),
                node_indices: vec![i],
                gas_limit,
                gas_used: 0,
                status: None,
                returndata: None,
                total_step_count: 0,
            });
            stack.push((key, frame_id));
        }
    }

    // 补全 gas_used, status, returndata, step_count
    for frame in &mut frames {
        let mut total_steps = 0usize;
        for &ni in &frame.node_indices {
            let node = &arena[ni];
            total_steps += node.steps.len();
            for step in node.steps.iter().rev() {
                if step.status.is_some() {
                    frame.gas_used = step.gas_used;
                    frame.status = step.status.clone();
                    frame.returndata = step.returndata.clone();
                    break;
                }
            }
        }
        frame.total_step_count = total_steps;
    }

    frames
}

// ─── Session（完整会话） ────────────────────────────────────────────────────────

/// 一次 Foundry 调试会话，由 dump + calltree 解析后得到
pub struct FoundrySession {
    /// addr_lowercase → contract_name
    pub identified_contracts: HashMap<String, String>,
    /// build_id → file_id_str → SourceEntry
    pub sources_by_id: HashMap<String, HashMap<String, FoundrySourceEntry>>,
    /// contract_name → artifacts（含 sourcemap/pc_ic_map）
    pub artifacts_by_name: HashMap<String, Vec<FoundryArtifact>>,
    /// 原始 debug_arena 节点
    pub arena: Vec<FoundryDebugNode>,
    /// 分组后的逻辑帧
    pub frames: Vec<FoundryLogicalFrame>,
}

/// 从 optrace_dump.json 加载拼接会话
pub fn load_foundry_session(dump_path: &str) -> Result<FoundrySession, String> {
    let file = File::open(dump_path)
        .map_err(|e| format!("Cannot open '{}': {}", dump_path, e))?;
    let mmap = unsafe { Mmap::map(&file).map_err(|e| format!("mmap: {}", e))? };
    #[cfg(unix)]
    { let _ = mmap.advise(memmap2::Advice::Sequential); }

    // 用 sonic_rs::get 提取 contracts（不解析全文件）
    let contracts_lv = sonic_rs::get(&mmap[..], ["contracts"])
        .map_err(|e| format!("contracts field not found: {}", e))?;
    let contracts: FoundryContracts =
        sonic_rs::from_str(contracts_lv.as_raw_faststr().as_str())
            .map_err(|e| format!("contracts parse error: {}", e))?;

    let arena = load_foundry_dump(dump_path)?;
    let frames = group_arena_into_frames(&arena);

    Ok(FoundrySession {
        identified_contracts: contracts.identified_contracts,
        sources_by_id: contracts.sources.sources_by_id,
        artifacts_by_name: contracts.sources.artifacts_by_name,
        arena,
        frames,
    })
}

// ─── 合并 dump + calltree ────────────────────────────────────────────────

use crate::op_trace::foundry_calltree::CallTreeFrame;
use crate::op_trace::frame_manager::FrameInfo;

/// 帧来源标记
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub enum FrameSource {
    /// 真实 EVM call（来自 dump）
    DumpEVM,
    /// Foundry VM 辅助函数（仅在 calltree 中，如 assertEq/expectRevert）
    CalltreeHelper,
}

/// 返回 calltree 中未被 dump 匹配的辅助帧
pub fn extract_calltree_helpers<'a>(
    session: &FoundrySession,
    calltree_frames: &'a [CallTreeFrame],
) -> Vec<&'a CallTreeFrame> {
    let matched_ci: HashSet<usize> = match_frames(&session.frames, calltree_frames)
        .into_iter()
        .map(|(_, ci)| ci)
        .collect();
    calltree_frames
        .iter()
        .enumerate()
        .filter(|(ci, _)| !matched_ci.contains(ci))
        .map(|(_, cf)| cf)
        .collect()
}

/// 用 address + calldata selector 匹配 dump frame ↔ calltree frame
fn match_frames(
    dump_frames: &[FoundryLogicalFrame],
    calltree_frames: &[CallTreeFrame],
) -> Vec<(usize, usize)> {
    let mut pairs = Vec::new();
    let mut used_ci: HashSet<usize> = HashSet::new();

    for (di, df) in dump_frames.iter().enumerate() {
        for (ci, cf) in calltree_frames.iter().enumerate() {
            if used_ci.contains(&ci) {
                continue;
            }
            if cf.depth as u16 != df.depth {
                continue;
            }
            if cf.gas_used != df.gas_used {
                continue;
            }
            pairs.push((di, ci));
            used_ci.insert(ci);
            break;
        }
    }

    pairs
}

/// 返回属于 setUp 子树的 dump frame 的 wire_fid 集合（1-based）。
/// 供 replay_session 跳过 setUp 帧使用。
pub fn build_setup_wire_fids(
    session: &FoundrySession,
    calltree_frames: &[CallTreeFrame],
) -> HashSet<u16> {
    // 只取 setUp 子树中的帧
    let setup_frames: Vec<CallTreeFrame> = calltree_frames
        .iter()
        .filter(|f| f.is_in_setup)
        .cloned()
        .collect();

    if setup_frames.is_empty() {
        return HashSet::new();
    }

    let matches = match_frames(&session.frames, &setup_frames);
    let mut result = HashSet::new();
    for (di, _ci) in matches {
        let wire_fid = session.frames[di].frame_id + 1;
        result.insert(wire_fid);
    }
    result
}

/// 建立 wire_frame_id → emit_texts 映射，供回放时发送日志消息使用。
/// 忽略 is_in_setup 帧（setUp 函数的调用树），只处理测试函数部分的 calltree。
pub fn build_emit_texts_by_wire_fid(
    session: &FoundrySession,
    calltree_frames: &[CallTreeFrame],
) -> HashMap<u16, Vec<String>> {
    // 过滤掉 setUp 子树
    let non_setup: Vec<&CallTreeFrame> = calltree_frames
        .iter()
        .filter(|f| !f.is_in_setup)
        .collect();

    let matches = match_frames(
        &session.frames,
        // match_frames 接受 &[T]，需要传值切片
        &non_setup.iter().map(|f| (*f).clone()).collect::<Vec<_>>(),
    );

    let mut result = HashMap::new();
    for (di, ci) in matches {
        let wire_fid = session.frames[di].frame_id + 1;
        let cf = non_setup[ci];
        if !cf.emit_texts.is_empty() {
            result.insert(wire_fid, cf.emit_texts.clone());
        }
    }
    result
}

/// 合并 dump frame + calltree frame → FrameInfo
pub fn merge_dump_and_calltree(
    session: &FoundrySession,
    calltree_frames: &[CallTreeFrame],
    transaction_id: u32,
) -> Result<Vec<FrameInfo>, String> {
    let matches = match_frames(&session.frames, calltree_frames);
    let mut result = Vec::new();

    for (di, ci) in matches {
        let df = &session.frames[di];
        let cf = &calltree_frames[ci];

        let frame_info = FrameInfo {
            transaction_id,
            parent_id: df.parent_id.unwrap_or(u16::MAX),
            depth: df.depth,
            frame_id: df.frame_id,
            address: df.address.parse()
                .map_err(|_| format!("invalid address: {}", df.address))?,
            step_count: df.total_step_count,
            value: U256::from(cf.value_wei.unwrap_or(0)),
            caller: {
                if let Some(pid) = df.parent_id {
                    let parent = session.frames.get(pid as usize)
                        .ok_or("parent frame not found")?;
                    parent.address.parse()
                        .map_err(|_| format!("invalid parent address: {}", parent.address))?
                } else {
                    "0x0000000000000000000000000000000000000000".parse()
                        .map_err(|_| "invalid zero address")?
                }
            },
            target_address: df.address.parse()
                .map_err(|_| format!("invalid address: {}", df.address))?,
            selfdestruct_refund_target: None,
            selfdestruct_transferred_value: None,
            kind: match df.kind.to_uppercase().as_str() {
                "CALL" => crate::op_trace::types::CallKind::Call,
                "STATICCALL" => crate::op_trace::types::CallKind::StaticCall,
                "DELEGATECALL" => crate::op_trace::types::CallKind::DelegateCall,
                "CREATE" => crate::op_trace::types::CallKind::Create,
                "CREATE2" => crate::op_trace::types::CallKind::Create2,
                _ => return Err(format!("unknown call kind: {}", df.kind)),
            },
            gas_used: df.gas_used,
            gas_limit: df.gas_limit,
            input: hex::decode(&df.calldata)
                .unwrap_or_default()
                .into(),
            status: None,
            success: cf.status.as_deref().map_or(false, |s| s == "Return" || s == "Stop"),
            output: hex::decode(df.returndata.as_deref().unwrap_or("0x"))
                .unwrap_or_default()
                .into(),
            ret_memory_offset: 0,
            ret_memory_size: 0,
        };

        result.push(frame_info);
    }

    Ok(result)
}

// ─── Bytecode 从 out/ 目录加载 ─────────────────────────────────────────────────

/// 从 forge build 产物目录读取合约的运行时字节码。
///
/// 搜索路径：`{out_dir}/{ContractName}.sol/{ContractName}.json`
/// JSON 路径：`deployedBytecode.object`（0x 开头 hex 字符串）
///
/// 返回 `None` 表示文件不存在或格式不对。
pub fn load_bytecode_from_out(out_dir: &str, contract_name: &str) -> Option<Vec<u8>> {
    let target_file = format!("{}.json", contract_name);

    // 1. 精确路径 out/<Name>.sol/<Name>.json（普通合约）
    let exact = std::path::Path::new(out_dir)
        .join(format!("{}.sol", contract_name))
        .join(&target_file);
    if exact.exists() {
        return parse_deployed_bytecode_json(&exact);
    }

    // 2. 遍历 out/ 所有子目录搜索 {ContractName}.json
    //    覆盖测试合约 out/Foo.t.sol/FooChallenge.json 等情况
    if let Ok(entries) = std::fs::read_dir(out_dir) {
        for entry in entries.flatten() {
            if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) { continue; }
            let candidate = entry.path().join(&target_file);
            if candidate.exists() {
                return parse_deployed_bytecode_json(&candidate);
            }
        }
    }

    None
}

fn parse_deployed_bytecode_json(path: &std::path::Path) -> Option<Vec<u8>> {
    let text = std::fs::read_to_string(path).ok()?;
    let v: serde_json::Value = serde_json::from_str(&text).ok()?;
    let hex_str = v.get("deployedBytecode")?.get("object")?.as_str()?;
    let trimmed = hex_str.trim_start_matches("0x");
    hex::decode(trimmed).ok()
}

/// 为 session 中每个已知合约名加载 bytecode，返回 contract_name → bytes。
/// 只加载 `identified_contracts` 中出现的合约名（去重）。
pub fn load_all_bytecodes_from_out(
    session: &FoundrySession,
    out_dir: &str,
) -> HashMap<String, Vec<u8>> {
    let mut result = HashMap::new();
    let names: std::collections::HashSet<&str> = session
        .identified_contracts
        .values()
        .map(|s| s.as_str())
        .collect();
    for name in names {
        if let Some(bytes) = load_bytecode_from_out(out_dir, name) {
            result.insert(name.to_string(), bytes);
        }
    }
    result
}

// ─── KECCAK256 提取 ──────────────────────────────────────────────────────────

/// 从 debug_arena steps 中提取的 KECCAK256 操作记录
#[derive(Debug, Clone)]
pub struct FoundryKeccakOp {
    pub frame_id: u16,
    /// 该帧内的全局步骤下标（跨节点累计）
    pub step_index_in_frame: usize,
    /// KECCAK256 的 offset 参数（从栈 TOS 读取）
    pub offset: usize,
    /// KECCAK256 的 size 参数（从栈 TOS-1 读取）
    pub size: usize,
    /// 实际读到的 input bytes（来自当前步的 memory[offset..offset+size]）
    pub input: Vec<u8>,
    /// hash 结果（来自下一步栈顶，32 字节）
    pub hash: [u8; 32],
}

/// 从 session arena 中提取所有 KECCAK256 操作。
///
/// 算法：
/// 1. 对每个逻辑帧，按 node_indices 顺序拼接所有 steps
/// 2. 找到 op == 0x20 的步骤，从栈读 offset/size，从 memory 读 input
/// 3. 下一步的栈顶即为 hash 结果
pub fn extract_keccak_ops(session: &FoundrySession) -> Vec<FoundryKeccakOp> {
    const KECCAK256: u8 = 0x20;
    let mut result = Vec::new();

    for frame in &session.frames {
        // 拼接该帧所有步骤（跨 arena 节点）
        let all_steps: Vec<&FoundryDebugStep> = frame
            .node_indices
            .iter()
            .flat_map(|&ni| session.arena[ni].steps.iter())
            .collect();

        for (si, step) in all_steps.iter().enumerate() {
            if step.op != KECCAK256 {
                continue;
            }
            let stack = &step.stack;
            if stack.len() < 2 {
                continue;
            }
            // TOS = offset，TOS-1 = size
            let offset = stack_hex_to_usize(&stack[stack.len() - 1]);
            let size   = stack_hex_to_usize(&stack[stack.len() - 2]);

            // 从当前步内存读取 input
            let mem = mem_hex_to_bytes(step.memory.as_deref().unwrap_or(""));
            let input = if size == 0 {
                Vec::new()
            } else {
                let end = (offset + size).min(mem.len());
                let mut v = mem.get(offset..end).unwrap_or(&[]).to_vec();
                v.resize(size, 0); // 内存不足时补零
                v
            };

            // hash 来自下一步栈顶
            let Some(next) = all_steps.get(si + 1) else { continue };
            let ns = &next.stack;
            if ns.is_empty() {
                continue;
            }
            let hash = stack_hex_to_hash32(&ns[ns.len() - 1]);

            result.push(FoundryKeccakOp {
                frame_id: frame.frame_id,
                step_index_in_frame: si,
                offset,
                size,
                input,
                hash,
            });
        }
    }

    result
}

/// 将 "0x..." 栈值解析为 usize（取最低 8 字节，防止溢出）
fn stack_hex_to_usize(s: &str) -> usize {
    let trimmed = s.trim_start_matches("0x");
    // 超过 16 hex chars (8 bytes)时只取低位
    let suffix = if trimmed.len() > 16 { &trimmed[trimmed.len() - 16..] } else { trimmed };
    u64::from_str_radix(suffix, 16).unwrap_or(0) as usize
}

/// 将 "0x..." 栈值解析为 [u8; 32]（右对齐）
fn stack_hex_to_hash32(s: &str) -> [u8; 32] {
    let trimmed = s.trim_start_matches("0x");
    let bytes = hex::decode(trimmed).unwrap_or_default();
    let mut out = [0u8; 32];
    let src = if bytes.len() >= 32 { &bytes[bytes.len() - 32..] } else { &bytes };
    out[32 - src.len()..].copy_from_slice(src);
    out
}

/// 将内存 hex 字符串（带或不带 "0x"）解析为字节数组
fn mem_hex_to_bytes(s: &str) -> Vec<u8> {
    hex::decode(s.trim_start_matches("0x")).unwrap_or_default()
}

// ─── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_small() {
        let path = "/tmp/foo.json";
        if !std::path::Path::new(path).exists() { eprintln!("SKIP"); return; }

        let _ = std::fs::remove_file(cache_path_for(path));
        let t0 = std::time::Instant::now();
        let nodes = load_foundry_dump(path).expect("parse failed");
        println!("\nFirst: {} frames in {:.2?}", nodes.len(), t0.elapsed());
        assert!(nodes[0].steps[0].gas_remaining > 0);

        std::thread::sleep(std::time::Duration::from_millis(500));
        let t1 = std::time::Instant::now();
        let n2 = load_foundry_dump(path).expect("cache failed");
        println!("Cache: {} frames in {:.2?}", n2.len(), t1.elapsed());
        assert_eq!(nodes.len(), n2.len());
    }

    /// cargo test -p optrace --lib foundry_dump::tests::parse_2gb -- --nocapture --ignored
    #[test]
    #[ignore]
    fn parse_2gb() {
        let path = "/tmp/foo_large.json";
        if !std::path::Path::new(path).exists() { eprintln!("SKIP"); return; }

        let file_size = std::fs::metadata(path).unwrap().len();
        let gb = file_size as f64 / 1024.0 / 1024.0 / 1024.0;
        let mb = file_size as f64 / 1024.0 / 1024.0;
        println!("\n=== 2GB Comparison (mimalloc + mmap advise) ===");
        println!("File: {:.2}GB | Threads: {}", gb, rayon::current_num_threads());

        // A: 默认版（边界扫描 + rayon）
        let _ = std::fs::remove_file(cache_path_for(path));
        std::env::set_var("OPTRACE_DEBUG", "1");
        let t0 = std::time::Instant::now();
        let na = load_foundry_dump(path).expect("A failed");
        let ea = t0.elapsed();
        println!("\n[A] Boundary+rayon (default):");
        println!("    {} frames | {:.2?} | {:.0} MB/s", na.len(), ea, mb / ea.as_secs_f64());

        std::thread::sleep(std::time::Duration::from_secs(8));

        // B: 单次数组解析
        let _ = std::fs::remove_file(cache_path_for(path));
        let t1 = std::time::Instant::now();
        let nb = load_foundry_dump_single_pass(path).expect("B failed");
        let eb = t1.elapsed();
        println!("\n[B] Single-pass sonic-rs:");
        println!("    {} frames | {:.2?} | {:.0} MB/s", nb.len(), eb, mb / eb.as_secs_f64());
        std::env::remove_var("OPTRACE_DEBUG");

        std::thread::sleep(std::time::Duration::from_secs(8));

        // C: 缓存
        let t2 = std::time::Instant::now();
        let nc = load_foundry_dump(path).expect("C failed");
        let ec = t2.elapsed();
        println!("\n[C] Cache (msgpack): {} frames | {:.2?}", nc.len(), ec);

        println!("\n=== Result ===");
        println!("A: {:.2?} | B: {:.2?} | C: {:.2?}", ea, eb, ec);
        if ea < eb {
            println!("Winner: A ({:.1}x faster than B)", eb.as_secs_f64() / ea.as_secs_f64());
        } else {
            println!("Winner: B ({:.1}x faster than A)", ea.as_secs_f64() / eb.as_secs_f64());
        }
        assert_eq!(na.len(), nb.len());
    }

    fn dvd_project_dir() -> String {
        let home = std::env::var("HOME").unwrap_or_default();
        format!("{}/Documents/Projects/Solidity/damn-vulnerable-defi", home)
    }

    /// cargo test -p optrace --lib foundry_dump::tests::session_from_tmp -- --nocapture
    #[test]
    fn session_from_tmp() {
        let project = dvd_project_dir();
        let dump_path_s = format!("{}/optrace_dump.json", project);
        let dump_path = dump_path_s.as_str();
        if !std::path::Path::new(dump_path).exists() {
            eprintln!("SKIP: {} not found", dump_path);
            return;
        }

        let _ = std::fs::remove_file(cache_path_for(dump_path));
        let t0 = std::time::Instant::now();
        let session = load_foundry_session(dump_path).expect("session load failed");
        println!("\n=== FoundrySession ({:.2?}) ===", t0.elapsed());

        // identified_contracts
        println!("\nidentified_contracts ({}):", session.identified_contracts.len());
        for (addr, name) in &session.identified_contracts {
            println!("  {} → {}", addr, name);
        }

        // sources
        let total_sources: usize = session.sources_by_id.values().map(|m| m.len()).sum();
        println!("\nsources_by_id: {} build_ids, {} total source files", session.sources_by_id.len(), total_sources);
        println!("artifacts_by_name: {} contracts", session.artifacts_by_name.len());

        // arena
        println!("\ndebug_arena: {} nodes", session.arena.len());

        // frames
        println!("\nLogical frames ({}):", session.frames.len());
        for f in &session.frames {
            let name = session.identified_contracts.get(&f.address).map(|s| s.as_str()).unwrap_or(&f.address[..10.min(f.address.len())]);
            let indent = "  ".repeat(f.depth as usize);
            let status = f.status.as_deref().unwrap_or("?");
            println!("{indent}frame[{}] {name}::{} kind={} depth={} parent={:?} nodes={:?} gas_used={} status={}",
                f.frame_id, &f.calldata[..10.min(f.calldata.len())],
                f.kind, f.depth, f.parent_id, f.node_indices, f.gas_used, status);
        }

        assert_eq!(session.arena.len(), 21, "expected 21 arena nodes for this test dump");
        assert_eq!(session.frames.len(), 8, "expected 8 logical frames");
        assert!(session.identified_contracts.contains_key("0x7fa9385be102ac3eac297483dd6233d62b3e1496"));
        assert!(!session.artifacts_by_name.is_empty());
        println!("\nOK: all assertions passed");
    }

    /// 集成测试：dump + calltree 合并 → FrameInfo
    #[test]
    fn merge_dump_and_calltree_tmp() {
        use crate::op_trace::foundry_calltree::parse_calltree;

        let project = dvd_project_dir();
        let dump_path_s = format!("{}/optrace_dump.json", project);
        let calltree_path_s = format!("{}/optrace_calltree.json", project);
        let (dump_path, calltree_path) = (dump_path_s.as_str(), calltree_path_s.as_str());

        if !std::path::Path::new(dump_path).exists() || !std::path::Path::new(calltree_path).exists() {
            eprintln!("SKIP: dump/calltree files not found");
            return;
        }

        let session = load_foundry_session(dump_path).expect("session load failed");
        let calltree_text = std::fs::read_to_string(calltree_path).expect("read calltree");
        let calltree_frames = parse_calltree(&calltree_text);

        println!("\n=== Merge dump + calltree ===");
        println!("Dump frames: {}", session.frames.len());
        println!("Calltree frames: {}", calltree_frames.len());

        let frame_infos = merge_dump_and_calltree(&session, &calltree_frames, 0)
            .expect("merge failed");

        println!("Merged FrameInfo: {}", frame_infos.len());
        for (i, fi) in frame_infos.iter().enumerate() {
            println!("  [{}] depth={} address={:?} gas={} status={:?}",
                i, fi.depth, fi.address, fi.gas_used, fi.status);
        }

        assert!(!frame_infos.is_empty(), "should have at least one frame");
        println!("\nOK: merge successful");

        // helpers
        let helpers = extract_calltree_helpers(&session, &calltree_frames);
        println!("\nVM helpers ({}):", helpers.len());
        for h in &helpers {
            println!("  depth={} {} gas={} status={:?}",
                h.depth, h.target, h.gas_used, h.status);
        }
        assert_eq!(helpers.len(), calltree_frames.len() - frame_infos.len(),
            "helpers count mismatch");
    }

    /// 详细打印每个 FrameInfo 字段
    /// cargo test -p optrace --lib foundry_dump::tests::frame_info_detail_tmp -- --nocapture
    #[test]
    fn frame_info_detail_tmp() {
        use crate::op_trace::foundry_calltree::parse_calltree;

        let project = dvd_project_dir();
        let dump_path_s = format!("{}/optrace_dump.json", project);
        let calltree_path_s = format!("{}/optrace_calltree.json", project);
        let out_dir = format!("{}/out", project);
        let (dump_path, calltree_path) = (dump_path_s.as_str(), calltree_path_s.as_str());
        if !std::path::Path::new(dump_path).exists() || !std::path::Path::new(calltree_path).exists() {
            eprintln!("SKIP: test files not found");
            return;
        }

        let session = load_foundry_session(dump_path).expect("session load failed");
        let calltree_text = std::fs::read_to_string(calltree_path).expect("read calltree");
        let calltree_frames = parse_calltree(&calltree_text);

        let frame_infos = merge_dump_and_calltree(&session, &calltree_frames, 0)
            .expect("merge failed");

        println!("\n=== FrameInfo 详细字段 ({} frames) ===", frame_infos.len());
        for fi in &frame_infos {
            let indent = "  ".repeat(fi.depth as usize);
            let contract_name = session.identified_contracts
                .get(&format!("{:?}", fi.address).to_lowercase())
                .map(|s| s.as_str())
                .unwrap_or("unknown");
            println!(
                "{indent}frame[{}] {contract_name}",
                fi.frame_id
            );
            println!("{indent}  transaction_id  = {}", fi.transaction_id);
            println!("{indent}  frame_id        = {}", fi.frame_id);
            println!("{indent}  parent_id       = {}", fi.parent_id);
            println!("{indent}  depth           = {}", fi.depth);
            println!("{indent}  kind            = {:?}", fi.kind);
            println!("{indent}  address         = {:?}", fi.address);
            println!("{indent}  caller          = {:?}", fi.caller);
            println!("{indent}  target_address  = {:?}", fi.target_address);
            println!("{indent}  gas_limit       = {}", fi.gas_limit);
            println!("{indent}  gas_used        = {}", fi.gas_used);
            println!("{indent}  step_count      = {}", fi.step_count);
            println!("{indent}  value           = {}", fi.value);
            println!("{indent}  success         = {}", fi.success);
            let input_hex = hex::encode(&fi.input[..fi.input.len().min(16)]);
            println!("{indent}  input[..16]     = 0x{}{}", input_hex,
                if fi.input.len() > 16 { "…" } else { "" });
            let output_hex = hex::encode(&fi.output[..fi.output.len().min(16)]);
            println!("{indent}  output[..16]    = 0x{}{}", output_hex,
                if fi.output.len() > 16 { "…" } else { "" });
            println!("{indent}  status          = {:?}", fi.status);
            println!("{indent}  selfdestruct    = {:?}", fi.selfdestruct_refund_target);
        }

        // 从 out/ 加载 bytecode
        println!("\n=== Bytecode from out/ ===");
        let bytecodes = load_all_bytecodes_from_out(&session, &out_dir);
        if bytecodes.is_empty() {
            println!("  (no bytecodes found — out/ may not exist or contracts unrecognized)");
        } else {
            for (name, bytes) in &bytecodes {
                println!("  {} → {} bytes (0x{}…)", name, bytes.len(), hex::encode(&bytes[..4.min(bytes.len())]));
            }
        }

        // KECCAK256 提取
        println!("\n=== KECCAK256 ops ===");
        let keccak_ops = extract_keccak_ops(&session);
        println!("total: {}", keccak_ops.len());
        for op in &keccak_ops {
            println!("  frame={} step={} offset={:#x} size={} input=0x{} hash=0x{}",
                op.frame_id,
                op.step_index_in_frame,
                op.offset,
                op.size,
                hex::encode(&op.input[..op.input.len().min(8)]),
                hex::encode(&op.hash[..8]));
        }

        // DebugSession gap analysis（运行时打印）
        println!("\n=== DebugSession 字段覆盖分析 ===");
        println!("✅ trace        — FoundryDebugStep 有 pc/op/stack/gas → 可构建 TraceStep");
        println!("✅ frame_memories — steps.memory 字段有每步内存快照 → 可构建");
        println!("✅ step_index   — 遍历帧内 steps 即可累计全局下标 → 可构建");
        println!("✅ frame_map    — FoundryLogicalFrame 含所有 FrameRecord 字段 → 可构建");
        println!("✅ storage_changes — steps.storage_change 有 key/value/had_value/is_write");
        println!("   ⚠️  但 is_transient 不明确（dump 不区分 SSTORE vs TSTORE）");
        println!("✅ frame_terminal_states — 末步 stack/memory/pc/op → 可构建");
        println!("✅ frame_bytecodes  — out/ 加载结果: {} 个合约", bytecodes.len());
        println!("✅ keccak_ops    — 从 op=0x20 步 stack/memory 提取，共 {} 个", keccak_ops.len());
        println!();
        println!("❌ state_changes    — EVM journal (balance/nonce/AccountCreated) 未在 dump 中导出");
        println!("❌ shadow           — 影子栈需单独计算（用户已知）");

        assert!(!frame_infos.is_empty());
    }
}
