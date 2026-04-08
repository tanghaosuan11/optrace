use optrace_lib::op_trace::debug_session::{DebugSession, TraceStep, normalize_session_id};
use revm::primitives::{Address, U256};

fn make_step(transaction_id: u32, context_id: u16, frame_step: u32, stack: Vec<U256>) -> TraceStep {
    TraceStep {
        transaction_id,
        context_id,
        frame_step,
        pc: 0,
        opcode: 0,
        gas_cost: 0,
        gas_remaining: 0,
        stack,
        contract_address: Address::ZERO,
        call_target: Address::ZERO,
    }
}

// ───── compute_memory_at_step ─────

#[test]
fn compute_memory_empty_session() {
    let s = DebugSession::new();
    assert!(s.compute_memory_at_step(0, 1, 0).is_empty());
}

#[test]
fn compute_memory_single_snapshot() {
    let mut s = DebugSession::new();
    s.push_snapshot(0, 1, 0, vec![0xAA; 32]);
    let mem = s.compute_memory_at_step(0, 1, 0);
    assert_eq!(mem.len(), 32);
    assert_eq!(mem[0], 0xAA);
}

#[test]
fn compute_memory_snapshot_plus_patch() {
    let mut s = DebugSession::new();
    s.push_snapshot(0, 1, 0, vec![0x00; 64]);
    s.push_patch(0, 1, 5, 10, vec![0xFF, 0xFE]);
    let mem = s.compute_memory_at_step(0, 1, 10);
    assert_eq!(mem.len(), 64);
    assert_eq!(mem[10], 0xFF);
    assert_eq!(mem[11], 0xFE);
    assert_eq!(mem[12], 0x00);
}

#[test]
fn compute_memory_patch_past_target_excluded() {
    let mut s = DebugSession::new();
    s.push_snapshot(0, 1, 0, vec![0x00; 32]);
    s.push_patch(0, 1, 5, 0, vec![0xAA]);
    s.push_patch(0, 1, 20, 1, vec![0xBB]); // step 20 > target 10
    let mem = s.compute_memory_at_step(0, 1, 10);
    assert_eq!(mem[0], 0xAA); // step 5 applied
    assert_eq!(mem[1], 0x00); // step 20 NOT applied
}

#[test]
fn compute_memory_picks_latest_snapshot() {
    let mut s = DebugSession::new();
    s.push_snapshot(0, 1, 0, vec![0x11; 32]);
    s.push_snapshot(0, 1, 50, vec![0x22; 64]);
    let mem = s.compute_memory_at_step(0, 1, 60);
    assert_eq!(mem[0], 0x22);
}

#[test]
fn compute_memory_before_first_snapshot_is_empty() {
    let mut s = DebugSession::new();
    s.push_snapshot(0, 1, 10, vec![0xFF; 32]);
    assert!(s.compute_memory_at_step(0, 1, 5).is_empty());
}

#[test]
fn compute_memory_patch_extends_memory_32byte_aligned() {
    let mut s = DebugSession::new();
    s.push_snapshot(0, 1, 0, vec![0x00; 32]);
    s.push_patch(0, 1, 1, 40, vec![0xCC; 10]);
    let mem = s.compute_memory_at_step(0, 1, 5);
    // 40 + 10 = 50, aligned up to 64
    assert_eq!(mem.len(), 64);
    assert_eq!(mem[40], 0xCC);
    assert_eq!(mem[49], 0xCC);
}

// ───── find_value_origin ─────

#[test]
fn find_value_origin_found() {
    let mut s = DebugSession::new();
    let val = U256::from(42u64);
    s.push_step(make_step(0, 1, 0, vec![val]));              // global 0, TOS = 42
    s.push_step(make_step(0, 1, 1, vec![U256::from(7u64)])); // global 1
    s.push_step(make_step(0, 1, 2, vec![U256::from(99u64)]));// global 2 — query here
    assert_eq!(s.find_value_origin(2, val), Some(0));
}

#[test]
fn find_value_origin_not_found() {
    let mut s = DebugSession::new();
    s.push_step(make_step(0, 1, 0, vec![U256::from(1u64)]));
    s.push_step(make_step(0, 1, 1, vec![U256::from(2u64)]));
    assert_eq!(s.find_value_origin(1, U256::from(99u64)), None);
}

#[test]
fn find_value_origin_same_context_only() {
    let mut s = DebugSession::new();
    let val = U256::from(42u64);
    s.push_step(make_step(0, 1, 0, vec![val]));               // ctx 1, global 0
    s.push_step(make_step(0, 2, 0, vec![U256::ZERO]));        // ctx 2, global 1
    s.push_step(make_step(0, 2, 1, vec![U256::from(7u64)]));  // ctx 2, global 2
    // query from ctx 2 — must NOT find val from ctx 1
    assert_eq!(s.find_value_origin(2, val), None);
}

#[test]
fn find_value_origin_at_first_step_is_none() {
    let mut s = DebugSession::new();
    s.push_step(make_step(0, 1, 0, vec![U256::from(1u64)]));
    assert_eq!(s.find_value_origin(0, U256::from(1u64)), None);
}

// ───── normalize_session_id ─────

#[test]
fn normalize_session_id_with_value() {
    assert_eq!(normalize_session_id(Some("abc")), "abc");
}

#[test]
fn normalize_session_id_empty_string() {
    assert_eq!(normalize_session_id(Some("")), "__default__");
}

#[test]
fn normalize_session_id_whitespace() {
    assert_eq!(normalize_session_id(Some("  ")), "__default__");
}

#[test]
fn normalize_session_id_none() {
    assert_eq!(normalize_session_id(None), "__default__");
}
