use optrace_lib::op_trace::types::parse_tx_kind_from_to_field;
use revm::primitives::TxKind;

#[test]
fn parse_empty_string_is_create() {
    assert!(matches!(parse_tx_kind_from_to_field("").unwrap(), TxKind::Create));
}

#[test]
fn parse_0x_is_create() {
    assert!(matches!(parse_tx_kind_from_to_field("0x").unwrap(), TxKind::Create));
}

#[test]
fn parse_zero_address_is_create() {
    let zero = format!("0x{}", "0".repeat(40));
    assert!(matches!(parse_tx_kind_from_to_field(&zero).unwrap(), TxKind::Create));
}

#[test]
fn parse_real_address_is_call() {
    let addr = "0xdEAD000000000000000000000000000000000001";
    match parse_tx_kind_from_to_field(addr).unwrap() {
        TxKind::Call(a) => assert!(!a.is_zero()),
        _ => panic!("expected Call"),
    }
}

#[test]
fn parse_whitespace_only_0x_is_create() {
    assert!(matches!(parse_tx_kind_from_to_field("  0x  ").unwrap(), TxKind::Create));
}

#[test]
fn parse_invalid_hex_is_err() {
    assert!(parse_tx_kind_from_to_field("0xZZZZ").is_err());
}
