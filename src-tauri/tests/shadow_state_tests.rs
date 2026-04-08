/// ShadowState 单元测试
///
/// 测试策略：
/// ShadowState 的内部状态机（节点分配、帧管理、内存影子、backward_slice 回溯）
/// 完全不需要连接 EVM —— 测试时手动调用 push_frame / on_step / pop_frame，
/// 模拟 inspector 回调序列，再验证结果。

use optrace_lib::op_trace::shadow::{ShadowState, NO_NODE};
use revm::primitives::{Address, U256};
use std::path::PathBuf;

// ─── 辅助函数 ───

fn empty_stack() -> Vec<U256> {
    vec![]
}

fn stack_with(vals: &[u64]) -> Vec<U256> {
    vals.iter().map(|&v| U256::from(v)).collect()
}

fn zero_addr() -> Address {
    Address::ZERO
}

fn tmp_dir() -> PathBuf {
    std::env::temp_dir().join(format!("optrace_test_{}", std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()))
}

// ─── 基础构造测试 ───

#[test]
fn shadow_state_new_has_no_nodes() {
    let s = ShadowState::new();
    assert_eq!(s.node_count(), 0);
}

#[test]
fn shadow_state_with_temp_dir_constructs() {
    let dir = tmp_dir();
    let s = ShadowState::with_temp_dir(dir);
    assert_eq!(s.node_count(), 0);
}

#[test]
fn shadow_state_snapshot_count_initially_zero() {
    let s = ShadowState::new();
    assert_eq!(s.snapshot_count(), 0);
}

// ─── 帧管理测试 ───

#[test]
fn push_frame_creates_frame() {
    let mut s = ShadowState::new();
    s.push_frame(0);  // 顶层帧，无 calldata
    // 初始化成功，可以继续后续操作
}

#[test]
fn push_frame_with_calldata_creates_leaf_nodes() {
    let mut s = ShadowState::new();
    s.push_frame(64);  // 64 bytes calldata → 2 个 32-byte TXINPUT 节点
    assert_eq!(s.node_count(), 2);  // 2 个 TXINPUT 叶子节点
}

#[test]
fn push_frame_with_32_byte_calldata_creates_one_node() {
    let mut s = ShadowState::new();
    s.push_frame(32);  // 32 bytes → 1 个节点
    assert_eq!(s.node_count(), 1);
}

#[test]
fn push_frame_with_1_byte_calldata_creates_one_node() {
    let mut s = ShadowState::new();
    s.push_frame(1);  // 1 byte → still 1 TXINPUT node for the partial 32-byte chunk
    assert_eq!(s.node_count(), 1);
}

#[test]
fn pop_frame_after_push_succeeds() {
    let mut s = ShadowState::new();
    s.push_frame(0);
    s.pop_frame(0, 0, 0);  // No return data
}

#[test]
fn pop_frame_on_empty_returns_safely() {
    let mut s = ShadowState::new();
    // Should not panic even with no frames
    s.pop_frame(0, 0, 0);
}

#[test]
fn multiple_push_pop_frames() {
    let mut s = ShadowState::new();
    s.push_frame(0);  // outer frame
    s.push_frame(0);  // inner frame (sub-call)
    s.pop_frame(0, 0, 0);  // Return from inner
    s.pop_frame(0, 0, 0);  // Return from outer
}

// ─── on_step 测试（模拟 EVM opcode 序列）───

/// PUSH1 (0x60): pop 0, push 1 → 生成一个新节点
#[test]
fn on_step_push1_creates_node() {
    let mut s = ShadowState::new();
    s.push_frame(0);

    // PUSH1 0x01 — stack after: [1]
    let stack_after = stack_with(&[1]);
    s.on_step(0x60, 0, 0, &stack_after, zero_addr(), 0, 0);

    assert_eq!(s.node_count(), 1);
}

/// ADD (0x01): pop 2, push 1 → 生成一个依赖两个父节点的节点
#[test]
fn on_step_add_creates_node_with_two_parents() {
    let mut s = ShadowState::new();
    s.push_frame(0);

    // 先 push 两个常量
    let stk1 = stack_with(&[5]);
    s.on_step(0x60, 0, 0, &stk1, zero_addr(), 0, 0);  // PUSH1 5

    let stk2 = stack_with(&[5, 10]);
    s.on_step(0x60, 2, 1, &stk2, zero_addr(), 0, 0);  // PUSH1 10

    // ADD: consumes 2, produces 1
    let stk3 = stack_with(&[15]);
    s.on_step(0x01, 4, 2, &stk3, zero_addr(), 0, 0);  // ADD

    // Total: 2 PUSH nodes + 1 ADD node
    assert_eq!(s.node_count(), 3);
}

/// POP (0x50): pop 1, push 0 → NO_NODE (no new node allocated)
#[test]
fn on_step_pop_does_not_create_node() {
    let mut s = ShadowState::new();
    s.push_frame(0);

    let stk1 = stack_with(&[42]);
    s.on_step(0x60, 0, 0, &stk1, zero_addr(), 0, 0);  // PUSH1 42
    let count_after_push = s.node_count();

    let stk2 = empty_stack();
    s.on_step(0x50, 2, 1, &stk2, zero_addr(), 0, 0);  // POP

    // POP doesn't allocate a new node
    assert_eq!(s.node_count(), count_after_push);
}

/// DUP1 (0x80): 直接复用已有节点的引用，不分配新节点
#[test]
fn on_step_dup1_does_not_create_new_node() {
    let mut s = ShadowState::new();
    s.push_frame(0);

    let stk1 = stack_with(&[99]);
    s.on_step(0x60, 0, 0, &stk1, zero_addr(), 0, 0);  // PUSH1 99

    let stk2 = stack_with(&[99, 99]);
    s.on_step(0x80, 2, 1, &stk2, zero_addr(), 0, 0);  // DUP1

    // DUP 不创建新节点，仍然只有 PUSH1 产生的 1 个节点
    assert_eq!(s.node_count(), 1);
}

/// SWAP1 (0x90): swap top 2 → 不分配新节点
#[test]
fn on_step_swap1_does_not_create_node() {
    let mut s = ShadowState::new();
    s.push_frame(0);

    let stk1 = stack_with(&[1]);
    s.on_step(0x60, 0, 0, &stk1, zero_addr(), 0, 0);  // PUSH1 1

    let stk2 = stack_with(&[1, 2]);
    s.on_step(0x60, 2, 1, &stk2, zero_addr(), 0, 0);  // PUSH1 2
    let count_before = s.node_count();

    let stk3 = stack_with(&[2, 1]);
    s.on_step(0x90, 4, 2, &stk3, zero_addr(), 0, 0);  // SWAP1

    // SWAP doesn't allocate new node
    assert_eq!(s.node_count(), count_before);
}

/// 叶子节点 ADDRESS(0x30): pop 0, push 1 → 新节点无父
#[test]
fn on_step_address_creates_leaf_node() {
    let mut s = ShadowState::new();
    s.push_frame(0);

    let stk1 = stack_with(&[0x12345678u64]);
    s.on_step(0x30, 0, 0, &stk1, zero_addr(), 0, 0);  // ADDRESS

    assert_eq!(s.node_count(), 1);
}

/// ISZERO (0x15): pop 1, push 1 → unary 节点
#[test]
fn on_step_iszero_creates_unary_node() {
    let mut s = ShadowState::new();
    s.push_frame(0);

    let stk1 = stack_with(&[0]);
    s.on_step(0x60, 0, 0, &stk1, zero_addr(), 0, 0);  // PUSH1 0

    let stk2 = stack_with(&[1]);
    s.on_step(0x15, 2, 1, &stk2, zero_addr(), 0, 0);  // ISZERO

    assert_eq!(s.node_count(), 2);  // PUSH1 + ISZERO
}

// ─── backward_slice 测试 ───

/// 空状态时 backward_slice 返回空
#[test]
fn backward_slice_empty_state_returns_empty() {
    let s = ShadowState::new();
    let result = s.backward_slice(0);
    assert!(result.is_empty());
}

/// 越界的 step 返回空
#[test]
fn backward_slice_out_of_range_returns_empty() {
    let s = ShadowState::new();
    let result = s.backward_slice(9999);
    assert!(result.is_empty());
}

/// PUSH 后的节点可以被 backward_slice 找到（只有 step 0 自己）
#[test]
fn backward_slice_push_has_single_step() {
    let mut s = ShadowState::new();
    s.push_frame(0);

    let stk = stack_with(&[42]);
    s.on_step(0x60, 0, 0, &stk, zero_addr(), 0, 0);  // PUSH1 42

    // step 0 = PUSH1 → backward_slice from step 0 should contain step 0
    let result = s.backward_slice(0);
    assert!(result.contains(&0), "Expected step 0 in backward slice");
}

/// ADD 的 backward_slice 应包含两个 PUSH 的 step 和自身
#[test]
fn backward_slice_add_includes_push_parents() {
    let mut s = ShadowState::new();
    s.push_frame(0);

    // step 0: PUSH1 5
    let stk0 = stack_with(&[5]);
    s.on_step(0x60, 0, 0, &stk0, zero_addr(), 0, 0);

    // step 1: PUSH1 10
    let stk1 = stack_with(&[5, 10]);
    s.on_step(0x60, 2, 1, &stk1, zero_addr(), 0, 0);

    // step 2: ADD
    let stk2 = stack_with(&[15]);
    s.on_step(0x01, 4, 2, &stk2, zero_addr(), 0, 0);

    // Backward slice from ADD (step 2) should include both PUSHes (step 0, 1) and ADD itself (step 2)
    let result = s.backward_slice(2);
    assert!(result.contains(&2), "Should include ADD step");
    assert!(result.contains(&0), "Should include PUSH1 5 step");
    assert!(result.contains(&1), "Should include PUSH1 10 step");
}

// ─── node_count / snapshot_count 测试 ───

#[test]
fn node_count_increases_with_each_push() {
    let mut s = ShadowState::new();
    s.push_frame(0);

    for i in 0..5u64 {
        let stk = stack_with(&[i]);
        s.on_step(0x60, (i * 2) as usize, i as usize, &stk, zero_addr(), 0, 0);
    }

    // 5 PUSH opcodes → 5 nodes
    assert_eq!(s.node_count(), 5);
}

#[test]
fn snapshot_count_increases_with_each_step() {
    let mut s = ShadowState::new();
    s.push_frame(0);

    for i in 0..3u64 {
        let stk = stack_with(&[i]);
        s.on_step(0x60, (i * 2) as usize, i as usize, &stk, zero_addr(), 0, 0);
    }

    // at least 3 snapshots (one per step)
    assert!(s.snapshot_count() >= 3);
}

// ─── debug log toggle 测试 ───

#[test]
fn debug_log_disabled_by_default() {
    let s = ShadowState::new();
    assert!(!s.is_debug_log_enabled());
}

#[test]
fn debug_log_can_be_enabled() {
    let mut s = ShadowState::new();
    s.set_debug_log_enabled(true);
    assert!(s.is_debug_log_enabled());
}

#[test]
fn debug_log_can_be_toggled() {
    let mut s = ShadowState::new();
    s.set_debug_log_enabled(true);
    s.set_debug_log_enabled(false);
    assert!(!s.is_debug_log_enabled());
}

// ─── 边界情况测试 ───

/// 初始帧有 calldata，创建的节点数 = ceil(calldata_size / 32)
#[test]
fn push_frame_96_byte_calldata_creates_3_nodes() {
    let mut s = ShadowState::new();
    s.push_frame(96);  // 3 × 32-byte chunks
    assert_eq!(s.node_count(), 3);
}

#[test]
fn push_frame_33_byte_calldata_creates_2_nodes() {
    let mut s = ShadowState::new();
    s.push_frame(33);  // 32 + 1 → 2 chunks
    assert_eq!(s.node_count(), 2);
}

/// 多步 sequence 验证节点总数
#[test]
fn sequence_push_dup_pop_gives_expected_count() {
    let mut s = ShadowState::new();
    s.push_frame(0);

    // step 0: PUSH1 → 1 node
    let stk0 = stack_with(&[1]);
    s.on_step(0x60, 0, 0, &stk0, zero_addr(), 0, 0);

    // step 1: DUP1 → 1 node
    let stk1 = stack_with(&[1, 1]);
    s.on_step(0x80, 2, 1, &stk1, zero_addr(), 0, 0);

    // step 2: POP → no new node
    let stk2 = stack_with(&[1]);
    s.on_step(0x50, 3, 2, &stk2, zero_addr(), 0, 0);

    // DUP 不创建新节点：PUSH1 = 1 node, DUP1 = 0 new, POP = 0 new → 共 1 节点
    assert_eq!(s.node_count(), 1);
}

/// NO_NODE 常量正确 (u32::MAX)
#[test]
fn no_node_is_u32_max() {
    assert_eq!(NO_NODE, u32::MAX);
}
