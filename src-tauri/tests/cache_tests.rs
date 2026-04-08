use optrace_lib::op_trace::cache::{
    tx_debug_data_content_hash_hex, resolve_cache_key, dedup_cache_paths,
};
use optrace_lib::op_trace::types::TxDebugData;
use std::path::PathBuf;

fn sample_tx() -> TxDebugData {
    TxDebugData {
        from: "0xaaaa".into(),
        to: "0xbbbb".into(),
        value: "0".into(),
        gas_price: "1000000000".into(),
        gas_limit: "21000".into(),
        data: "0x".into(),
        tx_hash: None,
        cache_block: None,
    }
}

// ───── tx_debug_data_content_hash_hex ─────

#[test]
fn hash_is_deterministic() {
    assert_eq!(
        tx_debug_data_content_hash_hex(&sample_tx()),
        tx_debug_data_content_hash_hex(&sample_tx()),
    );
}

#[test]
fn hash_is_64_lowercase_hex_chars() {
    let h = tx_debug_data_content_hash_hex(&sample_tx());
    assert_eq!(h.len(), 64);
    assert!(h.chars().all(|c| c.is_ascii_hexdigit()));
}

#[test]
fn hash_changes_when_data_differs() {
    let tx1 = sample_tx();
    let mut tx2 = sample_tx();
    tx2.data = "0xdeadbeef".into();
    assert_ne!(tx_debug_data_content_hash_hex(&tx1), tx_debug_data_content_hash_hex(&tx2));
}

#[test]
fn hash_trims_whitespace() {
    let tx1 = sample_tx();
    let mut tx2 = sample_tx();
    tx2.from = format!("  {}  ", tx1.from);
    assert_eq!(tx_debug_data_content_hash_hex(&tx1), tx_debug_data_content_hash_hex(&tx2));
}

// ───── resolve_cache_key ─────

#[test]
fn resolve_uses_fallback_block() {
    let (hash, block) = resolve_cache_key(&sample_tx(), 12345);
    assert_eq!(block, 12345);
    assert_eq!(hash.len(), 64);
}

#[test]
fn resolve_uses_cache_block_when_set() {
    let mut tx = sample_tx();
    tx.cache_block = Some("99999".into());
    let (_, block) = resolve_cache_key(&tx, 12345);
    assert_eq!(block, 99999);
}

#[test]
fn resolve_falls_back_on_invalid_cache_block() {
    let mut tx = sample_tx();
    tx.cache_block = Some("not_a_number".into());
    let (_, block) = resolve_cache_key(&tx, 12345);
    assert_eq!(block, 12345);
}

// ───── dedup_cache_paths ─────

#[test]
fn dedup_removes_duplicates() {
    let paths = vec![
        PathBuf::from("/a/b"),
        PathBuf::from("/c/d"),
        PathBuf::from("/a/b"),
    ];
    assert_eq!(dedup_cache_paths(paths).len(), 2);
}

#[test]
fn dedup_preserves_insertion_order() {
    let paths = vec![PathBuf::from("/z"), PathBuf::from("/a"), PathBuf::from("/z")];
    let result = dedup_cache_paths(paths);
    assert_eq!(result[0], PathBuf::from("/z"));
    assert_eq!(result[1], PathBuf::from("/a"));
}

#[test]
fn dedup_empty_input() {
    assert!(dedup_cache_paths(vec![]).is_empty());
}

// ───── 额外缓存测试 ─────

#[test]
fn hash_with_leading_zeros() {
    let mut tx = sample_tx();
    tx.from = "0x0000000000000000000000000000000000000001".into();
    let h = tx_debug_data_content_hash_hex(&tx);
    assert_eq!(h.len(), 64);
}

#[test]
fn hash_empty_data_handling() {
    let tx = sample_tx();
    let h = tx_debug_data_content_hash_hex(&tx);
    // Empty data field should still produce valid hash
    assert!(!h.is_empty());
}

#[test]
fn hash_different_gas_prices() {
    let mut tx1 = sample_tx();
    let mut tx2 = sample_tx();
    tx2.gas_price = "2000000000".into();
    assert_ne!(
        tx_debug_data_content_hash_hex(&tx1),
        tx_debug_data_content_hash_hex(&tx2)
    );
}

#[test]
fn resolve_cache_key_empty_cache_block_string() {
    let mut tx = sample_tx();
    tx.cache_block = Some("".into());
    let (_, block) = resolve_cache_key(&tx, 12345);
    assert_eq!(block, 12345); // fallback when empty
}

#[test]
fn resolve_cache_key_whitespace_cache_block() {
    let mut tx = sample_tx();
    tx.cache_block = Some("   ".into());
    let (_, block) = resolve_cache_key(&tx, 12345);
    assert_eq!(block, 12345); // fallback when whitespace
}

#[test]
fn resolve_cache_key_zero_block() {
    let mut tx = sample_tx();
    tx.cache_block = Some("0".into());
    let (_, block) = resolve_cache_key(&tx, 12345);
    assert_eq!(block, 0);
}

#[test]
fn dedup_many_duplicates() {
    let paths = vec![
        PathBuf::from("/a"),
        PathBuf::from("/a"),
        PathBuf::from("/a"),
        PathBuf::from("/b"),
    ];
    let result = dedup_cache_paths(paths);
    assert_eq!(result.len(), 2);
}

#[test]
fn dedup_single_element() {
    let paths = vec![PathBuf::from("/a")];
    let result = dedup_cache_paths(paths);
    assert_eq!(result.len(), 1);
}

// ───── 额外的哈希与缓存键测试 ─────

#[test]
fn hash_consistent_across_calls() {
    let tx = sample_tx();
    let h1 = tx_debug_data_content_hash_hex(&tx);
    let h2 = tx_debug_data_content_hash_hex(&tx);
    assert_eq!(h1, h2);
}

#[test]
fn hash_changes_with_different_from() {
    let mut tx1 = sample_tx();
    let mut tx2 = sample_tx();
    tx2.from = "0xcccc".into();
    assert_ne!(
        tx_debug_data_content_hash_hex(&tx1),
        tx_debug_data_content_hash_hex(&tx2)
    );
}

#[test]
fn hash_changes_with_different_to() {
    let mut tx1 = sample_tx();
    let mut tx2 = sample_tx();
    tx2.to = "0xdddd".into();
    assert_ne!(
        tx_debug_data_content_hash_hex(&tx1),
        tx_debug_data_content_hash_hex(&tx2)
    );
}

#[test]
fn hash_changes_with_different_value() {
    let mut tx1 = sample_tx();
    let mut tx2 = sample_tx();
    tx2.value = "100".into();
    assert_ne!(
        tx_debug_data_content_hash_hex(&tx1),
        tx_debug_data_content_hash_hex(&tx2)
    );
}

#[test]
fn hash_changes_with_different_gas_limit() {
    let mut tx1 = sample_tx();
    let mut tx2 = sample_tx();
    tx2.gas_limit = "30000".into();
    assert_ne!(
        tx_debug_data_content_hash_hex(&tx1),
        tx_debug_data_content_hash_hex(&tx2)
    );
}

#[test]
fn hash_with_very_long_data() {
    let mut tx = sample_tx();
    tx.data = format!("0x{}", "ab".repeat(5000)).into();
    let h = tx_debug_data_content_hash_hex(&tx);
    assert_eq!(h.len(), 64);
}

#[test]
fn hash_normalizes_whitespace_from() {
    let mut tx1 = sample_tx();
    let mut tx2 = sample_tx();
    tx2.from = "  0xaaaa  ".into();
    assert_eq!(
        tx_debug_data_content_hash_hex(&tx1),
        tx_debug_data_content_hash_hex(&tx2)
    );
}

#[test]
fn hash_normalizes_whitespace_all_fields() {
    let mut tx1 = sample_tx();
    let mut tx2 = sample_tx();
    tx2.from = "  0xaaaa  ".into();
    tx2.to = "  0xbbbb  ".into();
    tx2.value = "  0  ".into();
    tx2.gas_price = "  1000000000  ".into();
    tx2.gas_limit = "  21000  ".into();
    tx2.data = "  0x  ".into();
    assert_eq!(
        tx_debug_data_content_hash_hex(&tx1),
        tx_debug_data_content_hash_hex(&tx2)
    );
}

#[test]
fn resolve_cache_key_with_valid_block() {
    let mut tx = sample_tx();
    tx.cache_block = Some("99999".into());
    let (hash, block) = resolve_cache_key(&tx, 12345);
    assert_eq!(block, 99999);
    assert_eq!(hash.len(), 64);
}

#[test]
fn resolve_cache_key_with_whitespace_around_block() {
    let mut tx = sample_tx();
    tx.cache_block = Some("  88888  ".into());
    let (_, block) = resolve_cache_key(&tx, 12345);
    assert_eq!(block, 88888);
}

#[test]
fn resolve_cache_key_with_max_block() {
    let mut tx = sample_tx();
    tx.cache_block = Some("18446744073709551615".into());  // u64::MAX
    let (_, block) = resolve_cache_key(&tx, 12345);
    assert_eq!(block, u64::MAX);
}

#[test]
fn resolve_cache_key_fallback_on_parse_error() {
    let mut tx = sample_tx();
    tx.cache_block = Some("not_a_number_at_all".into());
    let (_, block) = resolve_cache_key(&tx, 12345);
    assert_eq!(block, 12345);
}

#[test]
fn resolve_cache_key_fallback_on_negative_string() {
    let mut tx = sample_tx();
    tx.cache_block = Some("-100".into());
    let (_, block) = resolve_cache_key(&tx, 12345);
    assert_eq!(block, 12345);
}

#[test]
fn resolve_cache_key_with_hex_block_fails() {
    let mut tx = sample_tx();
    tx.cache_block = Some("0xABCD".into());
    let (_, block) = resolve_cache_key(&tx, 12345);
    // from_str_radix with base 10 should fail on hex
    assert_eq!(block, 12345);
}

#[test]
fn dedup_with_many_unique_paths() {
    let paths = vec![
        PathBuf::from("/a"),
        PathBuf::from("/b"),
        PathBuf::from("/c"),
        PathBuf::from("/d"),
    ];
    let result = dedup_cache_paths(paths);
    assert_eq!(result.len(), 4);
}

#[test]
fn dedup_maintains_insertion_order_with_duplicates() {
    let paths = vec![
        PathBuf::from("/z"),
        PathBuf::from("/a"),
        PathBuf::from("/z"),
        PathBuf::from("/b"),
        PathBuf::from("/a"),
    ];
    let result = dedup_cache_paths(paths);
    assert_eq!(result.len(), 3);
    assert_eq!(result[0], PathBuf::from("/z"));
    assert_eq!(result[1], PathBuf::from("/a"));
    assert_eq!(result[2], PathBuf::from("/b"));
}
