
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
