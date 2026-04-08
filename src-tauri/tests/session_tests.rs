use optrace_lib::commands::session::{now_ms, resolve_required_session_id, cleanup_stale_sessions};
use optrace_lib::op_trace::debug_session::SessionEntry;
use std::collections::HashMap;

// ───── now_ms ─────

#[test]
fn now_ms_is_after_2020() {
    // 2020-01-01 in ms
    assert!(now_ms() > 1_577_836_800_000);
}

#[test]
fn now_ms_increases_over_time() {
    let a = now_ms();
    let b = now_ms();
    assert!(b >= a);
}

// ───── resolve_required_session_id ─────

#[test]
fn resolve_with_session_id() {
    assert_eq!(resolve_required_session_id(Some("abc".into()), None, "test").unwrap(), "abc");
}

#[test]
fn resolve_falls_back_to_camel() {
    assert_eq!(resolve_required_session_id(None, Some("def".into()), "test").unwrap(), "def");
}

#[test]
fn resolve_prefers_session_id_over_camel() {
    assert_eq!(
        resolve_required_session_id(Some("primary".into()), Some("fallback".into()), "test").unwrap(),
        "primary"
    );
}

#[test]
fn resolve_both_none_is_err_with_command_name() {
    let e = resolve_required_session_id(None, None, "seek_to").unwrap_err();
    assert!(e.contains("seek_to"));
}

#[test]
fn resolve_empty_string_is_err() {
    assert!(resolve_required_session_id(Some("".into()), None, "cmd").is_err());
}

#[test]
fn resolve_whitespace_only_is_err() {
    assert!(resolve_required_session_id(Some("   ".into()), None, "cmd").is_err());
}

// ───── cleanup_stale_sessions ─────

fn entry_with_session(is_running: bool, updated_at_ms: u64) -> SessionEntry {
    SessionEntry {
        session: None,
        is_running,
        updated_at_ms,
    }
}

#[test]
fn cleanup_removes_session_none_not_running() {
    let mut map = HashMap::new();
    map.insert("a".into(), entry_with_session(false, 0));
    assert_eq!(cleanup_stale_sessions(&mut map), 1);
    assert!(map.is_empty());
}

#[test]
fn cleanup_keeps_running_sessions() {
    let mut map = HashMap::new();
    map.insert("a".into(), entry_with_session(true, 0));
    assert_eq!(cleanup_stale_sessions(&mut map), 0);
    assert_eq!(map.len(), 1);
}

#[test]
fn cleanup_returns_count_of_removed() {
    let mut map = HashMap::new();
    map.insert("a".into(), entry_with_session(false, 0));
    map.insert("b".into(), entry_with_session(false, 0));
    map.insert("c".into(), entry_with_session(true, 0));
    let removed = cleanup_stale_sessions(&mut map);
    assert_eq!(removed, 2);
    assert_eq!(map.len(), 1);
}
