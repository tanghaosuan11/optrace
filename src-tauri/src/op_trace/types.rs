use anyhow::Result;
use revm::primitives::{hex::FromHex, Address, TxKind};

/// Parses `TxDebugData.to` for replay: empty / `0x` / zero address ⇒ contract creation (`TxKind::Create`).
pub fn parse_tx_kind_from_to_field(to_hex: &str) -> Result<TxKind> {
    let s = to_hex.trim();
    if s.is_empty() || s.eq_ignore_ascii_case("0x") {
        return Ok(TxKind::Create);
    }
    let addr = Address::from_hex(s).map_err(|e| anyhow::anyhow!("invalid tx.to: {e}"))?;
    if addr.is_zero() {
        Ok(TxKind::Create)
    } else {
        Ok(TxKind::Call(addr))
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, serde::Serialize)]
pub enum CallKind {
    #[default]
    Call,
    StaticCall,
    CallCode,
    DelegateCall,
    AuthCall,
    Create,
    Create2,
}

#[derive(Debug, serde::Deserialize)]
pub struct TxDebugData {
    pub from: String,
    pub to: String,
    pub value: String,
    pub gas_price: String,
    pub gas_limit: String,
    pub data: String,
    /// 磁盘 AlloyDB 缓存文件名用；不填则回退为会话锚点 `tx`
    #[serde(default)]
    pub tx_hash: Option<String>,
    /// 缓存文件名中的块号（与 `get_cache_path` 一致，一般为锚点父块）；不填则回退为锚点交易的父块
    #[serde(default)]
    pub cache_block: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
pub struct BlockDebugData {
    pub number: String,
    pub timestamp: String,
    pub base_fee: String,
    pub beneficiary: String,
    pub difficulty: String,
    pub mix_hash: String,
    pub gas_limit: String,
}
