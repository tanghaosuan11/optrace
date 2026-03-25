//! Gas 消耗追踪器：计算和记录每步的 gas 成本

use revm::interpreter::interpreter::EthInterpreter;

#[derive(Clone, Default)]
pub struct GasTracer {
    gas_remaining_before: u64,
    gas_remaining_after: u64,
    gas_cost: u64,
}

impl GasTracer {
    pub fn new() -> Self {
        Self {
            gas_remaining_before: 0,
            gas_remaining_after: 0,
            gas_cost: 0,
        }
    }

    /// 记录执行前的 gas 剩余值
    pub fn record_gas_before(&mut self, remaining: u64) {
        self.gas_remaining_before = remaining;
    }

    /// 执行后回填 gas 成本
    pub fn backfill_gas_cost(&mut self, interp: &revm::interpreter::Interpreter<EthInterpreter>) {
        self.gas_remaining_after = interp.gas.remaining();
        self.gas_cost = self.gas_remaining_before.saturating_sub(self.gas_remaining_after);
    }

    /// 获取当前步的 gas 成本
    pub fn get_gas_cost(&self) -> u64 {
        self.gas_cost
    }

    /// 获取执行前的 gas 剩余值
    pub fn get_gas_remaining_before(&self) -> u64 {
        self.gas_remaining_before
    }

    /// 获取执行后的 gas 剩余值
    pub fn get_gas_remaining_after(&self) -> u64 {
        self.gas_remaining_after
    }
}
