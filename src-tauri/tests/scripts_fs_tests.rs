use optrace_lib::scripts_fs::{
    normalize_rel_path, rel_depth, ensure_max_depth, rel_path_to_slash,
};
use std::path::Path;

// ───── normalize_rel_path ─────

#[test]
fn normalize_simple_file() {
    let p = normalize_rel_path("hello.js").unwrap();
    assert_eq!(p.to_str().unwrap(), "hello.js");
}

#[test]
fn normalize_nested_path() {
    let p = normalize_rel_path("a/b/c.js").unwrap();
    assert_eq!(rel_path_to_slash(&p), "a/b/c.js");
}

#[test]
fn normalize_rejects_absolute() {
    assert!(normalize_rel_path("/etc/passwd").is_err());
}

#[test]
fn normalize_rejects_parent_dir() {
    assert!(normalize_rel_path("../secret").is_err());
}

#[test]
fn normalize_rejects_double_parent() {
    assert!(normalize_rel_path("a/../../etc/passwd").is_err());
}

#[test]
fn normalize_strips_current_dir() {
    let p = normalize_rel_path("./a/./b.js").unwrap();
    assert_eq!(rel_path_to_slash(&p), "a/b.js");
}

#[test]
fn normalize_rejects_hidden_parent() {
    assert!(normalize_rel_path("a/../b").is_err());
}

// ───── rel_depth ─────

#[test]
fn rel_depth_single_component() {
    assert_eq!(rel_depth(Path::new("file.js")), 1);
}

#[test]
fn rel_depth_nested() {
    assert_eq!(rel_depth(Path::new("a/b/c")), 3);
}

#[test]
fn rel_depth_empty_path() {
    assert_eq!(rel_depth(Path::new("")), 0);
}

// ───── ensure_max_depth ─────

#[test]
fn ensure_max_depth_within_limit() {
    ensure_max_depth(Path::new("a/b"), 3).unwrap();
}

#[test]
fn ensure_max_depth_exact_limit() {
    ensure_max_depth(Path::new("a/b/c"), 3).unwrap();
}

#[test]
fn ensure_max_depth_over_limit() {
    assert!(ensure_max_depth(Path::new("a/b/c/d"), 3).is_err());
}

// ───── rel_path_to_slash ─────

#[test]
fn rel_path_to_slash_nested() {
    assert_eq!(rel_path_to_slash(Path::new("a/b/c.js")), "a/b/c.js");
}

#[test]
fn rel_path_to_slash_single() {
    assert_eq!(rel_path_to_slash(Path::new("file.js")), "file.js");
}

// ───── 额外路径测试 ─────

#[test]
fn normalize_mixed_case() {
    let p = normalize_rel_path("Script.JS").unwrap();
    assert_eq!(p.to_str().unwrap(), "Script.JS");
}

#[test]
fn normalize_single_slash() {
    let p = normalize_rel_path("a/b").unwrap();
    assert_eq!(rel_path_to_slash(&p), "a/b");
}

#[test]
fn normalize_deep_path() {
    let p = normalize_rel_path("a/b/c/d.js").unwrap();
    assert_eq!(rel_path_to_slash(&p), "a/b/c/d.js");
}

#[test]
fn normalize_multiple_dots_rejected() {
    assert!(normalize_rel_path("a/b/../../c").is_err());
}

#[test]
fn rel_depth_two_parts() {
    assert_eq!(rel_depth(Path::new("a/b")), 2);
}

#[test]
fn rel_depth_deep_path() {
    assert_eq!(rel_depth(Path::new("a/b/c/d/e")), 5);
}

#[test]
fn ensure_max_depth_zero_allowed() {
    ensure_max_depth(Path::new(""), 0).unwrap();
}

#[test]
fn ensure_max_depth_exactly_one() {
    ensure_max_depth(Path::new("file"), 1).unwrap();
}

#[test]
fn ensure_max_depth_boundary() {
    ensure_max_depth(Path::new("a/b/c"), 3).unwrap();
    assert!(ensure_max_depth(Path::new("a/b/c/d"), 3).is_err());
}

#[test]
fn rel_path_to_slash_empty_path() {
    assert_eq!(rel_path_to_slash(Path::new("")), "");
}

#[test]
fn rel_path_to_slash_complex() {
    assert_eq!(rel_path_to_slash(Path::new("folder/subfolder/file.js")), "folder/subfolder/file.js");
}

// ───── 路径安全性测试 ─────

#[test]
fn normalize_rejects_root() {
    assert!(normalize_rel_path("/").is_err());
}

#[test]
fn normalize_rejects_multiple_parent_traversals() {
    assert!(normalize_rel_path("../../..").is_err());
}

#[test]
fn normalize_rejects_mixed_parent_traversal() {
    assert!(normalize_rel_path("a/b/../../../c").is_err());
}

#[test]
fn normalize_rejects_trailing_parent() {
    assert!(normalize_rel_path("a/b/..").is_err());
}

#[test]
fn normalize_single_parent_rejected() {
    assert!(normalize_rel_path("..").is_err());
}

#[test]
fn normalize_accepts_dot_slash() {
    let p = normalize_rel_path("./file.js").unwrap();
    assert_eq!(p.to_str().unwrap(), "file.js");
}

#[test]
fn normalize_strips_multiple_dots() {
    let p = normalize_rel_path("./././file.js").unwrap();
    assert_eq!(p.to_str().unwrap(), "file.js");
}
