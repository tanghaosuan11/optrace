//! SMT-LIB2 构建 + Z3 子进程求解

use serde::{Deserialize, Serialize};
use std::collections::HashSet;

use super::expr::Expr;

/// JUMPI 处收集的路径约束
#[derive(Clone, Debug, Serialize)]
pub struct PathConstraint {
    /// 全局步骤索引
    pub step: u32,
    /// 该约束所属交易（0-based）
    pub transaction_id: u32,
    /// 程序计数器
    pub pc: u32,
    /// JUMPI 条件的符号表达式
    pub condition: Expr,
    /// 真实执行时有没有跳转（condition != 0 即 taken）
    pub taken: bool,
}

/// 对目标 JUMPI 的期望
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "type", content = "value")]
pub enum SymGoal {
    /// 让这个 JUMPI 发生跳转（condition != 0）
    TakeJump,
    /// 让这个 JUMPI 不跳转（condition == 0）
    SkipJump,
    /// 让某个值等于指定的十六进制（64 字符无前缀）
    EqualValue(String),
}

/// SMT-LIB2 查询构建器
pub struct SmtQuery {
    pub smt2: String,
    /// 所有参与的符号变量名（供前端展示用）
    pub sym_vars: Vec<String>,
}

const ZERO256: &str = "#x0000000000000000000000000000000000000000000000000000000000000000";

pub fn build_smt2_query(
    path_constraints: &[PathConstraint],
    target_step: u32,
    target_transaction_id: u32,
    target_condition: &Expr,
    goal: &SymGoal,
) -> SmtQuery {
    // 收集所有符号变量（仅目标交易相关）
    let mut sym_vars: HashSet<String> = HashSet::new();
    for c in path_constraints {
        if c.transaction_id != target_transaction_id {
            continue;
        }
        sym_vars.extend(c.condition.symbols());
    }
    sym_vars.extend(target_condition.symbols());

    // 收集所有 keccak UID
    let mut keccak_uids: HashSet<u32> = HashSet::new();
    for c in path_constraints {
        keccak_uids.extend(c.condition.keccak_uids());
    }
    keccak_uids.extend(target_condition.keccak_uids());

    // 检测是否存在 EXP/SIGNEXTEND/BYTE 等无法用 Z3 内建 BV 求解的操作
    let needs_uf = has_uninterpreted_ops(target_condition)
        || path_constraints.iter().any(|c| has_uninterpreted_ops(&c.condition));

    let mut out = String::with_capacity(4096);

    out.push_str("; OpTrace symbolic query\n");
    // QF_UFBV 支持无解释函数（UF）+ 位向量；纯 QF_BV 不允许有参数的 declare-fun
    if needs_uf {
        out.push_str("(set-logic QF_UFBV)\n\n");
    } else {
        out.push_str("(set-logic QF_BV)\n\n");
    }

    // SMT-LIB2 declare-fun: (name (param-sort ...) return-sort)
    if needs_uf {
        out.push_str("; Uninterpreted functions for EVM operations Z3 can't model exactly\n");
        out.push_str("(declare-fun evm_exp ((_ BitVec 256) (_ BitVec 256)) (_ BitVec 256))\n");
        out.push_str("(declare-fun evm_signext ((_ BitVec 256) (_ BitVec 256)) (_ BitVec 256))\n");
        out.push_str("(declare-fun evm_byte ((_ BitVec 256) (_ BitVec 256)) (_ BitVec 256))\n\n");
    }

    if !keccak_uids.is_empty() {
        out.push_str("; Keccak256 calls modeled as opaque constants\n");
        for uid in &keccak_uids {
            out.push_str(&format!("(declare-const keccak_{} (_ BitVec 256))\n", uid));
        }
        out.push('\n');
    }

    out.push_str("; Symbolic input variables\n");
    let mut sym_vars_sorted: Vec<String> = sym_vars.iter().cloned().collect();
    sym_vars_sorted.sort();
    for var in &sym_vars_sorted {
        out.push_str(&format!("(declare-const {} (_ BitVec 256))\n", var));
    }
    out.push('\n');

    out.push_str("; Path constraints (target tx only, steps strictly before target)\n");
    let mut relevant = 0usize;
    for c in path_constraints {
        if c.transaction_id != target_transaction_id {
            continue; // 仅约束目标交易，避免跨 tx 污染
        }
        if c.step >= target_step {
            continue; // 只保留 target 之前的约束，避免锁死后续可能改变的路径
        }
        // 只添加含符号变量的约束（纯具体值的 JUMPI 已被路径执行决定）
        if c.condition.symbols().is_empty() {
            continue;
        }
        let cond_smt = c.condition.to_smt2();
        let assertion = if c.taken {
            format!("(assert (not (= {} {})))  ; step {} pc 0x{:04x} taken",
                    cond_smt, ZERO256, c.step, c.pc)
        } else {
            format!("(assert (= {} {}))  ; step {} pc 0x{:04x} not-taken",
                    cond_smt, ZERO256, c.step, c.pc)
        };
        out.push_str(&assertion);
        out.push('\n');
        relevant += 1;
    }
    if relevant == 0 {
        out.push_str("; (no symbolic path constraints)\n");
    }
    out.push('\n');

    out.push_str("; Goal\n");
    let target_smt = target_condition.to_smt2();
    let goal_assert = match goal {
        SymGoal::TakeJump =>
            format!("(assert (not (= {} {})))  ; want JUMPI to be taken", target_smt, ZERO256),
        SymGoal::SkipJump =>
            format!("(assert (= {} {}))  ; want JUMPI NOT to be taken", target_smt, ZERO256),
        SymGoal::EqualValue(hex64) =>
            format!("(assert (= {} #x{}))  ; want value = 0x{}", target_smt, hex64, hex64),
    };
    out.push_str(&goal_assert);
    out.push('\n');

    out.push_str("\n(check-sat)\n(get-model)\n");

    SmtQuery {
        smt2: out,
        sym_vars: sym_vars_sorted,
    }
}

fn has_uninterpreted_ops(e: &Expr) -> bool {
    match e {
        Expr::Exp(..) | Expr::Signext(..) | Expr::Byteop(..) => true,
        Expr::Const(_) | Expr::Sym(_) | Expr::Keccak(..) => false,
        Expr::Not(a) | Expr::Iszero(a) => has_uninterpreted_ops(a),
        Expr::Add(a,b)  | Expr::Sub(a,b)  | Expr::Mul(a,b)  | Expr::Div(a,b)
        | Expr::Sdiv(a,b) | Expr::Urem(a,b) | Expr::Srem(a,b)
        | Expr::And(a,b) | Expr::Or(a,b) | Expr::Xor(a,b)
        | Expr::Shl(a,b) | Expr::Shr(a,b) | Expr::Sar(a,b)
        | Expr::Lt(a,b) | Expr::Gt(a,b) | Expr::Slt(a,b) | Expr::Sgt(a,b)
        | Expr::Eq(a,b) => has_uninterpreted_ops(a) || has_uninterpreted_ops(b),
        Expr::Addmod(a,b,c) | Expr::Mulmod(a,b,c) => {
            has_uninterpreted_ops(a) || has_uninterpreted_ops(b) || has_uninterpreted_ops(c)
        }
    }
}

/// 求解结果
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "status")]
pub enum SolverResult {
    /// SAT：找到满足所有约束的解
    Sat {
        inputs: Vec<SymInput>,
        /// 实际求解所对应的目标交易（0-based）
        target_transaction_id: u32,
    },
    /// UNSAT：约束矛盾，不存在解
    Unsat {
        target_transaction_id: u32,
    },
    /// Z3 返回 unknown（超时或无法解决）
    Unknown {
        reason: String,
        target_transaction_id: u32,
    },
    /// 系统错误（找不到 Z3，写文件失败等）
    Error {
        message: String,
        target_transaction_id: Option<u32>,
    },
}

/// 一个符号变量的解
#[derive(Debug, Clone, Serialize)]
pub struct SymInput {
    /// 变量名，如 `"cd_4"`
    pub name: String,
    /// 十六进制值（带 0x 前缀，如 `"0x0000...0001"`）
    pub value_hex: String,
    /// 如果是 calldata 变量（名称以 cd_ 开头），这是字节偏移
    pub calldata_offset: Option<usize>,
}

/// 调用 Z3 二进制求解 SMT-LIB2 查询
///
/// `z3_path`：Z3 可执行文件路径（默认 "z3"，走 PATH 查找）
pub fn run_z3(smt2: &str, z3_path: Option<&str>, target_transaction_id: u32) -> SolverResult {
    let z3 = z3_path.unwrap_or("z3");

    // 每次使用唯一临时文件名，避免并发求解互相覆盖
    let uid = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .subsec_nanos();
    let pid = std::process::id();
    let tmp = std::env::temp_dir().join(format!("optrace_sym_{}_{}.smt2", pid, uid));
    if let Err(e) = std::fs::write(&tmp, smt2) {
        return SolverResult::Error {
            message: format!("写临时文件失败: {}", e),
            target_transaction_id: Some(target_transaction_id),
        };
    }

    let output = std::process::Command::new(z3)
        .arg("-smt2")
        .arg(&tmp)
        .output();
    let _ = std::fs::remove_file(&tmp); // 求解完毕后清理临时文件

    match output {
        Err(e) => SolverResult::Error {
            message: format!("启动 Z3 失败（路径: {}）: {}", z3, e),
            target_transaction_id: Some(target_transaction_id),
        },
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout).into_owned();
            let stderr = String::from_utf8_lossy(&out.stderr).into_owned();
            parse_z3_output(&stdout, &stderr, target_transaction_id)
        }
    }
}

fn parse_z3_output(stdout: &str, stderr: &str, target_transaction_id: u32) -> SolverResult {
    let first_line = stdout.lines().next().unwrap_or("").trim();
    match first_line {
        "sat" => {
            let inputs = parse_z3_model(stdout);
            SolverResult::Sat { inputs, target_transaction_id }
        }
        "unsat" => SolverResult::Unsat { target_transaction_id },
        "unknown" => SolverResult::Unknown {
            reason: stderr.lines().next().unwrap_or("unknown").to_string(),
            target_transaction_id,
        },
        other => SolverResult::Error {
            message: format!("Z3 输出未识别: '{}'  stderr: {}", other, stderr),
            target_transaction_id: Some(target_transaction_id),
        },
    }
}

/// 解析 Z3 `(get-model)` 输出，提取变量赋值
///
/// 支持两种格式：
/// - `#x<hex64>` — Z3 常用的十六进制字面量（64 字符 = 256 bit）
/// - `(_ bv<decimal> 256)` — Z3 有时用十进制输出的格式
fn parse_z3_model(stdout: &str) -> Vec<SymInput> {
    let mut inputs = Vec::new();
    let mut lines = stdout.lines().peekable();

    // 跳过 "sat" 行
    if lines.peek().map(|l| l.trim()) == Some("sat") {
        lines.next();
    }

    // 拼接剩余为一个字符串，然后按 define-fun 分块
    let model_text: String = lines.collect::<Vec<_>>().join(" ");

    let mut rest = model_text.as_str();
    while let Some(pos) = rest.find("define-fun") {
        rest = &rest[pos + "define-fun".len()..];
        // 读变量名
        let rest_trimmed = rest.trim_start();
        let name_end = rest_trimmed.find(|c: char| c.is_whitespace() || c == '(').unwrap_or(0);
        let name = rest_trimmed[..name_end].trim().to_string();
        if name.is_empty() || name.starts_with("keccak_") || name.starts_with("evm_") {
            continue;
        }

        // 当前块范围：到下一个 define-fun 之前
        let block_end = rest[1..].find("define-fun").map(|p| p + 1).unwrap_or(rest.len());
        let block = &rest[..block_end];

        // 优先 #x 格式（Z3 对 bv256 通常输出 64 字符）
        let value_hex = if let Some(hp) = block.find("#x") {
            let hex_rest = &block[hp + 2..];
            let hex_end = hex_rest.find(|c: char| !c.is_ascii_hexdigit()).unwrap_or(hex_rest.len());
            let hex = &hex_rest[..hex_end];
            if !hex.is_empty() && hex.len() <= 64 {
                Some(format!("0x{:0>64}", hex))
            } else { None }
        }
        // 回退到 (_ bvN 256) 十进制格式
        else if let Some(bp) = block.find("(_ bv") {
            let bv_rest = &block[bp + 5..];
            let num_end = bv_rest.find(|c: char| !c.is_ascii_digit()).unwrap_or(bv_rest.len());
            decimal_str_to_hex256(&bv_rest[..num_end])
        } else { None };

        if let Some(hex) = value_hex {
            let calldata_offset = parse_cd_offset(&name);
            inputs.push(SymInput { name: name.clone(), value_hex: hex, calldata_offset });
        }

        rest = &rest[block_end..];
    }

    inputs.sort_by(|a, b| a.name.cmp(&b.name));
    inputs
}

/// 将十进制字符串转换为 64 字符十六进制（256-bit）
/// 用于解析 Z3 的 `(_ bvN 256)` 格式，不依赖外部 bignum crate
fn decimal_str_to_hex256(s: &str) -> Option<String> {
    if s.is_empty() { return None; }
    // 小端序 u64 words，手动大数乘加
    let mut words = [0u64; 4];
    for b in s.bytes() {
        if b < b'0' || b > b'9' { return None; }
        let digit = (b - b'0') as u64;
        // words *= 10
        let mut carry = 0u128;
        for w in words.iter_mut() {
            let prod = (*w as u128) * 10 + carry;
            *w = prod as u64;
            carry = prod >> 64;
        }
        if carry != 0 { return None; } // 超过 256-bit
        // words += digit
        let mut c2 = digit as u128;
        for w in words.iter_mut() {
            let sum = (*w as u128) + c2;
            *w = sum as u64;
            c2 = sum >> 64;
        }
    }
    Some(format!("0x{:016x}{:016x}{:016x}{:016x}",
        words[3], words[2], words[1], words[0]))
}

/// 从变量名解析 calldata 偏移，如 "cd_4" → Some(4)
fn parse_cd_offset(name: &str) -> Option<usize> {
    let stripped = name.strip_prefix("cd_")?;
    stripped.parse::<usize>().ok()
}
