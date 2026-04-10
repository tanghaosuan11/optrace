//! Foundry calltree 文本解析
//! 解析 `forge test -vvv` / `forge test --debug --dump` 附带的 Trace 输出
//! 文件名固定：optrace_calltree.json（内容为纯文本）
//!
//! 示例格式：
//! ```
//!   [50329] PuppetV2Challenge::test_assertInitialState()
//!     ├─ [0] VM::assertEq(...) [staticcall]
//!     │   └─ ← [Return]
//!     ├─ [2516] DamnValuableToken::balanceOf(player: [...]) [staticcall]
//!     │   └─ ← [Return] 10000000000000000000000 [1e22]
//!     └─ ← [Stop]
//! ```

use serde::Serialize;

// ─── 数据结构 ─────────────────────────────────────────────────────────────────

/// calltree 中的单个调用帧
#[derive(Debug, Clone, Serialize)]
pub struct CallTreeFrame {
    pub frame_idx: usize,
    pub parent_idx: Option<usize>,
    pub depth: u16,
    pub gas_used: u64,
    /// "ContractName::fn" 或原始地址 "0xABCD..."，不含参数
    pub target: String,
    /// 小写 call 类型："staticcall"|"call"|"delegatecall"|"create"|"create2"
    /// root 帧为 None
    pub call_type: Option<String>,
    /// ETH 转账金额（如 {value: 1000000000000000000}），单位 wei
    pub value_wei: Option<u128>,
    /// "Return" | "Stop" | "Revert" | None
    pub status: Option<String>,
    /// 返回值原始文本（可能含多个值，逗号分隔）
    pub return_data: Option<String>,
    pub children: Vec<usize>,
    /// 调用参数原始文本（括号内的全部内容），如 `10000 [1e4], 10000 [1e4]`
    pub call_args: Option<String>,
    /// 该帧内发出的 emit 文本列表（来自 calltree 详细格式，如 "emit Transfer(...)"）
    pub emit_texts: Vec<String>,
    /// 该帧属于 setUp 子树（含 setUp 本身及其所有子帧），用于过滤 setUp 阶段数据
    pub is_in_setup: bool,
}

// ─── 解析 ─────────────────────────────────────────────────────────────────────

/// 行首 `│` 字符数 → 深度
fn count_pipes(line: &str) -> usize {
    // Unicode: │ = U+2502
    line.chars()
        .take_while(|&c| c == '│' || c == ' ' || c == '\t')
        .filter(|&c| c == '│')
        .count()
}

/// 判断一行是否为 return 行（含 `← [`）
fn is_return_line(line: &str) -> bool {
    line.contains("← [")
}

/// 从 call 行提取 (depth, gas, target, call_type, value_wei)
fn parse_call_line(line: &str) -> Option<(u16, u64, String, Option<String>, Option<u128>, Option<String>)> {
    // 计算 pipe 数
    let pipe_count = count_pipes(line) as u16;

    // 找到 [gas] 的位置
    let bracket_pos = line.find('[')?;
    // 检查括号内是否是数字（排除 return 行的 ← [Return]）
    let after_bracket = &line[bracket_pos + 1..];
    let close_pos = after_bracket.find(']')?;
    let gas_str = &after_bracket[..close_pos];
    let gas_used = gas_str.trim().parse::<u64>().ok()?;

    let rest = &after_bracket[close_pos + 1..].trim_start();

    // 提取 value_wei：`{value: N}` 或 `{value: N ether}`
    let value_wei = parse_value_annotation(rest);

    // 提取 call_type（行末的 [staticcall] 等）
    let call_type = parse_call_type(rest);

    // 提取 target（Name::fn 部分，去掉参数和 call_type）
    let target = extract_target(rest);

    // 提取调用参数（括号内原始文本）
    let call_args = extract_call_args(rest);

    // 深度：与 inspector journaled_state.depth() 对齐，从 1 起；root=1，第一层子调用=2
    let has_tree_char = line.contains('├') || line.contains('└');
    let depth = if has_tree_char { pipe_count + 2 } else { 1 };

    Some((depth, gas_used, target, call_type, value_wei, call_args))
}

/// 提取行末的 call type
fn parse_call_type(rest: &str) -> Option<String> {
    // 找最后一个 [...] 且内容是已知 call type
    let known = ["staticcall", "call", "delegatecall", "create", "create2"];
    if let Some(last_bracket) = rest.rfind('[') {
        let candidate = &rest[last_bracket + 1..];
        if let Some(close) = candidate.find(']') {
            let ct = &candidate[..close];
            if known.contains(&ct) {
                return Some(ct.to_string());
            }
        }
    }
    None
}

/// 提取 {value: N} 中的 wei
fn parse_value_annotation(text: &str) -> Option<u128> {
    // 匹配 "{value: N}" 中的 N
    let start = text.find("{value:")?;
    let after = &text[start + 7..];
    let end = after.find('}')?;
    let val_str = after[..end].trim();
    // 可能是 "1 ether" 或纯数字
    if let Ok(n) = val_str.parse::<u128>() {
        Some(n)
    } else if let Some(n_str) = val_str.strip_suffix(" ether") {
        n_str.trim().parse::<u128>().ok().map(|n| n * 1_000_000_000_000_000_000)
    } else {
        None
    }
}

/// 提取括号内的参数文本，去掉末尾 [calltype] 后截取 `(...)` 内容
fn extract_call_args(rest: &str) -> Option<String> {
    let known = ["staticcall", "call", "delegatecall", "create", "create2"];
    // strip trailing [calltype]
    let base: &str = if let Some(last_bracket) = rest.rfind('[') {
        let candidate = &rest[last_bracket + 1..];
        if let Some(close) = candidate.find(']') {
            if known.contains(&&candidate[..close]) {
                rest[..last_bracket].trim_end()
            } else {
                rest
            }
        } else {
            rest
        }
    } else {
        rest
    };
    let open = base.find('(')?;
    let close = base.rfind(')')?;
    if close <= open {
        return None;
    }
    let args = base[open + 1..close].trim().to_string();
    if args.is_empty() { None } else { Some(args) }
}

/// 提取 "Name::fn"
fn extract_target(rest: &str) -> String {
    // 去掉末尾的 [calltype]
    let trimmed = if let Some(pos) = rest.rfind('[') {
        let candidate = &rest[pos..];
        if candidate.contains("call") || candidate.contains("create") {
            &rest[..pos]
        } else {
            rest
        }
    } else {
        rest
    };
    // 截取到 '(' 之前
    let base = if let Some(p) = trimmed.find('(') {
        &trimmed[..p]
    } else {
        trimmed
    };
    // 去掉 {value: ...}
    let base = if let Some(p) = base.find('{') {
        &base[..p]
    } else {
        base
    };
    base.trim().to_string()
}

/// 从 return 行提取 (status, return_data)
fn parse_return_line(line: &str) -> Option<(String, Option<String>)> {
    let arrow_pos = line.find("← [")?;
    // "← [" 在 UTF-8 中是 5 字节：← (3) + 空格 (1) + [ (1)
    let after = &line[arrow_pos + "← [".len()..];
    let close = after.find(']')?;
    let status = after[..close].to_string();
    let rest = after[close + 1..].trim();
    let return_data = if rest.is_empty() { None } else { Some(rest.to_string()) };
    Some((status, return_data))
}

/// 解析 calltree 文本 → frame 列表
///
/// 按空白行将文本分割成若干 section（每个 section 是一个独立的根调用树）。
/// - 若某 section 的第一个有效调用行含有 `::setUp(`，则该 section 所有帧标记 `is_in_setup = true`
/// - 其余 section 为实际测试的 calltree，标记 `is_in_setup = false`
///
/// 如果文件带有 "Traces:" 前缀行，会先跳过该行之前的内容。
pub fn parse_calltree(text: &str) -> Vec<CallTreeFrame> {
    // 跳过 "Traces:" 前缀行（可选）────────
    let skip_lines = text.lines()
        .position(|l| l.trim_start().starts_with("Traces:"))
        .map(|i| i + 1)
        .unwrap_or(0);


    let mut raw_sections: Vec<Vec<&str>> = Vec::new();
    let mut cur: Vec<&str> = Vec::new();

    for line in text.lines().skip(skip_lines) {
        if line.trim().is_empty() {
            if !cur.is_empty() {
                raw_sections.push(std::mem::take(&mut cur));
            }
        } else {
            cur.push(line);
        }
    }
    if !cur.is_empty() {
        raw_sections.push(cur);
    }


    let mut all_frames: Vec<CallTreeFrame> = Vec::new();
    for section in &raw_sections {
        let is_setup = section_is_setup(section);
        parse_section(section, is_setup, &mut all_frames);
    }
    all_frames
}

/// 判断一个 section 是否属于 setUp 子树。
fn section_is_setup(lines: &[&str]) -> bool {
    for line in lines {
        let stripped = line.trim();
        if !stripped.contains('[') { continue; }
        if stripped.starts_with("Ran ") || stripped.starts_with("Suite result")
            || stripped.starts_with("[PASS]") || stripped.starts_with("[FAIL]") { continue; }
        if is_return_line(line) { continue; }
        if let Some((_depth, _gas, target, _ct, _val, _args)) = parse_call_line(line) {
            if target.is_empty() { continue; }
            let fn_name = target.rsplit("::").next().unwrap_or("");
            return fn_name == "setUp";
        }
    }
    false
}

fn parse_section(lines: &[&str], is_in_setup: bool, all_frames: &mut Vec<CallTreeFrame>) {
    // depth → 全局 frame_idx（用于设置 parent/children）
    let mut depth_stack: Vec<usize> = Vec::new();

    for line in lines {
        // ── 去掉行首 tree 字符，得到内容部分 ───────────────────────────────
        let tree_stripped = line.trim()
            .trim_start_matches(|c: char| c == '│' || c == '├' || c == '└' || c == '─' || c == ' ');

        // ── 跳过 storage changes 段 ─────────────────────────────────────────
        if tree_stripped.starts_with("storage changes:") || tree_stripped.starts_with("@ ") {
            continue;
        }

        // ── 解析 emit 行 ─────────────────────────────────────────────────────
        if tree_stripped.starts_with("emit ") {
            let pipe_count = count_pipes(line) as u16;
            let owner_depth = pipe_count + 1;
            if let Some(&frame_idx) = depth_stack.iter().rev().find(|&&idx| {
                all_frames.get(idx).map_or(false, |f| f.depth == owner_depth)
            }) {
                all_frames[frame_idx].emit_texts.push(tree_stripped.to_string());
            }
            continue;
        }

        // ── 解析 return 行 ───────────────────────────────────────────────────
        if is_return_line(line) {
            let pipe_count = count_pipes(line) as u16;
            let call_depth = pipe_count + 1;
            if let Some((status, return_data)) = parse_return_line(line) {
                if let Some(&frame_idx) = depth_stack.iter().rev().find(|&&idx| {
                    all_frames.get(idx).map_or(false, |f| f.depth == call_depth)
                }) {
                    all_frames[frame_idx].status = Some(status);
                    all_frames[frame_idx].return_data = return_data;
                }
            }
            continue;
        }

        // ── 解析 call 行 ─────────────────────────────────────────────────────
        let stripped = line.trim();
        if !stripped.contains('[') { continue; }
        if stripped.starts_with("Ran ") || stripped.starts_with("Suite result")
            || stripped.starts_with("[PASS]") || stripped.starts_with("[FAIL]") { continue; }

        if let Some((depth, gas_used, target, call_type, value_wei, call_args)) = parse_call_line(line) {
            if target.is_empty() { continue; }

            let frame_idx = all_frames.len();

            // 确定 parent：找 depth_stack 中 depth < 当前的最深帧
            depth_stack.retain(|&idx| all_frames[idx].depth < depth);
            let parent_idx = depth_stack.last().copied();

            let frame = CallTreeFrame {
                frame_idx,
                parent_idx,
                depth,
                gas_used,
                target,
                call_type,
                value_wei,
                status: None,
                return_data: None,
                children: Vec::new(),
                call_args,
                emit_texts: Vec::new(),
                is_in_setup,
            };

            if let Some(parent) = parent_idx {
                all_frames[parent].children.push(frame_idx);
            }

            all_frames.push(frame);
            depth_stack.push(frame_idx);
        }
    }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_calltree_tmp() {
        let path = "/tmp/optrace_calltree.json";
        if !std::path::Path::new(path).exists() {
            eprintln!("SKIP: {path} not found");
            return;
        }
        let text = std::fs::read_to_string(path).expect("read calltree");
        let frames = parse_calltree(&text);

        println!("\n=== calltree frames ({}) ===", frames.len());
        for f in &frames {
            let indent = "  ".repeat(f.depth as usize);
            let ct = f.call_type.as_deref().unwrap_or("root");
            println!("{indent}[{}] {} gas={} status={} children={:?}",
                ct, f.target, f.gas_used, f.status.as_deref().unwrap_or("?"), f.children);
        }

        assert!(!frames.is_empty(), "should parse at least one frame");
        // root 帧 depth == 0
        assert_eq!(frames[0].depth, 0);
        // root 应为 Stop
        assert_eq!(frames[0].status.as_deref(), Some("Stop"));
    }
}
