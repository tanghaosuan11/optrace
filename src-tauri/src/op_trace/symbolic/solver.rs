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
        Expr::Exp(base, exp) => {
            // 小常量指数展开为乘法链，不需要 UF — 但仍需检查 base
            if let Expr::Const(h) = exp.as_ref() {
                let exp_val = u64::from_str_radix(
                    &h[h.len().saturating_sub(16)..], 16
                ).unwrap_or(u64::MAX);
                if exp_val > 8 {
                    true
                } else {
                    has_uninterpreted_ops(base)
                }
            } else {
                true
            }
        }
        Expr::Byteop(i, x) => {
            // i 为常量时用精确 BV extract，不需要 UF — 但仍需检查 x
            if matches!(i.as_ref(), Expr::Const(_)) {
                has_uninterpreted_ops(x)
            } else {
                true
            }
        }
        Expr::Signext(b, x) => {
            // b 为常量时用精确 BV sign_extend，不需要 UF
            if matches!(b.as_ref(), Expr::Const(_)) {
                has_uninterpreted_ops(x)
            } else {
                true
            }
        }
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

/// 求解失败原因分类
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "code")]
pub enum UnsatReason {
    /// 路径约束自相矛盾（快速判断：前缀已锁死该条件）
    PathContradiction { conflict_step: Option<u32> },
    /// 目标条件本身已是具体常量，无符号依赖
    ConcreteCondition,
    /// 减少的符号源
    NoUsefulSources,
}

/// Unknown 原因分类
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "code")]
pub enum UnknownReason {
    /// 包含无解释函数（UF）导致无法精确求解
    UninterpretedFunctions { uf_count: usize },
    /// Z3 超时（约束太多）
    Timeout,
    /// 其他原因
    Other { detail: String },
}

/// 对 SolverResult 的说明层——诊断失败原因并给出建议
#[derive(Debug, Clone, Serialize)]
pub struct SolveExplain {
    /// Unsat/Unknown 的具体原因分类
    pub category: ExplainCategory,
    /// 人读说明
    pub message: String,
    /// 具体建议（例如“尝试将 offset 36 加为符号源”）
    pub suggestions: Vec<String>,
    /// 有效符号约束数
    pub symbolic_constraint_count: usize,
    /// 包含 UF 的约束数（应设为 0 才能精确求解）
    pub uf_constraint_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind")]
pub enum ExplainCategory {
    UnsatPath(UnsatReason),
    UnknownSolver(UnknownReason),
    Error,
}

/// 说明一个失败项的原因
pub fn explain_solve(
    result: &SolverResult,
    path_constraints: &[PathConstraint],
    target_step: u32,
    target_transaction_id: u32,
    target_condition: &Expr,
    _sym_vars: &[String],
) -> Option<SolveExplain> {
    match result {
        SolverResult::Sat { .. } => None, // 成功无需解释
        SolverResult::Error { .. } => Some(SolveExplain {
            category: ExplainCategory::Error,
            message: "系统错误（Z3 未找到或运行失败）".into(),
            suggestions: vec!["1. 确认 Z3 已安装（brew install z3）".into(),
                               "2. 检查 z3_path 设置".into()],
            symbolic_constraint_count: 0,
            uf_constraint_count: 0,
        }),
        SolverResult::Unsat { .. } => {
            // 诊断原因
            let relevant: Vec<&PathConstraint> = path_constraints.iter()
                .filter(|c| c.transaction_id == target_transaction_id && c.step < target_step
                    && !c.condition.symbols().is_empty())
                .collect();

            // 判断是否具体条件
            if target_condition.is_concrete() {
                return Some(SolveExplain {
                    category: ExplainCategory::UnsatPath(UnsatReason::ConcreteCondition),
                    message: "目标 JUMPI 条件是具体常量，尚未传入任何符号变量".into(),
                    suggestions: vec![
                        "请先运行 symbolic_slice 确认该 JUMPI 确实有符号依赖".into(),
                        "或者使用 symbolic_auto_solve 它会自动找符号源".into(),
                    ],
                    symbolic_constraint_count: relevant.len(),
                    uf_constraint_count: 0,
                });
            }

            // 找冲突约束：路径中是否有与目标方向相反的约束
            let conflict_step = find_conflict_step(path_constraints, target_step, target_transaction_id, target_condition);

            let suggest = if let Some(cs) = conflict_step {
                vec![format!("步骤 {} 的路径约束与目标方向冲突，尝试 goal=SkipJump/TakeJump 切换方向试试", cs)]
            } else {
                vec!["尝试切换 goal：如果你要 TakeJump 尝试 SkipJump，反之亦然".into()]
            };

            Some(SolveExplain {
                category: ExplainCategory::UnsatPath(UnsatReason::PathContradiction { conflict_step }),
                message: format!(
                    "路径约束与目标冲突，无满足所有约束的输入。相关约束共 {} 个。",
                    relevant.len()
                ),
                suggestions: suggest,
                symbolic_constraint_count: relevant.len(),
                uf_constraint_count: 0,
            })
        }
        SolverResult::Unknown { reason, .. } => {
            // 计算 UF 数量
            let uf_count = path_constraints.iter()
                .filter(|c| c.transaction_id == target_transaction_id
                    && c.step < target_step
                    && has_uninterpreted_ops(&c.condition))
                .count()
                + if has_uninterpreted_ops(target_condition) { 1 } else { 0 };

            let (ur, msg, sug) = if uf_count > 0 {
                (
                    UnknownReason::UninterpretedFunctions { uf_count },
                    format!("共 {} 个约束包含无解释函数（EXP/BYTE），导致 Z3 无法完全精确求解", uf_count),
                    vec![
                        "已对小常量 EXP/BYTE/SIGNEXTEND 做了精确展开，尝试确认这些指令的指数是否确实是小常量".into(),
                        "考虑简化约束（移除部分前缀路径约束）重试".into(),
                    ]
                )
            } else if reason.contains("timeout") || reason.contains("resource") {
                (
                    UnknownReason::Timeout,
                    "求解超时，约束多且复杂".into(),
                    vec!["考虑减少符号变量数量重试".into()]
                )
            } else {
                (
                    UnknownReason::Other { detail: reason.clone() },
                    format!("Z3 返回 unknown: {}", reason),
                    vec![]
                )
            };

            let relevant_count = path_constraints.iter()
                .filter(|c| c.transaction_id == target_transaction_id
                    && c.step < target_step
                    && !c.condition.symbols().is_empty())
                .count();

            Some(SolveExplain {
                category: ExplainCategory::UnknownSolver(ur),
                message: msg,
                suggestions: sug,
                symbolic_constraint_count: relevant_count,
                uf_constraint_count: uf_count,
            })
        }
    }
}

/// 尝试冲突约束定位：找到前缀路径中与目标方向所要求的设置最直接冲突的步骤
fn find_conflict_step(
    path_constraints: &[PathConstraint],
    target_step: u32,
    target_tx: u32,
    target_condition: &Expr,
) -> Option<u32> {
    // 简单预测：找到和目标条件共享符号变量且路径方向相反的最后一个约束
    let target_syms = target_condition.symbols();
    if target_syms.is_empty() { return None; }

    path_constraints.iter()
        .filter(|c| {
            c.transaction_id == target_tx
                && c.step < target_step
                && !c.condition.symbols().is_empty()
                && c.condition.symbols().intersection(&target_syms).next().is_some()
        })
        .max_by_key(|c| c.step)
        .map(|c| c.step)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
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
#[derive(Debug, Clone, Serialize, Deserialize)]
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
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let uid = COUNTER.fetch_add(1, Ordering::Relaxed);
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
