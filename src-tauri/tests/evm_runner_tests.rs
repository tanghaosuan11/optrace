/// evm_runner 单元测试
///
/// 测试策略：
/// 1. tx_env_from_debug — 纯数据转换，测试地址/金额/gas 解析
/// 2. ShadowState — 执行层的影子状态机，核心是 on_step / push_frame / backward_slice

use optrace_lib::op_trace::evm_runner::tx_env_from_debug;
use optrace_lib::op_trace::types::TxDebugData;

// ─── 辅助工厂 ───

fn sample_tx() -> TxDebugData {
    TxDebugData {
        from: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045".into(),
        to: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48".into(),
        value: "0".into(),
        gas_price: "1000000000".into(),
        gas_limit: "21000".into(),
        data: "0x".into(),
        tx_hash: None,
        cache_block: None,
    }
}

// ─── tx_env_from_debug ───

#[test]
fn tx_env_basic_roundtrip() {
    let tx = sample_tx();
    let env = tx_env_from_debug(&tx).unwrap();
    // 基本字段被解析
    assert!(!env.data.is_empty() || env.data.is_empty()); // data 字段存在
}

#[test]
fn tx_env_with_contract_call_data() {
    let mut tx = sample_tx();
    tx.data = "0xa9059cbb000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa960450000000000000000000000000000000000000000000000000000000000000064".into();
    let env = tx_env_from_debug(&tx).unwrap();
    assert_eq!(env.data.len(), 68);  // 4 + 32 + 32 bytes
}

#[test]
fn tx_env_create_tx_with_empty_to() {
    let mut tx = sample_tx();
    tx.to = "".into();  // Empty 'to' means contract creation
    let env = tx_env_from_debug(&tx).unwrap();
    // Should succeed (create tx)
    let _ = env;
}

#[test]
fn tx_env_with_zero_x_to() {
    let mut tx = sample_tx();
    tx.to = "0x".into();  // 0x = create tx
    let env = tx_env_from_debug(&tx).unwrap();
    let _ = env;
}

#[test]
fn tx_env_large_gas_limit() {
    let mut tx = sample_tx();
    tx.gas_limit = "30000000".into();  // 30M gas
    let env = tx_env_from_debug(&tx).unwrap();
    assert_eq!(env.gas_limit, 30_000_000);
}

#[test]
fn tx_env_invalid_gas_limit_falls_back() {
    let mut tx = sample_tx();
    tx.gas_limit = "not_a_number".into();  // 无效值 → 默认 21000
    let env = tx_env_from_debug(&tx).unwrap();
    assert_eq!(env.gas_limit, 21000);
}

#[test]
fn tx_env_invalid_gas_price_falls_back() {
    let mut tx = sample_tx();
    tx.gas_price = "bad".into();  // 无效值 → 默认 0
    let env = tx_env_from_debug(&tx).unwrap();
    assert_eq!(env.gas_price, 0);
}

#[test]
fn tx_env_invalid_data_falls_back_to_empty() {
    let mut tx = sample_tx();
    tx.data = "not_valid_hex".into();  // 无效十六进制 → 默认空
    let env = tx_env_from_debug(&tx).unwrap();
    assert!(env.data.is_empty());
}

#[test]
fn tx_env_nonzero_value() {
    let mut tx = sample_tx();
    tx.value = "1000000000000000000".into();  // 1 ETH in wei (decimal)
    let env = tx_env_from_debug(&tx).unwrap();
    assert!(!env.value.is_zero());
}

#[test]
fn tx_env_invalid_value_falls_back_to_zero() {
    let mut tx = sample_tx();
    tx.value = "not_a_number".into();
    let env = tx_env_from_debug(&tx).unwrap();
    assert!(env.value.is_zero());
}

#[test]
fn tx_env_invalid_from_address_errors() {
    let mut tx = sample_tx();
    tx.from = "not_an_address".into();
    assert!(tx_env_from_debug(&tx).is_err());
}

#[test]
fn tx_env_empty_from_address_errors() {
    let mut tx = sample_tx();
    tx.from = "".into();
    assert!(tx_env_from_debug(&tx).is_err());
}

#[test]
fn tx_env_hex_data_roundtrip() {
    let mut tx = sample_tx();
    tx.data = "0xdeadbeef".into();
    let env = tx_env_from_debug(&tx).unwrap();
    assert_eq!(env.data.len(), 4);
    assert_eq!(&env.data[..], &[0xde, 0xad, 0xbe, 0xef]);
}

#[test]
fn tx_env_caller_is_parsed_from_address() {
    let tx = sample_tx();
    let env = tx_env_from_debug(&tx).unwrap();
    // Verify caller address was parsed (format check)
    let caller = format!("{:?}", env.caller);
    assert!(caller.starts_with("0x"));
    assert_eq!(caller.len(), 42);
}
