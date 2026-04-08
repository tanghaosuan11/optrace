//! CFG build command.

use crate::op_trace;
use super::session::*;

// 构建 CFG（后端静态分块 + trace 映射）
#[tauri::command]
pub async fn build_cfg(
    transaction_id: u32,
    context_id: u16,
    only_executed: Option<bool>,
    session_id: Option<String>,
    #[allow(non_snake_case)] sessionId: Option<String>,
    state: tauri::State<'_, op_trace::DebugSessionState>,
) -> Result<serde_json::Value, String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    let sid = resolve_required_session_id(session_id, sessionId, "build_cfg")?;
    let session = get_session_mut_by_sid(&mut guard, &sid)?;
    let result = op_trace::cfg_builder::build_cfg_for_frame_cached(
        session,
        transaction_id,
        context_id,
        only_executed.unwrap_or(true),
    )?;
    serde_json::to_value(&result).map_err(|e| e.to_string())
}
