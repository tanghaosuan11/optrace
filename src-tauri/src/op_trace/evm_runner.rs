//! EVM 执行入口
//!
//! 负责 RPC 数据获取、CacheDB 缓存管理、EVM 构建和执行。

use crate::optrace_journal::OpTraceJournal;
use alloy_provider::{
    network::TransactionResponse,
    Provider, ProviderBuilder,
};
use alloy_rpc_types_eth::{BlockNumberOrTag, TransactionTrait};
use revm::{
    Context, ExecuteCommitEvm, ExecuteEvm, InspectEvm, context::{
        BlockEnv, CfgEnv, Evm, LocalContext, TxEnv, result::{ExecResultAndState, ExecutionResult, HaltReason}
    }, context_interface::JournalTr, database::{AlloyDB, BlockId, Cache, CacheDB}, database_interface::WrapDatabaseAsync, handler::{EthPrecompiles, instructions::EthInstructions}, primitives::{Address, B256, Bytes, Log, TxKind, U256, hardfork::SpecId, hex::FromHex}, state::{AccountInfo, Bytecode, EvmState}
};
use sha2::{Digest, Sha256};
use std::{borrow::Cow, u64};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager};
use tauri::ipc::Channel;

use super::debug_session::{self, DebugSession};
use super::inspector::Cheatcodes;
use super::message_encoder::MessageEncoder;
use super::types::{parse_tx_kind_from_to_field, BlockDebugData, TxDebugData};
use super::AlloyCacheDB;
use super::fork::StatePatch;
use serde::Serialize;


/// 手填字段拼接后 SHA256，作缓存文件名第一段（链上路径仍用锚点 tx）。
fn tx_debug_data_content_hash_hex(row: &TxDebugData) -> String {
    let payload = format!(
        "{}|{}|{}|{}|{}|{}",
        row.from.trim(),
        row.to.trim(),
        row.value.trim(),
        row.gas_price.trim(),
        row.gas_limit.trim(),
        row.data.trim(),
    );
    let mut hasher = Sha256::new();
    hasher.update(payload.as_bytes());
    hex::encode(hasher.finalize())
}

fn resolve_cache_key(row: &TxDebugData, fallback_block: u64) -> (String, u64) {
    let hash = tx_debug_data_content_hash_hex(row);
    let block = row
        .cache_block
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .and_then(|s| u64::from_str_radix(s, 10).ok())
        .unwrap_or(fallback_block);
    (hash, block)
}

fn get_cache_path(
    app: &AppHandle,
    name_tx_part: &str,
    chain_id: u64,
    block_num: u64,
    prestate: bool,
) -> PathBuf {
    let cache_dir = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("optrace"));
    let dir = cache_dir.join("cache").join("evm_cache").join(chain_id.to_string());
    std::fs::create_dir_all(&dir).ok();
    let suffix = if prestate { "_pre" } else { "" };
    let clean_hash = name_tx_part
        .trim_start_matches("0x")
        .trim_start_matches("0X")
        .to_lowercase();
    dir.join(format!("{}_{}_{}{}.bin", clean_hash, block_num, "alloydb", suffix))
}

/// ERC20 Transfer(address,address,uint256) topic
const TRANSFER_TOPIC: B256 = B256::new([
    0xdd, 0xf2, 0x52, 0xad, 0x1b, 0xe2, 0xc8, 0x9b, 0x69, 0xc2, 0xb0, 0x68, 0xfc, 0x37, 0x8d, 0xaa,
    0x95, 0x2b, 0xa7, 0xf1, 0x63, 0xc4, 0xa1, 0x16, 0x28, 0xf5, 0x5a, 0x4d, 0xf5, 0x23, 0xb3, 0xef,
]);

fn topic_to_addr(topic: &B256) -> Address {
    Address::from_slice(&topic.as_slice()[12..])
}

fn full_addr(a: &Address) -> String {
    format!("{:?}", a)
}

fn fmt_addr_short(a: &Address) -> String {
    let s = full_addr(a);
    if s.len() > 10 { format!("{}...{}", &s[..6], &s[s.len()-4..]) } else { s }
}

/// 计算按钱包地址汇总的余额净变化，同时打印 + 返回 JSON 字符串
/// JSON 格式: [{ "address": "0x...", "eth": "+1000" | "-500" | null, "tokens": [{ "contract": "0x...", "delta": "+500" }] }]
pub(crate) fn compute_and_print_balance_changes(evm_state: &EvmState, logs: &[Log]) -> String {
    use std::collections::HashMap as HM;

    let eth_key = Address::ZERO;
    
    let mut wallet: HM<Address, HM<Address, (U256, U256)>> = HM::new();

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
        // println!("[statediff] (no balance changes)");
        return "[]".to_string();
    }

    let mut addrs: Vec<Address> = wallet.keys().cloned().collect();
    addrs.sort_by_key(|a| full_addr(a));

    let mut json_entries: Vec<String> = Vec::with_capacity(addrs.len());

    for addr in &addrs {
        let tokens = &wallet[addr];
        // println!("[statediff] {:?}", addr);

        // ETH
        let eth_json = if let Some(&(gained, lost)) = tokens.get(&eth_key) {
            let delta_str = if gained >= lost {
                format!("+{}", gained - lost)
            } else {
                format!("-{}", lost - gained)
            };
            // if gained >= lost {
            //     println!("  ETH  +{}", gained - lost);
            // } else {
            //     println!("  ETH  -{}", lost - gained);
            // }
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
                // println!("  token {}  +{}", fmt_addr_short(token), n);
                format!("+{n}")
            } else {
                let n = lost - gained;
                // println!("  token {}  -{}", fmt_addr_short(token), n);
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

fn token_changes_from_logs(logs: &[Log]) -> HashMap<Address, HashMap<Address, (U256, U256)>> {
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

#[derive(Serialize)]
struct BalanceTokenChangeOut {
    contract: String,
    delta: String,
}

#[derive(Serialize)]
struct AddressBalanceOut {
    address: String,
    eth: Option<String>,
    tokens: Vec<BalanceTokenChangeOut>,
}

fn fmt_signed_delta(gained: U256, lost: U256) -> Option<String> {
    if gained == lost { return None; }
    if gained >= lost {
        let n = gained - lost;
        if n.is_zero() { None } else { Some(format!("+{n}")) }
    } else {
        let n = lost - gained;
        if n.is_zero() { None } else { Some(format!("-{n}")) }
    }
}

fn save_cache(db: &AlloyCacheDB, path: &Path) {    
    match bincode::serialize(&db.cache) {
        Ok(bytes) => {
            if let Err(e) = std::fs::write(path, bytes) {
                eprintln!("[cache] ✗ write failed: {e}");
            } else {
                println!(
                    "[cache] ✓ saved to {:?} ({} accounts, {} contracts)",
                    path,
                    db.cache.accounts.len(),
                    db.cache.contracts.len()
                );
            }
        }
        Err(e) => eprintln!("[cache] ✗ serialize failed: {e}"),
    }
}

fn read_cache(path: &Path) -> Option<Cache> {
    let bytes = match std::fs::read(path) {
        Ok(b) => {
            println!("[cache] file found: {:?}", path);
            b
        }
        Err(e) => {
            println!("[cache] file not found: {:?} ({})", path, e);
            return None;
        }
    };
    match bincode::deserialize::<Cache>(&bytes) {
        Ok(loaded) => Some(loaded),
        Err(e) => {
            eprintln!("[cache] ✗ deserialize failed from {:?}: {e}", path);
            None
        }
    }
}

fn merge_cache_into(cache_db: &mut AlloyCacheDB, loaded: Cache, path: &Path) {
    let acct = loaded.accounts.len();
    let ctt = loaded.contracts.len();
    cache_db.cache.accounts.extend(loaded.accounts);
    cache_db.cache.contracts.extend(loaded.contracts);
    println!(
        "[cache] ✓ merged from {:?} ({} accounts, {} contracts)",
        path, acct, ctt
    );
}

fn dedup_cache_paths(paths: Vec<PathBuf>) -> Vec<PathBuf> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for p in paths {
        if seen.insert(p.clone()) {
            out.push(p);
        }
    }
    out
}

fn tx_env_from_debug(custom: &TxDebugData) -> anyhow::Result<TxEnv> {
    let from = Address::from_hex(&custom.from)?;
    let tx_kind = parse_tx_kind_from_to_field(&custom.to)?;
    let value = U256::from_str_radix(&custom.value, 10).unwrap_or_default();
    let gas_price = u128::from_str_radix(&custom.gas_price, 10).unwrap_or(0);
    let gas_limit = u64::from_str_radix(&custom.gas_limit, 10).unwrap_or(21000);
    let input = Bytes::from_hex(&custom.data).unwrap_or_default();
    Ok(TxEnv::builder()
        .caller(from)
        .kind(tx_kind)
        .value(value)
        .data(input)
        .gas_price(gas_price)
        .gas_limit(gas_limit)
        .build()
        .unwrap())
}

fn load_cache(cache_db: &mut AlloyCacheDB, path: &Path) -> bool {
    let bytes = match std::fs::read(path) {
        Ok(b) => {
            println!("[cache] file found: {:?}", path);
            b
        }
        Err(e) => {
            println!("[cache] file not found: {:?} ({})", path, e);
            return false;
        }
    };
    match bincode::deserialize::<Cache>(&bytes) {
        Ok(loaded) => {
            println!(
                "[cache] ✓ loaded from {:?} ({} accounts, {} contracts)",
                path,
                loaded.accounts.len(),
                loaded.contracts.len()
            );
            cache_db.cache = loaded;
            println!("[cache] 🎯 CacheDB 已填充，后续 RPC 调用应该会被缓存覆盖");
            true
        }
        Err(e) => {
            eprintln!("[cache] ✗ deserialize failed (stale?): {e}");
            println!("[cache] 🔄 缓存文件损坏，将从 RPC 重新获取并覆盖");
            false
        }
    }
}


#[derive(Clone, Debug)]
struct Env {
    block: BlockEnv,
    tx: TxEnv,
    cfg: CfgEnv,
}

impl Env {
    fn mainnet() -> Self {
        let mut cfg = CfgEnv::default();
        cfg.disable_nonce_check = true;
        // EIP-7825 (Osaka): default tx gas cap is 16_777_216; chain txs can exceed it. Replay must accept real limits.
        cfg.tx_gas_limit_cap = Some(u64::MAX);
        Self {
            block: BlockEnv::default(),
            tx: TxEnv::default(),
            cfg,
        }
    }
}


/// debug_traceTransaction 返回的 prestateTracer 单个账户
#[derive(serde::Deserialize, Debug)]
struct PrestateAccount {
    #[serde(default)]
    balance: Option<U256>,
    #[serde(default)]
    nonce: Option<u64>,
    #[serde(default)]
    code: Option<Bytes>,
    #[serde(default)]
    storage: Option<HashMap<B256, U256>>,
}

/// 通过 debug_traceTransaction + prestateTracer 获取交易执行前的所有相关状态
async fn fetch_prestate(
    provider: &alloy_provider::DynProvider,
    tx_hash: B256,
) -> anyhow::Result<HashMap<Address, PrestateAccount>> {
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
fn apply_prestate(cache_db: &mut AlloyCacheDB, prestate: HashMap<Address, PrestateAccount>) {
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


pub async fn op_trace(
    tx: &str,
    tx_data: Option<TxDebugData>,
    tx_data_list: Option<Vec<TxDebugData>>,
    block_data: Option<BlockDebugData>,
    rpc_url: &str,
    use_alloy_cache: bool,
    use_prestate: bool,
    enable_shadow: bool,
    readonly: bool,
    patches: Vec<StatePatch>,
    channel: Channel,
    app_handle: AppHandle,
    session_state: Arc<Mutex<std::collections::HashMap<String, super::debug_session::SessionEntry>>>,
    session_id: Option<String>,
) -> anyhow::Result<()> {
    let op_trace_t0 = std::time::Instant::now();
    // 创建新的 DebugSession 并存入全局状态
    let session = Arc::new(Mutex::new(DebugSession::new()));
    let normalized_session_id = super::debug_session::normalize_session_id(session_id.as_deref());
    {
        let mut guard = session_state.lock().unwrap();
        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;
        let entry = guard.entry(normalized_session_id.clone()).or_default();
        entry.session = None; // 清空同 session_id 的上一次 session
        entry.is_running = true;
        entry.updated_at_ms = now_ms;
    }

    let shadow_temp_dir = app_handle
        .path()
        .temp_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("optrace"));
    let encoder = MessageEncoder::new(channel);
    let mut inspector =
        Cheatcodes::<BlockEnv, TxEnv, CfgEnv>::new(
            encoder,
            session.clone(),
            shadow_temp_dir.clone(),
            enable_shadow,
        );
    inspector.set_patches(patches);

    let provider = ProviderBuilder::new().connect(rpc_url).await?.erased();

    let chain_id = provider.get_chain_id().await.unwrap_or(1);

    let tx_chain_data = provider
        .get_transaction_by_hash(tx.parse()?)
        .await?
        .ok_or_else(|| anyhow::anyhow!("transaction not found for hash {}", tx))?;
    // 说明：
    // - `state_block_num`：用于历史状态读取（AlloyDB/CacheDB），应为「父块」；
    //   这样读到的是交易执行前/块内执行前的状态，不会拿到执行后的 state。
    // - `exec_block_num`：用于 EVM 的区块环境（BlockEnv：basefee/timestamp/number/...），应为「当前块」。
    let chain_exec_block_num: u64 = tx_chain_data.block_number().unwrap();
    // 若前端传入 block_data，则以其 `number` 作为“当前块”执行环境的块号；
    // 并据此推导 state_block_num = exec_block_num - 1，实现“环境用当前块、状态读父块”的解耦。
    let exec_block_num: u64 = block_data
        .as_ref()
        .and_then(|b| u64::from_str_radix(b.number.trim(), 10).ok())
        .unwrap_or(chain_exec_block_num);
    let state_block_num: u64 = exec_block_num.saturating_sub(1);

    let is_multi = tx_data_list
        .as_ref()
        .map(|v| v.len() >= 2)
        .unwrap_or(false);

    let initial_tx: TxEnv = if is_multi {
        let list = tx_data_list.as_ref().unwrap();
        tx_env_from_debug(&list[0])?
    } else if let Some(ref custom_tx) = tx_data {
        tx_env_from_debug(custom_tx)?
    } else {
        TxEnv::builder()
            .caller(tx_chain_data.from())
            .kind(tx_chain_data.inner.kind())
            .value(tx_chain_data.value())
            .data(tx_chain_data.inner.input().clone())
            .gas_price(tx_chain_data.effective_gas_price(None))
            .gas_limit(tx_chain_data.gas_limit())
            .build()
            .unwrap()
    };

    let mut evm_block = BlockEnv::default();

    if let Some(ref custom_block) = block_data {
        evm_block.number = U256::from_str_radix(&custom_block.number, 10).unwrap_or_default();
        evm_block.timestamp =
            U256::from_str_radix(&custom_block.timestamp, 10).unwrap_or_default();
        evm_block.basefee = u64::from_str_radix(&custom_block.base_fee, 10).unwrap_or(0);
        evm_block.beneficiary =
            Address::from_hex(&custom_block.beneficiary).unwrap_or_default();
        evm_block.difficulty =
            U256::from_str_radix(&custom_block.difficulty, 10).unwrap_or_default();
        evm_block.prevrandao =
            Some(B256::from_hex(&custom_block.mix_hash).unwrap_or_default());
        evm_block.gas_limit =
            u64::from_str_radix(&custom_block.gas_limit, 10).unwrap_or(60000000);
    } else {
        let block = provider
            .get_block_by_number(BlockNumberOrTag::Number(exec_block_num))
            .await?
            .unwrap();
        evm_block.number = U256::from(block.header.number);
        evm_block.timestamp = U256::from(block.header.timestamp);
        evm_block.basefee = block.header.base_fee_per_gas.unwrap_or_default();
        evm_block.beneficiary = block.header.beneficiary;
        evm_block.difficulty = U256::from(block.header.difficulty);
        evm_block.prevrandao = Some(block.header.mix_hash).or(None);
        evm_block.gas_limit = block.header.gas_limit;
    }
    evm_block.gas_limit = u64::MAX; // 调试时不受块 gas limit 限制
    
    // prestateTracer 预填 — 精确模式（块内非首笔交易时保证状态正确）
    // 必须在 provider 被 AlloyDB::new() 消耗前调用
    let prestate_data = if use_prestate {
        let tx_hash = B256::from_hex(tx)?;
        match fetch_prestate(&provider, tx_hash).await {
            Ok(data) => Some(data),
            Err(e) => {
                eprintln!("[prestate] failed, falling back to lazy load: {e}");
                None
            }
        }
    } else {
        None
    };

    let alloy_db =
        WrapDatabaseAsync::new(AlloyDB::new(provider, BlockId::number(state_block_num))).unwrap();
    let mut cache_db = CacheDB::new(alloy_db);

    // 读取缓存路径：
    // - 多笔：收集所有 tx 对应的缓存路径，去重后全部加载并合并到一个 CacheDB；
    // - 单笔：仅加载该笔路径（或锚点 tx 的默认路径）。
    let cache_paths: Vec<PathBuf> = if is_multi {
        let list = tx_data_list.as_ref().unwrap();
        let mut paths = Vec::with_capacity(list.len());
        for row in list.iter() {
            let (h, b) = resolve_cache_key(row, state_block_num);
            paths.push(get_cache_path(&app_handle, &h, chain_id, b, use_prestate));
        }
        dedup_cache_paths(paths)
    } else {
        let (h, b) = if let Some(ref td) = tx_data {
            resolve_cache_key(td, state_block_num)
        } else {
            (tx.to_string(), state_block_num)
        };
        vec![get_cache_path(&app_handle, &h, chain_id, b, use_prestate)]
    };

    let mut cache_loaded_any = false;
    if use_alloy_cache {
        println!("[cache] 准备加载 {} 个缓存路径", cache_paths.len());
        for p in &cache_paths {
            if let Some(loaded) = read_cache(p) {
                merge_cache_into(&mut cache_db, loaded, p);
                cache_loaded_any = true;
            }
        }
        if !cache_loaded_any {
            println!("[cache] ⚠️  无缓存文件，将从 RPC 拉取全部数据");
        }
    } else {
        println!("[cache] ❌ 用户禁用了 AlloyDB 缓存");
    }

    // 再用 prestate 覆盖（精确值优先级最高，必须在 cache 之后写入）
    if let Some(prestate) = prestate_data {
        let prestate_acct_count = prestate.len();
        apply_prestate(&mut cache_db, prestate);
        println!("[cache] 📌 prestate 已覆盖 {} 个账户的精确数据（优先级最高）", prestate_acct_count);
    }
    

    let env = Env::mainnet();

    let mut backend: OpTraceJournal<CacheDB<WrapDatabaseAsync<AlloyDB<alloy_provider::network::Ethereum, alloy_provider::DynProvider>>>> = OpTraceJournal::new(SpecId::default(), cache_db);
    backend.set_spec_id(SpecId::OSAKA);

    let to_log = match initial_tx.kind {
        TxKind::Create => "<Create>".to_string(),
        TxKind::Call(addr) => full_addr(&addr),
    };
    println!(
        "[env] from={}, to={}, value={}, gas_price={}, gas_limit={}, input_len={}, block={}",
        full_addr(&initial_tx.caller),
        to_log,
        initial_tx.value,
        initial_tx.gas_price,
        initial_tx.gas_limit,
        initial_tx.data.len(),
        exec_block_num
    );
    if is_multi {
        println!(
            "[env] multi_tx: {} sequential custom txs (shared CacheDB commits between txs)",
            tx_data_list.as_ref().map(|v| v.len()).unwrap_or(0)
        );
    }
    let context = Context {
        tx: initial_tx.clone(),
        block: evm_block,
        cfg: env.cfg,
        journaled_state: backend,
        chain: (),
        local: LocalContext::default(),
        error: Ok(()),
    };

    // send_finished 必须推迟到 session 存入全局状态之后（前端收到 Finished 后立即 seek_to）
    // inspector._set_verify_memory(true); // 开启内存验证
    let mut evm = Evm::new_with_inspector(
        context,
        &mut inspector,
        EthInstructions::new_mainnet_with_spec(SpecId::default()),
        EthPrecompiles::new(SpecId::default()),
    );
    println!("start inspect tx");
    let inspect_t0 = std::time::Instant::now();
    // 多笔时：第 2 笔起每笔在 trace 中的起始 global 下标（Finished 里 txBoundaries）
    let mut tx_boundary_starts: Vec<u32> = Vec::new();
    let results: anyhow::Result<Vec<ExecResultAndState<ExecutionResult<HaltReason>, EvmState>>> =
        if is_multi {
            let list = tx_data_list.as_ref().unwrap();
            let mut out: Vec<ExecResultAndState<ExecutionResult<HaltReason>, EvmState>> = Vec::with_capacity(list.len());
            for (i, custom_tx) in list.iter().enumerate() {
                let start_idx = session.lock().unwrap().trace.len() as u32;
                if i > 0 {
                    tx_boundary_starts.push(start_idx);
                }
                evm.inspector.reset_frame_stack_for_new_transaction();
                evm.inspector.set_transaction_id(i as u32);
                evm.ctx.journaled_state.set_transaction_id(i as u32);
                let tx_env = tx_env_from_debug(custom_tx)?;
                out.push(evm.inspect_tx(tx_env)?);
            }
            Ok(out)
        } else {
            Ok(vec![evm.inspect_tx(initial_tx)?])
        };
    let tx_finish_boundaries: Option<Vec<u32>> = if is_multi {
        Some(tx_boundary_starts)
    } else {
        None
    };
    let inspect_ms = inspect_t0.elapsed().as_secs_f64() * 1000.0;
    println!(
        "[perf.backend] {} done in {:.1}ms",
        if is_multi {
            "inspect_tx (multi + commit)"
        } else {
            "inspect_tx"
        },
        inspect_ms
    );
    // 允许读缓存，但 readonly 模式禁止落盘写缓存。
    // 统一保存策略：将当前 CacheDB 覆盖写回所有参与的缓存路径（多笔/单笔一致）。
    if use_alloy_cache && !readonly {
        for p in &cache_paths {
            save_cache(evm.ctx.journaled_state.db(), p);
            println!("[cache] ✓ saved {:?}", p);
        }
    }
    let balance_json = if let Ok(ref rs) = results {
        // 2A: ETH 变化从 Journal(transfer/balance_incr) 采集；Token 变化从每笔 logs(Transfer) 采集。
        let mut eth_by_tx = evm.ctx.journaled_state.take_eth_deltas_by_tx();
        #[derive(Serialize)]
        struct GroupOut {
            transaction_id: u32,
            changes: Vec<AddressBalanceOut>,
        }
        let mut groups: Vec<GroupOut> = Vec::with_capacity(rs.len());
        for (i, r) in rs.iter().enumerate() {
            let tid = i as u32;
            let token_wallet = token_changes_from_logs(r.result.logs());
            let eth_wallet = eth_by_tx.remove(&tid).unwrap_or_default();

            let mut addrs: Vec<Address> = eth_wallet.keys()
                .chain(token_wallet.keys())
                .cloned()
                .collect();
            addrs.sort_by_key(|a| full_addr(a));
            addrs.dedup();

            let mut changes: Vec<AddressBalanceOut> = Vec::new();
            for addr in addrs {
                let eth = eth_wallet.get(&addr).and_then(|(g, l)| fmt_signed_delta(*g, *l));
                let mut tokens: Vec<BalanceTokenChangeOut> = Vec::new();
                if let Some(tmap) = token_wallet.get(&addr) {
                    let mut token_addrs: Vec<Address> = tmap.keys().cloned().collect();
                    token_addrs.sort_by_key(|a| full_addr(a));
                    for token in token_addrs {
                        let (g, l) = tmap[&token];
                        if let Some(delta) = fmt_signed_delta(g, l) {
                            tokens.push(BalanceTokenChangeOut {
                                contract: full_addr(&token),
                                delta,
                            });
                        }
                    }
                }
                if eth.is_none() && tokens.is_empty() {
                    continue;
                }
                changes.push(AddressBalanceOut {
                    address: full_addr(&addr),
                    eth,
                    tokens,
                });
            }

            groups.push(GroupOut { transaction_id: tid, changes });
        }

        if groups.len() == 1 {
            serde_json::to_string(&groups[0].changes).unwrap_or_else(|_| "[]".to_string())
        } else {
            serde_json::to_string(&groups).unwrap_or_else(|_| "[]".to_string())
        }
    } else { "[]".to_string() };
    drop(evm); // 释放可变借用
    inspector.send_balance_changes(&balance_json);
    inspector.flush_steps();
    let shadow = inspector.take_shadow();
    let send_finished_fn: Box<dyn FnOnce()> =
        Box::new(move || inspector.send_finished(tx_finish_boundaries.as_deref()));

    // 将 DebugSession 存入全局状态，供 seek_to 使用（必须在 send_finished 之前，否则前端收到 Finished 后立即 seek_to 会找不到 session）
    {
        let mut finished_session = match Arc::try_unwrap(session) {
            Ok(mutex) => mutex.into_inner().unwrap(),
            Err(arc) => {
                let mut lock = arc.lock().unwrap();
                std::mem::replace(&mut *lock, debug_session::DebugSession::new())
            }
        };
        let trace_len = finished_session.trace.len();
        let frame_count = finished_session.frame_memories.len();
        let shadow_nodes = shadow.node_count();
        finished_session.shadow = Some(shadow);
        {
            let now_ms = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64;
            let mut guard = session_state.lock().unwrap();
            let entry = guard.entry(normalized_session_id.clone()).or_default();
            entry.session = Some(finished_session);
            entry.is_running = false;
            entry.updated_at_ms = now_ms;
        }
        println!(
            "[seek] session stored: id={} {} steps, {} frames, {} shadow nodes",
            normalized_session_id, trace_len, frame_count, shadow_nodes
        );
    }

    send_finished_fn();
    println!(
        "[perf.backend] op_trace total done in {:.1}ms",
        op_trace_t0.elapsed().as_secs_f64() * 1000.0
    );

    match results {
        Ok(rs) => {
            if rs.len() <= 1 {
                if let Some(r) = rs.first() {
                    println!("Execution Success: {:?}", r.result);
                } else {
                    println!("Execution Success: []");
                }
            } else {
                for (i, r) in rs.iter().enumerate() {
                    println!("[tx:{}] Execution Success: {:?}", i, r.result);
                }
            }
        }
        Err(e) => {
            println!("EVM Transaction Error: {:?}", e);
        }
    }
    println!("end inspect tx");

    Ok(())
}
