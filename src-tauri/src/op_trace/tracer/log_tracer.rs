//! 日志事件追踪器：处理 LOG0-LOG4 指令产生的事件

use revm::primitives::Log;

#[derive(Clone, Default)]
pub struct LogTracer {
    log_step_offset: usize,
}

impl LogTracer {
    pub fn new() -> Self {
        Self {
            log_step_offset: 0,
        }
    }

    /// 记录当前 step 计数（用于计算日志产生的步骤索引）
    /// step_count 在 step() 末尾已经 +1，所以产生的日志属于上一步
    pub fn record_current_step_count(&mut self, step_count: usize) {
        self.log_step_offset = step_count;
    }

    /// 获取日志对应的步骤索引
    /// 由于 step_count 已经递增，需要 -1 来获取产生日志的实际步骤
    pub fn get_log_step_index(&self) -> usize {
        self.log_step_offset.saturating_sub(1)
    }

    /// 验证日志是否有效
    pub fn is_valid_log(_log: &Log) -> bool {
        // 日志结构本身由 revm 保证有效
        true
    }
}
