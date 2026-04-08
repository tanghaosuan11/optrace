//! 余额变化计算
//!
//! 从 EVM 状态差异和日志中提取 ETH / ERC20 Token 净变化。

use revm::primitives::{Address, B256, U256, Log};
use serde::Serialize;
use std::collections::HashMap;

/// ERC20 Transfer(address,address,uint256) topic
pub const TRANSFER_TOPIC: B256 = B256::new([
    0xdd, 0xf2, 0x52, 0xad, 0x1b, 0xe2, 0xc8, 0x9b, 0x69, 0xc2, 0xb0, 0x68, 0xfc, 0x37, 0x8d, 0xaa,
    0x95, 0x2b, 0xa7, 0xf1, 0x63, 0xc4, 0xa1, 0x16, 0x28, 0xf5, 0x5a, 0x4d, 0xf5, 0x23, 0xb3, 0xef,
]);

pub fn topic_to_addr(topic: &B256) -> Address {
    Address::from_slice(&topic.as_slice()[12..])
}

pub fn full_addr(a: &Address) -> String {
    format!("{:?}", a)
}

pub fn fmt_addr_short(a: &Address) -> String {
    let s = full_addr(a);
    if s.len() > 10 { format!("{}...{}", &s[..6], &s[s.len()-4..]) } else { s }
}

pub fn fmt_signed_delta(gained: U256, lost: U256) -> Option<String> {
    if gained == lost { return None; }
    if gained >= lost {
        let n = gained - lost;
        if n.is_zero() { None } else { Some(format!("+{n}")) }
    } else {
        let n = lost - gained;
        if n.is_zero() { None } else { Some(format!("-{n}")) }
    }
}

#[derive(Serialize)]
pub struct BalanceTokenChangeOut {
    pub contract: String,
    pub delta: String,
}

#[derive(Serialize)]
pub struct AddressBalanceOut {
    pub address: String,
    pub eth: Option<String>,
    pub tokens: Vec<BalanceTokenChangeOut>,
}

/// 从日志中提取 ERC20 Transfer 信息，按钱包地址聚合
pub fn token_changes_from_logs(logs: &[Log]) -> HashMap<Address, HashMap<Address, (U256, U256)>> {
    let mut wallet: HashMap<Address, HashMap<Address, (U256, U256)>> = HashMap::new();
    for log in logs {
        let topics = log.data.topics();
        if topics.len() < 3 || topics[0] != TRANSFER_TOPIC { continue; }
        let from   = topic_to_addr(&topics[1]);
        let to     = topic_to_addr(&topics[2]);
        let amount = if log.data.data.len() >= 32 {
            U256::from_be_slice(&log.data.data[..32])
        } else { U256::ZERO };
        if amount.is_zero() { continue; }
        wallet.entry(from).or_default()
              .entry(log.address).or_insert((U256::ZERO, U256::ZERO)).1 += amount;
        wallet.entry(to).or_default()
              .entry(log.address).or_insert((U256::ZERO, U256::ZERO)).0 += amount;
    }
    wallet
}

use revm::state::EvmState;

/// 计算按钱包地址汇总的余额净变化，同时返回 JSON 字符串
/// JSON 格式: [{ "address": "0x...", "eth": "+1000" | "-500" | null, "tokens": [{ "contract": "0x...", "delta": "+500" }] }]
pub fn compute_and_print_balance_changes(evm_state: &EvmState, logs: &[Log]) -> String {
    let eth_key = Address::ZERO;
    
    let mut wallet: HashMap<Address, HashMap<Address, (U256, U256)>> = HashMap::new();

    for log in logs {
        let topics = log.data.topics();
        if topics.len() < 3 || topics[0] != TRANSFER_TOPIC { continue; }
        let from   = topic_to_addr(&topics[1]);
        let to     = topic_to_addr(&topics[2]);
        let amount = if log.data.data.len() >= 32 {
            U256::from_be_slice(&log.data.data[..32])
        } else { U256::ZERO };
        if amount.is_zero() { continue; }
        wallet.entry(from).or_default()
              .entry(log.address).or_insert((U256::ZERO, U256::ZERO)).1 += amount;
        wallet.entry(to).or_default()
              .entry(log.address).or_insert((U256::ZERO, U256::ZERO)).0 += amount;
    }

    for (addr, account) in evm_state.iter() {
        let orig = account.original_info.balance;
        let curr = account.info.balance;
        if orig == curr { continue; }
        let (gained, lost) = if curr > orig { (curr - orig, U256::ZERO) }
                             else           { (U256::ZERO, orig - curr) };
        let e = wallet.entry(*addr).or_default()
                      .entry(eth_key).or_insert((U256::ZERO, U256::ZERO));
        e.0 += gained;
        e.1 += lost;
    }

    if wallet.is_empty() {
        return "[]".to_string();
    }

    let mut addrs: Vec<Address> = wallet.keys().cloned().collect();
    addrs.sort_by_key(|a| full_addr(a));

    let mut json_entries: Vec<String> = Vec::with_capacity(addrs.len());

    for addr in &addrs {
        let tokens = &wallet[addr];

        // ETH
        let eth_json = if let Some(&(gained, lost)) = tokens.get(&eth_key) {
            let delta_str = if gained >= lost {
                format!("+{}", gained - lost)
            } else {
                format!("-{}", lost - gained)
            };
            format!("\"{}\"", delta_str)
        } else {
            "null".to_string()
        };

        // ERC20 tokens
        let mut token_addrs: Vec<Address> = tokens.keys()
            .filter(|&&t| t != eth_key).cloned().collect();
        token_addrs.sort_by_key(|a| full_addr(a));

        let mut token_json_parts: Vec<String> = Vec::new();
        for token in &token_addrs {
            let (gained, lost) = tokens[token];
            let net_str = if gained >= lost {
                if (gained - lost).is_zero() { continue; }
                let n = gained - lost;
                format!("+{n}")
            } else {
                let n = lost - gained;
                format!("-{n}")
            };
            token_json_parts.push(format!(
                "{{\"contract\":\"{}\",\"delta\":\"{}\"}}",
                full_addr(token), net_str
            ));
        }

        json_entries.push(format!(
            "{{\"address\":\"{}\",\"eth\":{},\"tokens\":[{}]}}",
            full_addr(addr),
            eth_json,
            token_json_parts.join(",")
        ));
    }

    format!("[{}]", json_entries.join(","))
}
