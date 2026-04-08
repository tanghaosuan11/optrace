//! Shadow / data-flow tauri commands.

use crate::op_trace;
use super::session::*;

/// 解析调试 tab：`frame-{transaction_id}-{context_id}` 或旧版 `frame-{context_id}`（单笔）。
fn parse_frame_tab_id(raw: &str) -> (Option<u16>, Option<u32>) {
    let rest = match raw.trim().strip_prefix("frame-") {
        Some(r) => r,
        None => return (None, None),
    };
    let mut parts = rest.splitn(2, '-');
    let first = parts.next().unwrap_or("");
    match parts.next() {
        Some(second) => {
            if let (Ok(tid), Ok(cid)) = (first.parse::<u32>(), second.parse::<u16>()) {
                return (Some(cid), Some(tid));
            }
        }
        None => {
            if let Ok(n) = first.parse::<u16>() {
                return (Some(n), None);
            }
        }
    }
    (None, None)
}

/// 返回数据流树形结构，用于前端显示
#[tauri::command]
pub async fn backward_slice_tree(
    global_step: u32,
    stack_depth: Option<u32>,
    value_hint: Option<String>,
    phase: Option<String>,
    frame_id: Option<String>,
    session_id: Option<String>,
    #[allow(non_snake_case)] sessionId: Option<String>,
    state: tauri::State<'_, op_trace::DebugSessionState>,
) -> Result<op_trace::shadow::DataFlowTree, String> {
    eprintln!("[backward_slice_tree] ========== 数据流查询开始 ==========");
    eprintln!("[backward_slice_tree] 全局步骤: {}", global_step);
    eprintln!("[backward_slice_tree] ❗ 栈深度(原始): {:?}", stack_depth);
    eprintln!("[backward_slice_tree] 数值: {:?}", value_hint);
    eprintln!("[backward_slice_tree] phase: {:?}", phase);
    eprintln!("[backward_slice_tree] frame_id(raw): {:?}", frame_id);

    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let sid = resolve_required_session_id(session_id, sessionId, "backward_slice_tree")?;
    let session = get_session_by_sid(&guard, &sid)?;
    let shadow = session.shadow.as_ref().ok_or("Shadow state not available")?;

    eprintln!("[backward_slice_tree] shadow 节点总数: {}", shadow.node_count());
    eprintln!(
        "[backward_slice_tree] 📍 即将调用backward_slice_tree: global_step={}, stack_depth={:?}, phase={:?}, frame_id={:?}",
        global_step, stack_depth, phase, frame_id
    );

    let value_hint_str = value_hint.as_deref();
    let phase_str = phase.as_deref();
    let (frame_id_num, frame_tx_filter) = frame_id
        .as_deref()
        .map(parse_frame_tab_id)
        .unwrap_or((None, None));
    let result = shadow.backward_slice_tree(
        global_step,
        stack_depth,
        value_hint_str,
        phase_str,
        frame_id_num,
        frame_tx_filter,
    )?;

    eprintln!("[backward_slice_tree] ✓ 查询完成: {} 个节点", result.nodes.len());
    eprintln!("[backward_slice_tree] ========== 数据流查询结束 ==========");

    Ok(result)
}

/// 打印指定范围步骤的详细调试信息
#[tauri::command]
pub async fn debug_shadow_steps(
    start: u32,
    end: u32,
    session_id: Option<String>,
    #[allow(non_snake_case)] sessionId: Option<String>,
    state: tauri::State<'_, op_trace::DebugSessionState>,
) -> Result<String, String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let sid = resolve_required_session_id(session_id, sessionId, "debug_shadow_steps")?;
    let session = get_session_by_sid(&guard, &sid)?;
    let shadow = session.shadow.as_ref().ok_or("Shadow state not available")?;

    shadow.debug_steps(start as usize, end as usize);
    Ok(format!("已打印步骤 {} 到 {} 的调试信息到控制台", start, end))
}

/// 导出所有步骤的影子信息到tmp文件
#[tauri::command]
pub async fn export_all_shadow_steps(
    session_id: Option<String>,
    #[allow(non_snake_case)] sessionId: Option<String>,
    state: tauri::State<'_, op_trace::DebugSessionState>,
) -> Result<String, String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let sid = resolve_required_session_id(session_id, sessionId, "export_all_shadow_steps")?;
    let session = get_session_by_sid(&guard, &sid)?;
    let shadow = session.shadow.as_ref().ok_or("Shadow state not available")?;

    let file_path = shadow.export_all_steps_to_file()
        .map_err(|e| format!("Failed to export shadow steps: {}", e))?;

    Ok(file_path)
}

#[tauri::command]
pub async fn validate_shadow_steps(
    max_mismatches: Option<usize>,
    session_id: Option<String>,
    #[allow(non_snake_case)] sessionId: Option<String>,
    state: tauri::State<'_, op_trace::DebugSessionState>,
) -> Result<op_trace::shadow::ShadowValidationReport, String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let sid = resolve_required_session_id(session_id, sessionId, "validate_shadow_steps")?;
    let session = get_session_by_sid(&guard, &sid)?;
    let shadow = session.shadow.as_ref().ok_or("Shadow state not available")?;
    Ok(shadow.validate_step_consistency(max_mismatches.unwrap_or(200)))
}
