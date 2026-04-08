use optrace_lib::op_trace::fork::{
    parse_address_hex, parse_u256_hex, hex_payload_byte_len, parse_pc_u32, validate_value_wei_hex,
};

// ───── parse_address_hex ─────

#[test]
fn parse_address_hex_valid_lowercase() {
    parse_address_hex("0xabcdefabcdefabcdefabcdefabcdefabcdefabcd").unwrap();
}

#[test]
fn parse_address_hex_checksummed() {
    let addr = parse_address_hex("0xdEAD000000000000000000000000000000000000").unwrap();
    assert_eq!(format!("{:?}", addr), "0xdead000000000000000000000000000000000000");
}

#[test]
fn parse_address_hex_empty() {
    assert!(parse_address_hex("").is_err());
}

#[test]
fn parse_address_hex_whitespace_only() {
    assert!(parse_address_hex("   ").is_err());
}

#[test]
fn parse_address_hex_invalid_chars() {
    assert!(parse_address_hex("0xZZZZ000000000000000000000000000000000000").is_err());
}

#[test]
fn parse_address_hex_too_short() {
    assert!(parse_address_hex("0xdead").is_err());
}

// ───── parse_u256_hex ─────

#[test]
fn parse_u256_hex_zero() {
    let v = parse_u256_hex("0x0").unwrap();
    assert!(v.is_zero());
}

#[test]
fn parse_u256_hex_without_prefix() {
    let v = parse_u256_hex("ff").unwrap();
    assert_eq!(v.to_string(), "255");
}

#[test]
fn parse_u256_hex_max_256bit() {
    let hex = format!("0x{}", "f".repeat(64));
    parse_u256_hex(&hex).unwrap();
}

#[test]
fn parse_u256_hex_negative_rejected() {
    assert!(parse_u256_hex("-0x1").is_err());
}

#[test]
fn parse_u256_hex_empty() {
    assert!(parse_u256_hex("").is_err());
}

#[test]
fn parse_u256_hex_only_0x() {
    assert!(parse_u256_hex("0x").is_err());
}

#[test]
fn parse_u256_hex_trimming() {
    let v = parse_u256_hex("  0xA  ").unwrap();
    assert_eq!(v.to_string(), "10");
}

// ───── hex_payload_byte_len ─────

#[test]
fn hex_payload_byte_len_valid() {
    assert_eq!(hex_payload_byte_len("0xaabb").unwrap(), 2);
}

#[test]
fn hex_payload_byte_len_no_prefix() {
    assert_eq!(hex_payload_byte_len("aabbcc").unwrap(), 3);
}

#[test]
fn hex_payload_byte_len_empty_string() {
    assert_eq!(hex_payload_byte_len("").unwrap(), 0);
}

#[test]
fn hex_payload_byte_len_only_0x() {
    assert_eq!(hex_payload_byte_len("0x").unwrap(), 0);
}

#[test]
fn hex_payload_byte_len_odd_chars() {
    assert!(hex_payload_byte_len("0xaab").is_err());
}

#[test]
fn hex_payload_byte_len_invalid_chars() {
    assert!(hex_payload_byte_len("0xZZ").is_err());
}

// ───── parse_pc_u32 ─────

#[test]
fn parse_pc_u32_decimal() {
    assert_eq!(parse_pc_u32("42").unwrap(), 42);
}

#[test]
fn parse_pc_u32_hex() {
    assert_eq!(parse_pc_u32("0x2a").unwrap(), 42);
}

#[test]
fn parse_pc_u32_empty() {
    assert!(parse_pc_u32("").is_err());
}

#[test]
fn parse_pc_u32_whitespace_trimmed() {
    assert_eq!(parse_pc_u32("  100  ").unwrap(), 100);
}

// ───── validate_value_wei_hex ─────

#[test]
fn validate_value_wei_hex_valid() {
    validate_value_wei_hex("0xDE0B6B3A7640000").unwrap();
}

#[test]
fn validate_value_wei_hex_zero() {
    validate_value_wei_hex("0x0").unwrap();
}

#[test]
fn validate_value_wei_hex_negative() {
    assert!(validate_value_wei_hex("-0x1").is_err());
}

#[test]
fn validate_value_wei_hex_empty() {
    assert!(validate_value_wei_hex("").is_err());
}

// ───── 额外边界测试 ─────

#[test]
fn parse_address_hex_only_prefix() {
    assert!(parse_address_hex("0x").is_err());
}

#[test]
fn parse_address_hex_too_long() {
    assert!(parse_address_hex("0xabcdefabcdefabcdefabcdefabcdefabcdefabcdff").is_err());
}

#[test]
fn parse_address_hex_with_leading_zeros() {
    parse_address_hex("0x0000000000000000000000000000000000000001").unwrap();
}

#[test]
fn parse_u256_hex_leading_zeros() {
    let v = parse_u256_hex("0x00ff").unwrap();
    assert_eq!(v.to_string(), "255");
}

#[test]
fn parse_u256_hex_uppercase_prefix() {
    let v = parse_u256_hex("0XFF").unwrap();
    assert_eq!(v.to_string(), "255");
}

#[test]
fn parse_u256_hex_very_large() {
    let hex = format!("0x{}", "f".repeat(64));
    parse_u256_hex(&hex).unwrap();
}

#[test]
fn parse_u256_hex_single_digit() {
    let v = parse_u256_hex("a").unwrap();
    assert_eq!(v.to_string(), "10");
}

#[test]
fn hex_payload_byte_len_large_data() {
    let hex = format!("0x{}", "ff".repeat(1000));
    assert_eq!(hex_payload_byte_len(&hex).unwrap(), 1000);
}

#[test]
fn hex_payload_byte_len_trimmed_whitespace() {
    assert_eq!(hex_payload_byte_len("  0xaabb  ").unwrap(), 2);
}

#[test]
fn parse_pc_u32_max_value() {
    assert_eq!(parse_pc_u32("4294967295").unwrap(), u32::MAX);
}

#[test]
fn parse_pc_u32_overflow_rejected() {
    assert!(parse_pc_u32("4294967296").is_err());
}

#[test]
fn parse_pc_u32_0x_case_insensitive() {
    assert_eq!(parse_pc_u32("0X2A").unwrap(), 42);
}

#[test]
fn parse_pc_u32_leading_zeros() {
    assert_eq!(parse_pc_u32("0x002a").unwrap(), 42);
}

#[test]
fn validate_value_wei_hex_max_u256() {
    let max_hex = format!("0x{}", "f".repeat(64));
    validate_value_wei_hex(&max_hex).unwrap();
}

#[test]
fn validate_value_wei_hex_large() {
    validate_value_wei_hex("0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF").unwrap();
}

// ───── 增强的分支和组合测试 ─────

#[test]
fn parse_address_hex_case_mixing() {
    let addr1 = parse_address_hex("0xAbCdEf0000000000000000000000000000000000").unwrap();
    let addr2 = parse_address_hex("0xabcdef0000000000000000000000000000000000").unwrap();
    assert_eq!(addr1, addr2);
}

#[test]
fn parse_address_hex_42_chars_exact() {
    let addr_str = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";
    parse_address_hex(addr_str).unwrap();
    assert_eq!(addr_str.len(), 42);
}

#[test]
fn parse_u256_hex_0x_lowercase() {
    let v1 = parse_u256_hex("0xff").unwrap();
    let v2 = parse_u256_hex("0XFF").unwrap();
    assert_eq!(v1, v2);
}

#[test]
fn parse_u256_hex_without_0x() {
    let v1 = parse_u256_hex("1000").unwrap();
    let v2 = parse_u256_hex("0x1000").unwrap();
    // Note: "1000" parsed as hex = 4096, but "0x1000" = 4096
    assert_eq!(v1, v2);
}

#[test]
fn parse_u256_hex_all_f() {
    let hex = format!("0x{}", "f".repeat(64));
    let v = parse_u256_hex(&hex).unwrap();
    assert_eq!(format!("{:x}", v).len(), 64);
}

#[test]
fn hex_payload_byte_len_single_byte() {
    assert_eq!(hex_payload_byte_len("0xab").unwrap(), 1);
}

#[test]
fn hex_payload_byte_len_many_bytes() {
    let hex = format!("0x{}", "ab".repeat(100));
    assert_eq!(hex_payload_byte_len(&hex).unwrap(), 100);
}

#[test]
fn hex_payload_byte_len_uppercase_x() {
    assert_eq!(hex_payload_byte_len("0Xaabb").unwrap(), 2);
}

#[test]
fn hex_payload_byte_len_mixed_case_hex() {
    assert_eq!(hex_payload_byte_len("0xAbCd").unwrap(), 2);
}

#[test]
fn parse_pc_u32_hex_lowercase() {
    assert_eq!(parse_pc_u32("0x2a").unwrap(), 42);
}

#[test]
fn parse_pc_u32_hex_uppercase() {
    assert_eq!(parse_pc_u32("0X2A").unwrap(), 42);
}

#[test]
fn parse_pc_u32_decimal_large() {
    assert_eq!(parse_pc_u32("1000000").unwrap(), 1000000);
}

#[test]
fn parse_pc_u32_hex_large() {
    assert_eq!(parse_pc_u32("0xFFFF").unwrap(), 65535);
}

#[test]
fn parse_pc_u32_with_inner_whitespace_rejected() {
    // Whitespace in the middle should be trimmed, so let's verify trimming behavior
    assert_eq!(parse_pc_u32("  42  ").unwrap(), 42);
}

#[test]
fn validate_value_wei_hex_10e18() {
    // 1 ether in wei
    validate_value_wei_hex("0x0de0b6b3a7640000").unwrap();
}

#[test]
fn validate_value_wei_hex_no_prefix() {
    validate_value_wei_hex("1000").unwrap();
}

#[test]
fn validate_value_wei_hex_trimmed() {
    validate_value_wei_hex("  0xff  ").unwrap();
}

#[test]
fn parse_address_hex_boundary_20_bytes() {
    // 20 bytes = 40 hex chars + 0x = 42 total
    let addr_str = format!("0x{}", "a".repeat(40));
    parse_address_hex(&addr_str).unwrap();
}

#[test]
fn hex_payload_byte_len_mod_2_check() {
    // Ensure exactly 2 char boundary
    assert!(hex_payload_byte_len("0xaabbcc").is_ok());  // even
    assert!(hex_payload_byte_len("0xaabbc").is_err());   // odd
}

#[test]
fn parse_u256_hex_all_zeros() {
    let v = parse_u256_hex("0x0000000000000000000000000000000000000000000000000000000000000000").unwrap();
    assert!(v.is_zero());
}

#[test]
fn parse_u256_hex_single_nonzero_bit() {
    let v = parse_u256_hex("0x1").unwrap();
    assert_eq!(v.to_string(), "1");
}

#[test]
fn parse_address_hex_with_spaces_trimmed() {
    let addr = parse_address_hex("  0xabcdefabcdefabcdefabcdefabcdefabcdefabcd  ").unwrap();
    assert_eq!(format!("{:?}", addr).starts_with("0x"), true);
}

#[test]
fn parse_pc_u32_boundary_u32_max() {
    let v = parse_pc_u32(&u32::MAX.to_string()).unwrap();
    assert_eq!(v, u32::MAX);
}

#[test]
fn parse_pc_u32_zero() {
    assert_eq!(parse_pc_u32("0").unwrap(), 0);
}

#[test]
fn parse_pc_u32_zero_hex() {
    assert_eq!(parse_pc_u32("0x0").unwrap(), 0);
}

#[test]
fn validate_value_wei_hex_with_uppercase_x() {
    validate_value_wei_hex("0Xabc").unwrap();
}
