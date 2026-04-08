//! Fork patch validation command.

use crate::op_trace;
use super::session::*;

/// 根据后端 DebugSession 完整 trace 校验 Fork 补丁（step 为 0-based 全局下标，与 patch.step_index 一致）
#[tauri::command]
pub fn validate_fork_patch(
    step_index: usize,
    kind: String,
    stack_pos: Option<usize>,
    mem_offset: Option<usize>,
    mem_hex: Option<String>,
    pc_hex: Option<String>,
    value_hex: Option<String>,
    storage_address_hex: Option<String>,
    storage_slot_hex: Option<String>,
    storage_value_hex: Option<String>,
    balance_address_hex: Option<String>,
    session_id: Option<String>,
    #[allow(non_snake_case)]
    sessionId: Option<String>,
    state: tauri::State<'_, op_trace::DebugSessionState>,
) -> Result<(), String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let sid = resolve_required_session_id(session_id, sessionId, "validate_fork_patch")?;
    let session = get_session_by_sid(&guard, &sid)?;
    op_trace::fork::validate_fork_patch_impl(
        session,
        step_index,
        &kind,
        stack_pos,
        mem_offset,
        mem_hex.as_deref(),
        pc_hex.as_deref(),
        value_hex.as_deref(),
        storage_address_hex.as_deref(),
        storage_slot_hex.as_deref(),
        storage_value_hex.as_deref(),
        balance_address_hex.as_deref(),
    )
}
