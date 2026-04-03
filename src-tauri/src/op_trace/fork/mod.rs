// What-If Fork 模块
// 在指定步修改 stack/memory 后重跑交易（假设执行）

// Legacy-only module (not exported). New execution path uses unified Cheatcodes + set_patches.
mod fork_inspector;

#[derive(Clone, Debug, serde::Deserialize)]
pub struct StatePatch {
    pub step_index: usize,
    pub stack_patches: Vec<(usize, String)>,  // (stack_pos, hex_value)
    pub memory_patches: Vec<(usize, String)>, // (byte_offset, hex_data)
}
