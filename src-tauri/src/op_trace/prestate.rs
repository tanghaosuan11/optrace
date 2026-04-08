//! Prestate 获取与应用
//!
//! 通过 `debug_traceTransaction` + `prestateTracer` 获取交易前状态，
//! 并预填到 CacheDB 中。

use revm::primitives::{Address, B256, Bytes};
use revm::state::{AccountInfo, Bytecode};
use std::borrow::Cow;
use std::collections::HashMap;

use super::AlloyCacheDB;

/// debug_traceTransaction 返回的 prestateTracer 单个账户
#[derive(serde::Deserialize, Debug)]
pub(crate) struct PrestateAccount {
    #[serde(default)]
    balance: Option<revm::primitives::U256>,
    #[serde(default)]
    nonce: Option<u64>,
    #[serde(default)]
    code: Option<Bytes>,
    #[serde(default)]
    storage: Option<HashMap<B256, revm::primitives::U256>>,
}

/// 通过 debug_traceTransaction + prestateTracer 获取交易执行前的所有相关状态
pub(crate) async fn fetch_prestate(
    provider: &alloy_provider::DynProvider,
    tx_hash: B256,
) -> anyhow::Result<HashMap<Address, PrestateAccount>> {
    use alloy_provider::Provider;
    let params = serde_json::json!([
        tx_hash,
        { "tracer": "prestateTracer" }
    ]);
    let result: HashMap<Address, PrestateAccount> = provider
        .raw_request(Cow::Borrowed("debug_traceTransaction"), params)
        .await
        .map_err(|e| anyhow::anyhow!("prestateTracer RPC failed: {e}"))?;
    println!(
        "[prestate] fetched {} accounts from prestateTracer",
        result.len()
    );
    Ok(result)
}

/// 将 prestateTracer 返回的数据预填到 CacheDB
pub(crate) fn apply_prestate(cache_db: &mut AlloyCacheDB, prestate: HashMap<Address, PrestateAccount>) {
    // println!("[prestate] applying prestate to cache_db...,{:?}", prestate);
    for (address, acct) in prestate {
        let code_bytes = acct.code.unwrap_or_default();
        let code_hash = revm::primitives::keccak256(&code_bytes);
        let info = AccountInfo {
            balance: acct.balance.unwrap_or_default(),
            nonce: acct.nonce.unwrap_or(0),
            code_hash,
            account_id: None,
            code: Some(Bytecode::new_raw(code_bytes)),
        };
        cache_db.insert_account_info(address, info);

        if let Some(storage) = acct.storage {
            for (slot, value) in storage {
                let _ = cache_db.insert_account_storage(
                    address,
                    slot.into(),
                    value,
                );
            }
        }
    }
}
