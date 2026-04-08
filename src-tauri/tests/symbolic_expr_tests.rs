use optrace_lib::op_trace::symbolic::expr::{Expr, bytes32_to_hex64};

// ───── bytes32_to_hex64 ─────

#[test]
fn bytes32_to_hex64_zeros() {
    assert_eq!(bytes32_to_hex64(&[0u8; 32]), "0".repeat(64));
}

#[test]
fn bytes32_to_hex64_all_ff() {
    assert_eq!(bytes32_to_hex64(&[0xffu8; 32]), "f".repeat(64));
}

#[test]
fn bytes32_to_hex64_length() {
    let s = bytes32_to_hex64(&[0u8; 32]);
    assert_eq!(s.len(), 64);
}

#[test]
fn bytes32_to_hex64_last_byte() {
    let mut b = [0u8; 32];
    b[31] = 0x01;
    assert!(bytes32_to_hex64(&b).ends_with("01"));
}

// ───── Expr::konst ─────

#[test]
fn expr_konst_zero_is_const() {
    match Expr::konst([0u8; 32]) {
        Expr::Const(s) => assert_eq!(s, "0".repeat(64)),
        _ => panic!("expected Const"),
    }
}

// ───── is_concrete ─────

#[test]
fn is_concrete_const_true() {
    assert!(Expr::Const("0".repeat(64)).is_concrete());
}

#[test]
fn is_concrete_sym_false() {
    assert!(!Expr::Sym("x".into()).is_concrete());
}

#[test]
fn is_concrete_nested_with_sym_false() {
    let e = Expr::Add(
        Box::new(Expr::Const("0".repeat(64))),
        Box::new(Expr::Sym("x".into())),
    );
    assert!(!e.is_concrete());
}

#[test]
fn is_concrete_nested_all_const_true() {
    let e = Expr::Add(
        Box::new(Expr::Const("0".repeat(64))),
        Box::new(Expr::Const("1".repeat(64))),
    );
    assert!(e.is_concrete());
}

// ───── symbols ─────

#[test]
fn symbols_deduplicates() {
    let e = Expr::Add(
        Box::new(Expr::Sym("a".into())),
        Box::new(Expr::Mul(
            Box::new(Expr::Sym("b".into())),
            Box::new(Expr::Sym("a".into())),
        )),
    );
    let syms = e.symbols();
    assert_eq!(syms.len(), 2);
    assert!(syms.contains("a"));
    assert!(syms.contains("b"));
}

#[test]
fn symbols_empty_for_const() {
    assert!(Expr::Const("0".repeat(64)).symbols().is_empty());
}

// ───── keccak_uids ─────

#[test]
fn keccak_uids_nested() {
    let e = Expr::Add(
        Box::new(Expr::Keccak(1, vec![Expr::Sym("x".into())])),
        Box::new(Expr::Keccak(2, vec![Expr::Keccak(3, vec![])])),
    );
    let uids = e.keccak_uids();
    assert_eq!(uids.len(), 3);
    assert!(uids.contains(&1) && uids.contains(&2) && uids.contains(&3));
}

// ───── to_smt2 ─────

#[test]
fn to_smt2_const() {
    let h = "0".repeat(64);
    assert_eq!(Expr::Const(h.clone()).to_smt2(), format!("#x{}", h));
}

#[test]
fn to_smt2_sym() {
    assert_eq!(Expr::Sym("cd_4".into()).to_smt2(), "cd_4");
}

#[test]
fn to_smt2_add() {
    let e = Expr::Add(Box::new(Expr::Sym("a".into())), Box::new(Expr::Sym("b".into())));
    assert_eq!(e.to_smt2(), "(bvadd a b)");
}

#[test]
fn to_smt2_not() {
    let e = Expr::Not(Box::new(Expr::Sym("x".into())));
    assert_eq!(e.to_smt2(), "(bvnot x)");
}

#[test]
fn to_smt2_iszero_uses_ite() {
    let e = Expr::Iszero(Box::new(Expr::Sym("x".into())));
    let s = e.to_smt2();
    assert!(s.contains("ite") && s.contains("bv1 256") && s.contains("bv0 256"));
}

#[test]
fn to_smt2_lt_is_ite_bvult() {
    let e = Expr::Lt(Box::new(Expr::Sym("a".into())), Box::new(Expr::Sym("b".into())));
    let s = e.to_smt2();
    assert!(s.contains("bvult") && s.contains("ite"));
}

#[test]
fn to_smt2_shl_swaps_args() {
    // EVM: SHL(shift, val) → SMT: (bvshl val shift)
    let e = Expr::Shl(Box::new(Expr::Sym("shift".into())), Box::new(Expr::Sym("val".into())));
    assert_eq!(e.to_smt2(), "(bvshl val shift)");
}

#[test]
fn to_smt2_eq_uses_ite_eq() {
    let e = Expr::Eq(Box::new(Expr::Sym("a".into())), Box::new(Expr::Sym("b".into())));
    let s = e.to_smt2();
    assert!(s.contains("ite") && s.contains("= a b"));
}

#[test]
fn to_smt2_keccak_by_uid() {
    assert_eq!(Expr::Keccak(42, vec![]).to_smt2(), "keccak_42");
}

#[test]
fn to_smt2_nested() {
    // (a + b) * c
    let e = Expr::Mul(
        Box::new(Expr::Add(Box::new(Expr::Sym("a".into())), Box::new(Expr::Sym("b".into())))),
        Box::new(Expr::Sym("c".into())),
    );
    assert_eq!(e.to_smt2(), "(bvmul (bvadd a b) c)");
}

#[test]
fn to_smt2_addmod() {
    let e = Expr::Addmod(
        Box::new(Expr::Sym("a".into())),
        Box::new(Expr::Sym("b".into())),
        Box::new(Expr::Sym("m".into())),
    );
    assert_eq!(e.to_smt2(), "(bvurem (bvadd a b) m)");
}
