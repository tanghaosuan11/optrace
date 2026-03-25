//! 字节码追踪器：管理合约字节码的更新和发送

use revm::primitives::Bytes;

#[derive(Clone, Default)]
pub struct BytecodeTracer {
    last_bytecode_hash: Option<[u8; 32]>,
}

impl BytecodeTracer {
    pub fn new() -> Self {
        Self {
            last_bytecode_hash: None,
        }
    }

    /// 检查字节码是否已变化（通过哈希对比）
    pub fn has_bytecode_changed(&self, bytecode: &Bytes) -> bool {
        use std::collections::hash_map::DefaultHasher;
        use std::hash::{Hash, Hasher};

        let mut hasher = DefaultHasher::new();
        bytecode.hash(&mut hasher);
        let hash = hasher.finish();
        let hash_bytes = hash.to_le_bytes();
        let mut full_hash = [0u8; 32];
        full_hash[..8].copy_from_slice(&hash_bytes);

        match self.last_bytecode_hash {
            Some(prev_hash) => prev_hash != full_hash,
            None => true,
        }
    }

    /// 更新字节码哈希缓存
    pub fn update_bytecode_hash(&mut self, bytecode: &Bytes) {
        use std::collections::hash_map::DefaultHasher;
        use std::hash::{Hash, Hasher};

        let mut hasher = DefaultHasher::new();
        bytecode.hash(&mut hasher);
        let hash = hasher.finish();
        let hash_bytes = hash.to_le_bytes();
        let mut full_hash = [0u8; 32];
        full_hash[..8].copy_from_slice(&hash_bytes);

        self.last_bytecode_hash = Some(full_hash);
    }

    /// 返回字节码用于发送（简化接口）
    pub fn get_bytecode(&self, bytecode: &Bytes) -> Bytes {
        bytecode.clone()
    }
}
