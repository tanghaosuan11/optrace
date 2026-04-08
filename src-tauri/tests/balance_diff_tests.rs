use optrace_lib::op_trace::balance_diff::{
    fmt_signed_delta, full_addr, fmt_addr_short, topic_to_addr, TRANSFER_TOPIC,
    token_changes_from_logs, 
};
use revm::primitives::{Address, B256, U256, Log};

// ───── fmt_signed_delta ─────

#[test]
fn fmt_signed_delta_gain() {
    assert_eq!(fmt_signed_delta(U256::from(100u64), U256::from(30u64)), Some("+70".into()));
}

#[test]
fn fmt_signed_delta_loss() {
    assert_eq!(fmt_signed_delta(U256::from(30u64), U256::from(100u64)), Some("-70".into()));
}

#[test]
fn fmt_signed_delta_equal_returns_none() {
    assert_eq!(fmt_signed_delta(U256::from(50u64), U256::from(50u64)), None);
}

#[test]
fn fmt_signed_delta_both_zero_returns_none() {
    assert_eq!(fmt_signed_delta(U256::ZERO, U256::ZERO), None);
}

// ───── topic_to_addr ─────

#[test]
fn topic_to_addr_extracts_last_20_bytes() {
    let mut bytes = [0u8; 32];
    bytes[12..].copy_from_slice(&[0xABu8; 20]);
    let addr = topic_to_addr(&B256::from(bytes));
    assert_eq!(addr, Address::from([0xABu8; 20]));
}

#[test]
fn topic_to_addr_zero_padding() {
    let mut bytes = [0u8; 32];
    bytes[31] = 0x01;
    let addr = topic_to_addr(&B256::from(bytes));
    // last 20 bytes: [0,0,...,0,0x01] at position 12..32
    let expected_last: [u8; 20] = bytes[12..].try_into().unwrap();
    assert_eq!(addr, Address::from(expected_last));
}

// ───── full_addr / fmt_addr_short ─────

#[test]
fn full_addr_starts_with_0x_and_is_42_chars() {
    let s = full_addr(&Address::ZERO);
    assert!(s.starts_with("0x"));
    assert_eq!(s.len(), 42);
}

#[test]
fn fmt_addr_short_is_shorter_than_full() {
    let s = fmt_addr_short(&Address::ZERO);
    assert!(s.contains("..."));
    assert!(s.len() < 42);
}

// ───── TRANSFER_TOPIC ─────

#[test]
fn transfer_topic_starts_with_ddf252() {
    // keccak256("Transfer(address,address,uint256)") = 0xddf252...
    let hex = format!("{:?}", TRANSFER_TOPIC);
    assert!(hex.starts_with("0xddf252"));
}

// ───── token_changes_from_logs ─────

#[test]
fn token_changes_from_logs_empty() {
    let changes = token_changes_from_logs(&[]);
    assert!(changes.is_empty());
}

// 注：Log 构造需要 LogData::new 正确处理，暂时简化为空测试
// 完整的 token transfer 日志测试需要更复杂的 Log 对象构造

// ───── compute_and_print_balance_changes ─────
// 注：该函数需要 EvmState 对象，属于集成测试范围，暂不在此测试

// ───── 额外边界测试 ─────

#[test]
fn fmt_signed_delta_very_large_gain() {
    let gained = U256::from(u128::MAX);
    let lost = U256::ZERO;
    let result = fmt_signed_delta(gained, lost).unwrap();
    assert!(result.starts_with('+'));
}

#[test]
fn fmt_signed_delta_very_large_loss() {
    let gained = U256::ZERO;
    let lost = U256::from(u128::MAX);
    let result = fmt_signed_delta(gained, lost).unwrap();
    assert!(result.starts_with('-'));
}

#[test]
fn topic_to_addr_all_ff() {
    let bytes = [0xFFu8; 32];
    let addr = topic_to_addr(&B256::from(bytes));
    assert_eq!(addr, Address::from([0xFFu8; 20]));
}

#[test]
fn full_addr_non_zero_address() {
    let addr = Address::from([0x11u8; 20]);
    let s = full_addr(&addr);
    assert!(s.contains("1111"));
    assert!(!s.contains("0000000000000000000000000000000000000000"));
}

#[test]
fn fmt_addr_short_long_address() {
    let addr = Address::from([0xDEu8; 20]);
    let short = fmt_addr_short(&addr);
    assert!(short.contains("..."));
    assert!(short.starts_with("0x"));
}

// ───── 增强的分支覆盖测试 ─────

#[test]
fn fmt_signed_delta_zero_diff_with_nonzero() {
    // gained > lost but diff is zero (shouldn't happen in practice)
    assert_eq!(fmt_signed_delta(U256::from(100u64), U256::from(100u64)), None);
}

#[test]
fn fmt_signed_delta_gained_equals_max_u128() {
    let max_u128_val = U256::from(u128::MAX);
    let result = fmt_signed_delta(max_u128_val, U256::ZERO).unwrap();
    assert_eq!(result, format!("+{}", u128::MAX));
}

#[test]
fn fmt_signed_delta_lost_equals_max_u128() {
    let max_u128_val = U256::from(u128::MAX);
    let result = fmt_signed_delta(U256::ZERO, max_u128_val).unwrap();
    assert_eq!(result, format!("-{}", u128::MAX));
}

#[test]
fn fmt_signed_delta_large_gain_with_large_loss() {
    let gained = U256::from(1000u64);
    let lost = U256::from(300u64);
    let result = fmt_signed_delta(gained, lost).unwrap();
    assert_eq!(result, "+700");
}

#[test]
fn fmt_signed_delta_loss_greater_than_gain() {
    let gained = U256::from(200u64);
    let lost = U256::from(500u64);
    let result = fmt_signed_delta(gained, lost).unwrap();
    assert_eq!(result, "-300");
}

#[test]
fn topic_to_addr_leading_bytes_ignored() {
    let mut bytes = [0u8; 32];
    // Set first 12 bytes to something
    bytes[0..12].copy_from_slice(&[0x11u8; 12]);
    // Set last 20 bytes to 0x22
    bytes[12..].copy_from_slice(&[0x22u8; 20]);
    let addr = topic_to_addr(&B256::from(bytes));
    assert_eq!(addr, Address::from([0x22u8; 20]));
}

#[test]
fn topic_to_addr_incremental_values() {
    let mut bytes = [0u8; 32];
    bytes[12..32].copy_from_slice(&[
        0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 
        0x08, 0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x0E, 0x0F,
        0x10, 0x11, 0x12, 0x13,
    ]);
    let addr = topic_to_addr(&B256::from(bytes));
    let expected: [u8; 20] = [
        0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 
        0x08, 0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x0E, 0x0F,
        0x10, 0x11, 0x12, 0x13,
    ];
    assert_eq!(addr, Address::from(expected));
}

#[test]
fn full_addr_returns_checksum_format() {
    let addr = Address::from([0x12u8; 20]);
    let s = full_addr(&addr);
    // Should be 0x + 40 hex chars
    assert!(s.starts_with("0x"));
    assert_eq!(s.len(), 42);
    // Should contain only hex chars
    assert!(s[2..].chars().all(|c| c.is_ascii_hexdigit()));
}

#[test]
fn fmt_addr_short_short_address_not_truncated() {
    // Test with an address string < 10 chars (edge case)
    let addr = Address::ZERO;
    let short = fmt_addr_short(&addr);
    // Zero address is "0x0000000000000000000000000000000000000000" (42 chars)
    // Should still be truncated because it's > 10
    assert!(short.contains("..."));
}

#[test]
fn fmt_addr_short_preserves_0x_prefix() {
    let addr = Address::from([0x99u8; 20]);
    let short = fmt_addr_short(&addr);
    assert!(short.starts_with("0x"));
}

#[test]
fn transfer_topic_constant_is_correct() {
    // Verify TRANSFER_TOPIC is exactly keccak256("Transfer(address,address,uint256)")
    // ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef
    let expected_hex = "ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
    let topic_hex = format!("{:x}", TRANSFER_TOPIC);
    assert_eq!(topic_hex, expected_hex);
}

#[test]
fn token_changes_from_logs_ignores_invalid_topics() {
    // Log with wrong number of topics
    let log = Log {
        address: Address::from([0x11u8; 20]),
        data: revm::primitives::LogData::new(
            vec![B256::ZERO],  // Only 1 topic, need 3+
            vec![0u8; 32].into(),
        ).unwrap(),
    };
    let result = token_changes_from_logs(&[log]);
    assert!(result.is_empty());
}

#[test]
fn token_changes_from_logs_ignores_wrong_transfer_topic() {
    // Log with wrong TRANSFER_TOPIC
    let from_addr = Address::from([0x11u8; 20]);
    let to_addr = Address::from([0x22u8; 20]);
    let token_addr = Address::from([0x33u8; 20]);
    
    // Create topics with wrong first topic (not TRANSFER_TOPIC)
    let wrong_topic = B256::from([0x99u8; 32]);
    
    // Convert Address to B256 topic format (pad to 32 bytes with zeros on left)
    let mut from_topic_bytes = [0u8; 32];
    from_topic_bytes[12..32].copy_from_slice(from_addr.as_slice());
    let from_topic = B256::from(from_topic_bytes);
    
    let mut to_topic_bytes = [0u8; 32];
    to_topic_bytes[12..32].copy_from_slice(to_addr.as_slice());
    let to_topic = B256::from(to_topic_bytes);
    
    let log = Log {
        address: token_addr,
        data: revm::primitives::LogData::new(
            vec![wrong_topic, from_topic, to_topic],
            vec![0u8; 32].into(),
        ).unwrap(),
    };
    let result = token_changes_from_logs(&[log]);
    assert!(result.is_empty());
}

#[test]
fn token_changes_from_logs_ignores_zero_amount() {
    // Log with TRANSFER_TOPIC but zero amount
    let from_addr = Address::from([0x11u8; 20]);
    let to_addr = Address::from([0x22u8; 20]);
    let token_addr = Address::from([0x33u8; 20]);
    
    let mut from_topic_bytes = [0u8; 32];
    from_topic_bytes[12..32].copy_from_slice(from_addr.as_slice());
    let from_topic = B256::from(from_topic_bytes);
    
    let mut to_topic_bytes = [0u8; 32];
    to_topic_bytes[12..32].copy_from_slice(to_addr.as_slice());
    let to_topic = B256::from(to_topic_bytes);
    
    let log = Log {
        address: token_addr,
        data: revm::primitives::LogData::new(
            vec![TRANSFER_TOPIC, from_topic, to_topic],
            vec![0u8; 32].into(),  // All zeros = amount 0
        ).unwrap(),
    };
    let result = token_changes_from_logs(&[log]);
    assert!(result.is_empty());
}

#[test]
fn token_changes_from_logs_records_transfer() {
    // Log with valid TRANSFER_TOPIC and non-zero amount
    let from_addr = Address::from([0x11u8; 20]);
    let to_addr = Address::from([0x22u8; 20]);
    let token_addr = Address::from([0x33u8; 20]);
    let amount = U256::from(1000u64);
    
    let mut from_topic_bytes = [0u8; 32];
    from_topic_bytes[12..32].copy_from_slice(from_addr.as_slice());
    let from_topic = B256::from(from_topic_bytes);
    
    let mut to_topic_bytes = [0u8; 32];
    to_topic_bytes[12..32].copy_from_slice(to_addr.as_slice());
    let to_topic = B256::from(to_topic_bytes);
    
    let amount_bytes = amount.to_be_bytes_vec();
    let mut data_bytes = [0u8; 32];
    if amount_bytes.len() <= 32 {
        data_bytes[32 - amount_bytes.len()..].copy_from_slice(&amount_bytes);
    }
    
    let log = Log {
        address: token_addr,
        data: revm::primitives::LogData::new(
            vec![TRANSFER_TOPIC, from_topic, to_topic],
            data_bytes.to_vec().into(),
        ).unwrap(),
    };
    let result = token_changes_from_logs(&[log]);
    
    // Should have entry for 'from' with loss and 'to' with gain
    assert!(result.contains_key(&from_addr));
    assert!(result.contains_key(&to_addr));
    
    let from_tokens = &result[&from_addr];
    let to_tokens = &result[&to_addr];
    
    assert!(from_tokens.contains_key(&token_addr));
    assert!(to_tokens.contains_key(&token_addr));
    
    // 'from' loses amount, 'to' gains amount
    let (from_gained, from_lost) = from_tokens[&token_addr];
    let (to_gained, to_lost) = to_tokens[&token_addr];
    
    assert_eq!(from_gained, U256::ZERO);
    assert_eq!(from_lost, amount);
    assert_eq!(to_gained, amount);
    assert_eq!(to_lost, U256::ZERO);
}

#[test]
fn token_changes_from_logs_multiple_transfers_same_token() {
    // Multiple transfers of the same token from same address
    let from_addr = Address::from([0x11u8; 20]);
    let to_addr1 = Address::from([0x22u8; 20]);
    let to_addr2 = Address::from([0x33u8; 20]);
    let token_addr = Address::from([0x44u8; 20]);
    
    let amount1 = U256::from(500u64);
    let amount2 = U256::from(300u64);
    
    let mut from_topic_bytes = [0u8; 32];
    from_topic_bytes[12..32].copy_from_slice(from_addr.as_slice());
    let from_topic = B256::from(from_topic_bytes);
    
    let mut to_addr1_topic_bytes = [0u8; 32];
    to_addr1_topic_bytes[12..32].copy_from_slice(to_addr1.as_slice());
    let to_addr1_topic = B256::from(to_addr1_topic_bytes);
    
    let mut to_addr2_topic_bytes = [0u8; 32];
    to_addr2_topic_bytes[12..32].copy_from_slice(to_addr2.as_slice());
    let to_addr2_topic = B256::from(to_addr2_topic_bytes);
    
    let amount1_bytes = amount1.to_be_bytes_vec();
    let mut data1 = [0u8; 32];
    if amount1_bytes.len() <= 32 {
        data1[32 - amount1_bytes.len()..].copy_from_slice(&amount1_bytes);
    }
    
    let amount2_bytes = amount2.to_be_bytes_vec();
    let mut data2 = [0u8; 32];
    if amount2_bytes.len() <= 32 {
        data2[32 - amount2_bytes.len()..].copy_from_slice(&amount2_bytes);
    }
    
    let log1 = Log {
        address: token_addr,
        data: revm::primitives::LogData::new(
            vec![TRANSFER_TOPIC, from_topic, to_addr1_topic],
            data1.to_vec().into(),
        ).unwrap(),
    };
    
    let log2 = Log {
        address: token_addr,
        data: revm::primitives::LogData::new(
            vec![TRANSFER_TOPIC, from_topic, to_addr2_topic],
            data2.to_vec().into(),
        ).unwrap(),
    };
    
    let result = token_changes_from_logs(&[log1, log2]);
    
    // from_addr should show total loss
    let from_entry = &result[&from_addr][&token_addr];
    assert_eq!(from_entry.1, amount1 + amount2);
}

#[test]
fn token_changes_from_logs_short_data_treated_as_zero() {
    // Log with TRANSFER_TOPIC but data.len() < 32
    let from_addr = Address::from([0x11u8; 20]);
    let to_addr = Address::from([0x22u8; 20]);
    let token_addr = Address::from([0x33u8; 20]);
    
    let mut from_topic_bytes = [0u8; 32];
    from_topic_bytes[12..32].copy_from_slice(from_addr.as_slice());
    let from_topic = B256::from(from_topic_bytes);
    
    let mut to_topic_bytes = [0u8; 32];
    to_topic_bytes[12..32].copy_from_slice(to_addr.as_slice());
    let to_topic = B256::from(to_topic_bytes);
    
    let log = Log {
        address: token_addr,
        data: revm::primitives::LogData::new(
            vec![TRANSFER_TOPIC, from_topic, to_topic],
            vec![0xAAu8; 16].into(),  // Only 16 bytes, < 32
        ).unwrap(),
    };
    let result = token_changes_from_logs(&[log]);
    // Should treat amount as zero and skip
    assert!(result.is_empty());
}
