use std::sync::{Arc, Mutex};

use crate::op_trace::{debug_session::DebugSession, types::CallKind};
use revm::primitives::{Address, Bytes,U256};
use revm_interpreter::InterpreterResult;

#[derive(Clone, Default, serde::Serialize)]
pub struct FrameInfo {
    pub parent_id: u16,
    pub depth: u16,
    pub frame_id: u16,
    pub address: Address,
    // 该frame的累计step数
    pub step_count: usize,
    pub value: U256,
    pub caller: Address,
    pub target_address: Address,
    pub selfdestruct_refund_target: Option<Address>,
    pub selfdestruct_transferred_value: Option<U256>,
    pub kind: CallKind,
    pub gas_used: u64,
    pub gas_limit: u64,
    pub input: Bytes,
    pub status: Option<InterpreterResult>,
    pub success: bool,
    pub output: Bytes,
    /// CALL 指令的 retOffset（父 frame 内存写入起始位置）
    pub ret_memory_offset: usize,
    /// CALL 指令的 retSize（父 frame 内存最大写入长度）
    pub ret_memory_size: usize,
}

#[derive(Clone)]
pub struct FrameManager {
    next_frame_id: u16,
    frame_info_vec: Vec<FrameInfo>,
    debug_session: Arc<Mutex<DebugSession>>,
}

impl FrameManager {
    pub fn new(debug_session: Arc<Mutex<DebugSession>>) -> Self {
        Self {
            next_frame_id: 0,
            frame_info_vec: Vec::new(),
            debug_session,
        }
    }

    pub fn reset(&mut self) {
        self.next_frame_id = 0;
        self.frame_info_vec.clear();
    }

    pub fn allocate_frame_id(&mut self) -> u16 {
        self.next_frame_id += 1;
        self.next_frame_id    
    }

    pub fn frame_stack_len(&self) -> usize {
        self.frame_info_vec.len()
    }

    pub fn current_frame(&self) -> Option<&FrameInfo> {
        self.frame_info_vec.last()
    }

    pub fn current_frame_mut(&mut self) -> Option<&mut FrameInfo> {
        self.frame_info_vec.last_mut()
    }

    pub fn current_frame_parent(&self) -> Option<FrameInfo> {
        if self.frame_info_vec.len() >= 2 {
            Some(self.frame_info_vec[self.frame_info_vec.len() - 2].clone())
        } else {
            None
        }
    }

    pub fn current_id(&self) -> u16 {
        self.frame_info_vec.last().map(|f| f.frame_id).unwrap_or(0)
    }

    pub fn current_gas_limit(&self) -> u64 {
        self.frame_info_vec
            .last()
            .map(|f| f.gas_limit)
            .unwrap_or(0)
    }

    pub fn current_depth(&self) -> u16 {
        self.frame_info_vec.last().map(|f| f.depth).unwrap_or(0)
    }

    pub fn current_caller(&self) -> Address {
        self.frame_info_vec
            .last()
            .map(|f| f.caller)
            .unwrap_or(Address::ZERO)
    }

    pub fn current_kind(&self) -> CallKind {
        self.frame_info_vec
            .last()
            .map(|f| f.kind.clone())
            .unwrap_or(CallKind::Call)
    }

    pub fn current_address(&self) -> Address {
        let default_address = Address::ZERO;
        self.frame_info_vec
            .last()
            .map(|f| f.address)
            .unwrap_or(default_address)
    }

    pub fn current_target(&self) -> Address {
        self.frame_info_vec
            .last()
            .map(|f| f.target_address)
            .unwrap_or(Address::ZERO)
    }

    pub fn current_step_count(&self) -> usize {
        self.frame_info_vec
            .last()
            .map(|f| f.step_count)
            .unwrap_or(0)
    }

    pub fn current_ret_memory_offset(&self) -> usize {
        self.frame_info_vec
            .last()
            .map(|f| f.ret_memory_offset)
            .unwrap_or(0)
    }
    pub fn current_ret_memory_size(&self) -> usize {
        self.frame_info_vec
            .last()
            .map(|f| f.ret_memory_size)
            .unwrap_or(0)
    }

    pub fn current_is_success(&self) -> bool {
        self.frame_info_vec
            .last()
            .map(|f| f.success)
            .unwrap_or(false)
    }

    pub fn current_update_status(&mut self, status: InterpreterResult) {
        if let Some(current) = self.frame_info_vec.last_mut() {
            current.status = Some(status);
            current.success = current.status.as_ref().is_some_and(|s| s.is_ok());
        }
    }

    pub fn current_update_outcome(&mut self, output: Bytes, gas_used: u64) {
        if let Some(current) = self.frame_info_vec.last_mut() {
            current.output = output;
            current.gas_used = gas_used;
        }
    }

    pub fn current_output(&self) -> Bytes {
        self.frame_info_vec
            .last()
            .map(|f| f.output.clone())
            .unwrap_or(Bytes::new())
    }

    // Parent
    pub fn parent_id(&self) -> u16 {
        if self.frame_info_vec.len() >= 2 {
            self.frame_info_vec[self.frame_info_vec.len() - 2].frame_id
        } else {
            0
        }
    }

    pub fn parent_step_count(&self) -> usize {
        if self.frame_info_vec.len() >= 2 {
            self.frame_info_vec[self.frame_info_vec.len() - 2].step_count
        } else {
            0
        }
    }

    pub fn parent_ret_memory_offset(&self) -> usize {
        if self.frame_info_vec.len() >= 2 {
            self.frame_info_vec[self.frame_info_vec.len() - 2].ret_memory_offset
        } else {
            0
        }
    }
    pub fn parent_ret_memory_size(&self) -> usize {
        if self.frame_info_vec.len() >= 2 {
            self.frame_info_vec[self.frame_info_vec.len() - 2].ret_memory_size
        } else {
            0
        }
    }

    pub fn current_increment_step_count(&mut self) {
        if let Some(current) = self.frame_info_vec.last_mut() {
            current.step_count += 1;
        }
    }

    pub fn push_frame(&mut self, info: FrameInfo) {
        self.frame_info_vec.push(info);
    }
    pub fn pop_frame(&mut self) -> Option<FrameInfo> {
        self.frame_info_vec.pop()
    }
    pub fn update_current(&mut self, f: impl Fn(&mut FrameInfo)) {
        if let Some(current) = self.frame_info_vec.last_mut() {
            f(current);
        }
    }
}
