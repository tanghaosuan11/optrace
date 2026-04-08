//! Analysis & scan tauri commands.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use crate::op_trace;
use crate::analysis;
use super::session::*;
use super::AnalysisCancelFlags;

#[tauri::command]
pub async fn scan_conditions(
    conditions: Vec<op_trace::ConditionGroup>,
    session_id: Option<String>,
    #[allow(non_snake_case)] sessionId: Option<String>,
    #[allow(non_snake_case)]
    transaction_id: Option<u32>,
    #[allow(non_snake_case)]
    transactionId: Option<u32>,
    state: tauri::State<'_, op_trace::DebugSessionState>,
) -> Result<serde_json::Value, String> {
    let sid = resolve_required_session_id(session_id, sessionId, "scan_conditions")?;
    // 提前校验 session 存在
    {
        let guard = state.0.lock().map_err(|e| e.to_string())?;
        let _ = get_session_by_sid(&guard, &sid)?;
    }

    // CPU 密集型扫描放到独立线程
    let session_arc = Arc::clone(&state.0);
    let (tx, rx) = std::sync::mpsc::channel::<Result<serde_json::Value, String>>();
    std::thread::spawn(move || {
        let result = (|| -> Result<serde_json::Value, String> {
            let guard = session_arc.lock().map_err(|e| e.to_string())?;
            let session = get_session_by_sid(&guard, &sid)?;
            let step_count = session.trace.len();
            let t0 = std::time::Instant::now();
            let tid = transaction_id.or(transactionId);
            let hits = op_trace::scan_conditions_impl(session, &conditions, tid);
            let scan_ms = t0.elapsed().as_secs_f64() * 1000.0;
            println!(
                "[scan_conditions] {} steps × {} groups → {} hits | scan {:.1}ms",
                step_count, conditions.len(), hits.len(), scan_ms,
            );
            serde_json::to_value(&hits).map_err(|e| e.to_string())
        })();
        let _ = tx.send(result);
    });

    rx.recv().map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn run_analysis(
    app: tauri::AppHandle,
    script: String,
    filters: Option<analysis::RawFilters>,
    chain_id: Option<String>,
    session_id: Option<String>,
    #[allow(non_snake_case)] sessionId: Option<String>,
    #[allow(non_snake_case)]
    transaction_id: Option<u32>,
    #[allow(non_snake_case)]
    transactionId: Option<u32>,
    state: tauri::State<'_, op_trace::DebugSessionState>,
    cancel_flags: tauri::State<'_, AnalysisCancelFlags>,
) -> Result<serde_json::Value, String> {
    use tauri::Manager;
    let sid = resolve_required_session_id(session_id, sessionId, "run_analysis")?;
    {
        let guard = state.0.lock().map_err(|e| e.to_string())?;
        let _ = get_session_by_sid(&guard, &sid)?;
    }

    let cancelled = {
        let mut guard = cancel_flags.0.lock().map_err(|e| e.to_string())?;
        let flag = guard
            .entry(sid.clone())
            .or_insert_with(|| Arc::new(AtomicBool::new(false)))
            .clone();
        flag.store(false, Ordering::Relaxed);
        flag
    };

    let app_data_dir = app
        .path()
        .app_data_dir()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default();
    let cid = chain_id.unwrap_or_default();

    // CPU 密集型分析放到独立线程
    let session_arc = Arc::clone(&state.0);
    let mut raw_filters = filters.unwrap_or_default();
    let tid = transaction_id.or(transactionId);
    if let Some(t) = tid {
        raw_filters.transaction_id = Some(t);
    }
    let (tx, rx) = std::sync::mpsc::channel::<Result<serde_json::Value, String>>();
    std::thread::spawn(move || {
        let result = (|| -> Result<serde_json::Value, String> {
            let guard = session_arc.lock().map_err(|e| e.to_string())?;
            let session = get_session_by_sid(&guard, &sid)?;
            let t0 = std::time::Instant::now();
            let res = analysis::run_analysis(session, &script, raw_filters, Arc::clone(&cancelled), app_data_dir, cid)?;
            println!(
                "[run_analysis] {} steps | {:.1}ms",
                session.trace.len(),
                t0.elapsed().as_secs_f64() * 1000.0,
            );
            Ok(res)
        })();
        let _ = tx.send(result);
    });
    rx.recv().map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn cancel_analysis(
    session_id: Option<String>,
    #[allow(non_snake_case)] sessionId: Option<String>,
    cancel_flags: tauri::State<'_, AnalysisCancelFlags>,
) -> Result<(), String> {
    let sid = resolve_required_session_id(session_id, sessionId, "cancel_analysis")?;
    let mut guard = cancel_flags.0.lock().map_err(|e| e.to_string())?;
    let flag = guard
        .entry(sid)
        .or_insert_with(|| Arc::new(AtomicBool::new(false)))
        .clone();
    flag.store(true, Ordering::Relaxed);
    Ok(())
}
