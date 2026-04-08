//! Symbolic execution / Z3 solver command.

use crate::op_trace;
use super::session::*;

/// 分层回退求解的一次尝试记录
#[derive(Debug, serde::Serialize)]
pub struct FallbackAttempt {
    /// 层级描述（"full", "essential", "calldata_only" 等）
    pub tier: String,
    /// 本次尝试使用的符号变量数量
    pub source_count: usize,
    /// 结果状态（"Sat", "Unsat", "Unknown", "Error"）
    pub result_status: String,
}

/// symbolic_auto_solve 的包装返回类型
#[derive(Debug, serde::Serialize)]
pub struct AutoSolveResult {
    /// Z3 求解结果
    pub result: op_trace::symbolic::SolverResult,
    /// 失败时的说明层（SAT 时为 None）
    pub explain: Option<op_trace::symbolic::SolveExplain>,
    /// 自动发现的符号源列表
    pub sources: Vec<op_trace::symbolic::SymSource>,
    /// 自动生成的 SymConfig（供展示）
    pub auto_config: op_trace::symbolic::SymConfig,
    /// 分层回退的尝试记录（仅在触发回退时非空）
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub attempts: Vec<FallbackAttempt>,
}

/// 对已执行 trace 中指定 JUMPI 步骤进行符号化约束求解
///
/// 参数：
/// - `calldata_hex`：根交易原始 calldata，十六进制字符串（带或不带 0x 前缀）
/// - `sym_config`：符号变量配置（哪些 calldata 偏移是符号）
/// - `target_step`：目标 JUMPI 的全局步骤索引
/// - `goal`：TakeJump / SkipJump / EqualValue
/// - `z3_path`：Z3 可执行路径（默认使用 PATH 中的 z3）
#[tauri::command]
#[allow(non_snake_case)]
pub async fn symbolic_solve(
    calldata_hex: String,
    calldata_by_tx: Option<Vec<(u32, String)>>,
    sym_config: op_trace::symbolic::SymConfig,
    target_step: u32,
    goal: op_trace::symbolic::SymGoal,
    z3_path: Option<String>,
    session_id: Option<String>,
    sessionId: Option<String>,
    state: tauri::State<'_, op_trace::DebugSessionState>,
) -> Result<op_trace::symbolic::SolverResult, String> {
    let sid = resolve_required_session_id(session_id, sessionId, "symbolic_solve")?;

    // 持锁获取数据后立刻释放，避免阻塞 Z3 调用期间锁住其他命令
    let (trace, frame_depths_owned, calldata, calldata_map, offset_by_name, target_tx) = {
        let guard = state.0.lock().map_err(|e| e.to_string())?;
        let session = get_session_by_sid(&guard, &sid)?;
        let shadow = session.shadow.as_ref()
            .ok_or_else(|| "shadow 未启用，请用 enable_shadow=true 重新执行".to_string())?;

        let frame_depths = shadow.step_frame_depths().clone();
        let trace = session.trace.clone();

        if trace.is_empty() {
            return Err("trace 为空".into());
        }

        fn parse_hex_bytes(name: &str, raw: &str) -> Result<Vec<u8>, String> {
            let clean = raw.trim_start_matches("0x").trim_start_matches("0X");
            if clean.len() % 2 != 0 {
                return Err(format!("{name} 长度为奇数（{}字符），无法解析为字节序列", clean.len()));
            }
            clean.as_bytes().chunks(2)
                .map(|c| {
                    let s = std::str::from_utf8(c).unwrap_or("??");
                    u8::from_str_radix(s, 16)
                        .map_err(|_| format!("{name} 含非法十六进制字符: \"{}\"", s))
                })
                .collect::<Result<Vec<u8>, String>>()
        }

        let calldata = parse_hex_bytes("calldata_hex", &calldata_hex)?;
        let mut calldata_map: std::collections::HashMap<u32, Vec<u8>> = std::collections::HashMap::new();
        if let Some(entries) = calldata_by_tx {
            for (tx_id, hex) in entries {
                calldata_map.insert(tx_id, parse_hex_bytes(&format!("calldata_by_tx[{tx_id}]"), &hex)?);
            }
        }

        let target_idx = target_step as usize;
        if target_idx >= trace.len() {
            return Err(format!("target_step {} 越界（trace len = {}）", target_step, trace.len()));
        }
        let target_tx = trace[target_idx].transaction_id;
        let offset_by_name: std::collections::HashMap<String, usize> = sym_config
            .calldata_symbols
            .iter()
            .map(|(off, name)| (name.clone(), *off))
            .collect();

        (trace, frame_depths, calldata, calldata_map, offset_by_name, target_tx)
    }; // guard 在此释放

    // 重放符号引擎
    let engine = op_trace::symbolic::replay_from_trace(&trace, &frame_depths_owned, &calldata, &calldata_map, sym_config);

    // 找到目标步骤对应的 JUMPI 条件表达式
    let target_constraint = engine.path_constraints
        .iter()
        .find(|c| c.step == target_step)
        .ok_or_else(|| format!(
            "步骤 {} 没有符号化的 JUMPI 约束。请确认：① 该步骤是 JUMPI 指令 ② 其条件依赖了已标记的符号输入",
            target_step
        ))?;

    // 构建 SMT-LIB2
    let query = op_trace::symbolic::build_smt2_query(
        engine.constraints(),
        target_step,
        target_tx,
        &target_constraint.condition,
        &goal,
    );

    eprintln!("[symbolic_solve] SMT-LIB2 查询:\n{}", query.smt2);

    // 调用 Z3
    let mut result = op_trace::symbolic::run_z3(&query.smt2, z3_path.as_deref(), target_tx);

    // 将 calldata 变量偏移从 sym_config 显式映射到解，避免依赖变量名 `cd_<off>` 约定。
    if let op_trace::symbolic::SolverResult::Sat { inputs, .. } = &mut result {
        for inp in inputs.iter_mut() {
            if let Some(off) = offset_by_name.get(&inp.name) {
                inp.calldata_offset = Some(*off);
            }
        }
    }
    eprintln!("[symbolic_solve] Z3 结果: {:?}", result);

    Ok(result)
}

// ────────────────────────────────────────────────────────────────
// 自动倒推：slicer → auto SymConfig → symbolic_solve
// ────────────────────────────────────────────────────────────────

/// 前向污点传播结果：返回影响目标 JUMPI 条件的所有叶子符号来源
#[tauri::command]
#[allow(non_snake_case)]
pub async fn symbolic_slice(
    target_step: u32,
    session_id: Option<String>,
    sessionId: Option<String>,
    state: tauri::State<'_, op_trace::DebugSessionState>,
) -> Result<Vec<op_trace::symbolic::SymSource>, String> {
    let sid = resolve_required_session_id(session_id, sessionId, "symbolic_slice")?;
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let session = get_session_by_sid(&guard, &sid)?;

    let shadow = session.shadow.as_ref()
        .ok_or_else(|| "shadow 未启用".to_string())?;
    let frame_depths = shadow.step_frame_depths();
    let trace = &session.trace;

    if trace.is_empty() {
        return Err("trace 为空".into());
    }
    if target_step as usize >= trace.len() {
        return Err(format!("target_step {} 越界（trace len = {}）", target_step, trace.len()));
    }
    if trace[target_step as usize].opcode != 0x57 {
        return Err(format!("步骤 {} 不是 JUMPI（opcode=0x{:02x}）",
            target_step, trace[target_step as usize].opcode));
    }

    let sources = op_trace::symbolic::slice_for_jumpi(trace, frame_depths, target_step);
    Ok(sources.into_iter().collect())
}

/// 从 SymSource 集合自动构建 SymConfig
fn build_config_from_sources(
    sources: &std::collections::HashSet<op_trace::symbolic::SymSource>,
    target_tx: u32,
) -> op_trace::symbolic::SymConfig {
    use op_trace::symbolic::SymSource;
    let mut config = op_trace::symbolic::SymConfig::default();
    // 只使用目标交易的来源（避免跨 tx 符号名冲突）
    for src in sources {
        match src {
            SymSource::Calldata { tx_id, offset } if *tx_id == target_tx => {
                let name = format!("cd_{}", offset);
                if !config.calldata_symbols.iter().any(|(_, n)| n == &name) {
                    config.calldata_symbols.push((*offset, name));
                }
            }
            SymSource::Callvalue { tx_id } if *tx_id == target_tx => {
                config.callvalue_sym = true;
            }
            SymSource::Caller { tx_id } if *tx_id == target_tx => {
                config.caller_sym = true;
            }
            SymSource::Origin { tx_id } if *tx_id == target_tx => {
                config.origin_sym = true;
            }
            SymSource::Timestamp => {
                config.timestamp_sym = true;
            }
            SymSource::BlockNumber => {
                config.block_number_sym = true;
            }
            SymSource::StorageInitial { tx_id, slot } if *tx_id == target_tx => {
                // 用 slot 前 8 hex + 后 8 hex 组合，避免不同 slot 同后缀导致命名冲突
                let prefix = &slot[..slot.len().min(8)];
                let suffix = &slot[slot.len().saturating_sub(8)..];
                let name = format!("store_{}_{}", prefix, suffix);
                if !config.storage_symbols.iter().any(|(s, _)| s == slot) {
                    config.storage_symbols.push((slot.clone(), name));
                }
            }
            _ => {}
        }
    }
    config.calldata_symbols.sort_by_key(|(off, _)| *off);
    config
}

/// 获取 SolverResult 的状态字符串
fn result_status_str(r: &op_trace::symbolic::SolverResult) -> String {
    match r {
        op_trace::symbolic::SolverResult::Sat { .. } => "Sat".into(),
        op_trace::symbolic::SolverResult::Unsat { .. } => "Unsat".into(),
        op_trace::symbolic::SolverResult::Unknown { .. } => "Unknown".into(),
        op_trace::symbolic::SolverResult::Error { .. } => "Error".into(),
    }
}

/// 将 SymSource 映射为引擎中生成的符号变量名。
/// 必须与 engine.rs 中 on_step() 及 build_config_from_sources() 保持一致。
fn source_to_var_name(
    src: &op_trace::symbolic::SymSource,
    target_tx: u32,
) -> Option<String> {
    use op_trace::symbolic::SymSource;
    match src {
        SymSource::Calldata { tx_id, offset } if *tx_id == target_tx => {
            Some(format!("cd_{}", offset))
        }
        SymSource::Callvalue { tx_id } if *tx_id == target_tx => Some("callvalue".into()),
        SymSource::Caller { tx_id } if *tx_id == target_tx => Some("caller".into()),
        SymSource::Origin { tx_id } if *tx_id == target_tx => Some("origin".into()),
        SymSource::Timestamp => Some("timestamp".into()),
        SymSource::BlockNumber => Some("blocknumber".into()),
        SymSource::StorageInitial { tx_id, slot } if *tx_id == target_tx => {
            let prefix = &slot[..slot.len().min(8)];
            let suffix = &slot[slot.len().saturating_sub(8)..];
            Some(format!("store_{}_{}", prefix, suffix))
        }
        _ => None,
    }
}

/// 对一组 source 执行单次符号求解（replay + Z3）
fn try_solve_once(
    trace: &[crate::op_trace::debug_session::TraceStep],
    frame_depths: &std::collections::HashMap<u32, usize>,
    calldata: &[u8],
    calldata_map: &std::collections::HashMap<u32, Vec<u8>>,
    sources: &std::collections::HashSet<op_trace::symbolic::SymSource>,
    target_step: u32,
    target_tx: u32,
    goal: &op_trace::symbolic::SymGoal,
    z3_path: Option<&str>,
) -> Result<(
    op_trace::symbolic::SolverResult,
    op_trace::symbolic::SymConfig,
    Option<op_trace::symbolic::SolveExplain>,
), String> {
    let sym_config = build_config_from_sources(sources, target_tx);
    let offset_by_name: std::collections::HashMap<String, usize> = sym_config
        .calldata_symbols.iter().map(|(off, name)| (name.clone(), *off)).collect();

    let engine = op_trace::symbolic::replay_from_trace(
        trace, frame_depths, calldata, calldata_map, sym_config.clone(),
    );

    let target_constraint = engine.path_constraints
        .iter()
        .find(|c| c.step == target_step)
        .ok_or_else(|| "该 source 子集下目标 JUMPI 无符号约束".to_string())?;

    let query = op_trace::symbolic::build_smt2_query(
        engine.constraints(),
        target_step,
        target_tx,
        &target_constraint.condition,
        goal,
    );

    let mut result = op_trace::symbolic::run_z3(&query.smt2, z3_path, target_tx);
    if let op_trace::symbolic::SolverResult::Sat { inputs, .. } = &mut result {
        for inp in inputs.iter_mut() {
            if let Some(off) = offset_by_name.get(&inp.name) {
                inp.calldata_offset = Some(*off);
            }
        }
    }

    let explain = op_trace::symbolic::explain_solve(
        &result,
        engine.constraints(),
        target_step,
        target_tx,
        &target_constraint.condition,
        &query.sym_vars,
    );

    Ok((result, sym_config, explain))
}

/// 全自动符号求解：自动 slice → 构建 	SymConfig → replay → Z3 求解
///
/// 无需手动指定哪些 calldata 偏移是符号，系统自动倒推。
#[tauri::command]
#[allow(non_snake_case)]
pub async fn symbolic_auto_solve(
    calldata_hex: String,
    calldata_by_tx: Option<Vec<(u32, String)>>,
    target_step: u32,
    goal: op_trace::symbolic::SymGoal,
    z3_path: Option<String>,
    session_id: Option<String>,
    sessionId: Option<String>,
    state: tauri::State<'_, op_trace::DebugSessionState>,
) -> Result<AutoSolveResult, String> {
    let sid = resolve_required_session_id(session_id, sessionId, "symbolic_auto_solve")?;

    // 持锁获取数据，然后立刻释放（避免异步持锁）
    let (trace, frame_depths_owned, target_tx) = {
        let guard = state.0.lock().map_err(|e| e.to_string())?;
        let session = get_session_by_sid(&guard, &sid)?;
        let shadow = session.shadow.as_ref()
            .ok_or_else(|| "shadow 未启用，请用 enable_shadow=true 重新执行".to_string())?;
        let frame_depths = shadow.step_frame_depths().clone();
        let trace = session.trace.clone();
        if trace.is_empty() {
            return Err("trace 为空".into());
        }
        if target_step as usize >= trace.len() {
            return Err(format!("target_step {} 越界（trace len = {}）", target_step, trace.len()));
        }
        if trace[target_step as usize].opcode != 0x57 {
            return Err(format!("步骤 {} 不是 JUMPI（opcode=0x{:02x}）",
                target_step, trace[target_step as usize].opcode));
        }
        let target_tx = trace[target_step as usize].transaction_id;
        (trace, frame_depths, target_tx)
    };

    // Step 1: 前向污点传播，找出所有符号来源
    let sources = op_trace::symbolic::slice_for_jumpi(&trace, &frame_depths_owned, target_step);
    eprintln!("[symbolic_auto_solve] 发现 {} 个符号来源: {:?}", sources.len(), sources);
    if sources.is_empty() {
        return Err(format!(
            "步骤 {} 的 JUMPI 条件不依赖任何可符号化的输入（calldata/caller/storage等），无法求解",
            target_step
        ));
    }

    // Step 2: 自动构建 	SymConfig
    let sym_config = build_config_from_sources(&sources, target_tx);
    let auto_config = sym_config.clone();
    eprintln!("[symbolic_auto_solve] 自动 SymConfig: {:?}", sym_config);

    fn parse_hex_bytes(name: &str, raw: &str) -> Result<Vec<u8>, String> {
        let clean = raw.trim_start_matches("0x").trim_start_matches("0X");
        if clean.len() % 2 != 0 {
            return Err(format!("{name} 长度为奇数（{}字符）", clean.len()));
        }
        clean.as_bytes().chunks(2)
            .map(|c| {
                let s = std::str::from_utf8(c).unwrap_or("??");
                u8::from_str_radix(s, 16)
                    .map_err(|_| format!("{name} 含非法十六进制字符: \"{}\"", s))
            })
            .collect::<Result<Vec<u8>, String>>()
    }

    let calldata = parse_hex_bytes("calldata_hex", &calldata_hex)?;
    let mut calldata_map: std::collections::HashMap<u32, Vec<u8>> = std::collections::HashMap::new();
    if let Some(entries) = calldata_by_tx {
        for (tx_id, hex) in entries {
            calldata_map.insert(tx_id, parse_hex_bytes(&format!("calldata_by_tx[{tx_id}]"), &hex)?);
        }
    }

    // Step 3: 全量求解（使用所有 source）
    let z3 = z3_path.as_deref();
    let (mut result, _first_config, mut explain) =
        try_solve_once(&trace, &frame_depths_owned, &calldata, &calldata_map,
                        &sources, target_step, target_tx, &goal, z3)?;
    let mut auto_config = _first_config;
    let mut attempts = vec![FallbackAttempt {
        tier: "full".into(),
        source_count: sources.len(),
        result_status: result_status_str(&result),
    }];
    eprintln!("[symbolic_auto_solve] full 求解结果: {}", result_status_str(&result));

    // ── 分层回退：仅在 Unknown（通常是 Z3 超时）且 source > 1 时触发 ──
    if matches!(result, op_trace::symbolic::SolverResult::Unknown { .. }) && sources.len() > 1 {
        // 第一次全量重放已经获取了目标 JUMPI 条件，提取其中实际引用的变量名
        let essential_engine = op_trace::symbolic::replay_from_trace(
            &trace, &frame_depths_owned, &calldata, &calldata_map,
            build_config_from_sources(&sources, target_tx),
        );
        let condition_vars: std::collections::HashSet<String> = essential_engine
            .path_constraints.iter()
            .find(|c| c.step == target_step)
            .map(|c| c.condition.symbols())
            .unwrap_or_default();

        // Tier 1: Essential — 只保留目标条件实际引用的符号源
        let essential_sources: std::collections::HashSet<_> = sources.iter()
            .filter(|src| {
                source_to_var_name(src, target_tx)
                    .map(|n| condition_vars.contains(&n))
                    .unwrap_or(false)
            })
            .cloned()
            .collect();

        if !essential_sources.is_empty() && essential_sources.len() < sources.len() {
            eprintln!("[fallback] tier=essential, {} sources (from {})", essential_sources.len(), sources.len());
            if let Ok((r, c, e)) = try_solve_once(
                &trace, &frame_depths_owned, &calldata, &calldata_map,
                &essential_sources, target_step, target_tx, &goal, z3,
            ) {
                attempts.push(FallbackAttempt {
                    tier: "essential".into(),
                    source_count: essential_sources.len(),
                    result_status: result_status_str(&r),
                });
                if matches!(r, op_trace::symbolic::SolverResult::Sat { .. })
                    || !matches!(r, op_trace::symbolic::SolverResult::Unknown { .. })
                {
                    result = r; auto_config = c; explain = e;
                }
            }
        }

        // Tier 2: Calldata Only — 如果 essential 仍 Unknown，尝试仅 calldata 源
        if matches!(result, op_trace::symbolic::SolverResult::Unknown { .. }) {
            let calldata_sources: std::collections::HashSet<_> = sources.iter()
                .filter(|s| matches!(s, op_trace::symbolic::SymSource::Calldata { .. }))
                .cloned()
                .collect();
            if !calldata_sources.is_empty() && calldata_sources.len() < sources.len() {
                eprintln!("[fallback] tier=calldata_only, {} sources", calldata_sources.len());
                if let Ok((r, c, e)) = try_solve_once(
                    &trace, &frame_depths_owned, &calldata, &calldata_map,
                    &calldata_sources, target_step, target_tx, &goal, z3,
                ) {
                    attempts.push(FallbackAttempt {
                        tier: "calldata_only".into(),
                        source_count: calldata_sources.len(),
                        result_status: result_status_str(&r),
                    });
                    if matches!(r, op_trace::symbolic::SolverResult::Sat { .. })
                        || !matches!(r, op_trace::symbolic::SolverResult::Unknown { .. })
                    {
                        result = r; auto_config = c; explain = e;
                    }
                }
            }
        }
    }

    eprintln!("[symbolic_auto_solve] 最终结果: {:?}", result_status_str(&result));
    let sources_vec: Vec<_> = sources.into_iter().collect();
    Ok(AutoSolveResult {
        result, explain, sources: sources_vec, auto_config,
        attempts,
    })
}

// ────────────────────────────────────────────────────────────────
// P3.8 回放验证闭环
// ────────────────────────────────────────────────────────────────

/// 验证结果
#[derive(Debug, serde::Serialize)]
pub struct VerifyResult {
    /// 审计目标 JUMPI：经过查找 bytes, verified=true 表示 jump 方向按预期翻转
    pub verified: bool,
    /// 实际观察到的 condition 具体值（hex64）
    pub condition_value: String,
    /// 第一个不匹配的 calldata 片段（如果有）
    pub mismatch: Option<String>,
}

/// 将 SAT 解注入 calldata 并在符号层验证目标 JUMPI 是否翻转
///
/// 验证方法：重运行符号引擎（保留原 SymConfig），锁定所有符号变量等于 SAT 解值，
/// 用 Z3 检查 goal 是否仍可满足。若 SAT → 验证通过。
/// `solved_inputs`: 直接使用 SymInput（name + value_hex），按实际变量名 pin，
/// 不依赖 cd_ 命名约定，也能正确 pin caller/origin/storage 等符号。
#[tauri::command]
#[allow(non_snake_case)]
pub async fn symbolic_verify(
    calldata_hex: String,
    calldata_by_tx: Option<Vec<(u32, String)>>,
    target_step: u32,
    goal: op_trace::symbolic::SymGoal,
    solved_inputs: Vec<op_trace::symbolic::solver::SymInput>,
    sym_config: op_trace::symbolic::SymConfig,
    z3_path: Option<String>,
    session_id: Option<String>,
    sessionId: Option<String>,
    state: tauri::State<'_, op_trace::DebugSessionState>,
) -> Result<VerifyResult, String> {
    let sid = resolve_required_session_id(session_id, sessionId, "symbolic_verify")?;
    let (trace, frame_depths_owned, target_tx) = {
        let guard = state.0.lock().map_err(|e| e.to_string())?;
        let session = get_session_by_sid(&guard, &sid)?;
        let shadow = session.shadow.as_ref()
            .ok_or_else(|| "没有 shadow".to_string())?;
        let trace = session.trace.clone();
        let frame_depths = shadow.step_frame_depths().clone();
        let target_tx = trace.get(target_step as usize)
            .ok_or_else(|| format!("target_step {} 越界（trace len = {}）", target_step, trace.len()))?
            .transaction_id;
        (trace, frame_depths, target_tx)
    };

    fn parse_hex_bytes(name: &str, raw: &str) -> Result<Vec<u8>, String> {
        let clean = raw.trim_start_matches("0x").trim_start_matches("0X");
        if clean.len() % 2 != 0 { return Err(format!("{name} 长度为奇数")); }
        clean.as_bytes().chunks(2).map(|c| {
            u8::from_str_radix(std::str::from_utf8(c).unwrap_or("??"), 16)
                .map_err(|_| format!("{name} 含非法字符"))
        }).collect()
    }

    let calldata = parse_hex_bytes("calldata_hex", &calldata_hex)?;
    let mut calldata_map: std::collections::HashMap<u32, Vec<u8>> = Default::default();
    if let Some(entries) = calldata_by_tx {
        for (tx_id, hex) in entries {
            calldata_map.insert(tx_id, parse_hex_bytes(&format!("calldata_by_tx[{tx_id}]"), &hex)?);
        }
    }

    // 用原始 SymConfig 重运行符号引擎（保持符号追踪）
    let engine = op_trace::symbolic::replay_from_trace(
        &trace, &frame_depths_owned, &calldata, &calldata_map, sym_config,
    );

    // 找到目标 JUMPI 约束（仍应存在，因为用了相同 SymConfig）
    let target_constraint = match engine.path_constraints.iter().find(|c| c.step == target_step) {
        Some(c) => c,
        None => {
            return Ok(VerifyResult {
                verified: false,
                condition_value: "no_constraint".into(),
                mismatch: Some(
                    "重运行后目标 JUMPI 不再有符号约束——可能 SymConfig 与求解时不一致".into()
                ),
            });
        }
    };

    // 构建验证专用 SMT 查询：
    // 1. 保留路径约束（与原始求解一致）
    // 2. 额外锁定每个符号变量 = SAT 解值
    // 3. 断言 goal 方向
    // 若 SAT → 验证通过
    let query = op_trace::symbolic::build_smt2_query(
        engine.constraints(),
        target_step,
        target_tx,
        &target_constraint.condition,
        &goal,
    );

    // 在 query.smt2 的 (check-sat) 前，把每个 SAT 解变量 pin 到具体值
    // 按实际 name（cd_4, caller, store_xxx 等）而非硬编码 cd_ 约定
    let mut smt2 = query.smt2;
    let check_sat_pos = smt2.find("(check-sat)").unwrap_or(smt2.len());
    let query_sym_set: std::collections::HashSet<&str> =
        query.sym_vars.iter().map(|s| s.as_str()).collect();
    let mut pin_assertions = String::new();
    pin_assertions.push_str("\n; Pin variables to SAT solution for verification\n");
    for inp in &solved_inputs {
        // 只 pin SMT 查询中实际声明过的变量
        if !query_sym_set.contains(inp.name.as_str()) { continue; }
        let clean = inp.value_hex.trim_start_matches("0x").trim_start_matches("0X");
        let padded = format!("{:0>64}", clean);
        pin_assertions.push_str(&format!("(assert (= {} #x{}))\n", inp.name, padded));
    }
    smt2.insert_str(check_sat_pos, &pin_assertions);

    let result = op_trace::symbolic::run_z3(&smt2, z3_path.as_deref(), target_tx);
    let verified = matches!(result, op_trace::symbolic::SolverResult::Sat { .. });

    let syms: Vec<String> = target_constraint.condition.symbols().into_iter().collect();
    Ok(VerifyResult {
        verified,
        condition_value: format!("symbols: {}", syms.join(",")),
        mismatch: if !verified {
            Some(format!("Z3 验证结果: {:?}", result))
        } else {
            None
        },
    })
}
