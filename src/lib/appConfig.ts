/** 应用配置（持久化到 Tauri Store） */
import { storeGet, storeSet } from "./tauriStore";

export interface FrontendConfig {
  /** 调试 UI */
  isDebug: boolean;
  /** 浏览器链接前缀 */
  scanUrl: string;
  /** PauseOp 时自动跳转 */
  pauseOpJump: boolean;
}

export interface BackendConfig {
  /** AlloyDB 磁盘缓存 */
  useAlloyCache: boolean;
  /** RPC 节点 URL */
  rpcUrl: string;
  /** prestateTracer 预填状态 */
  usePrestate: boolean;
  /** Fork 模式 */
  forkMode: boolean;
  /** Shadow 数据流追踪 */
  enableShadow: boolean;
  /** Hardfork override: "auto" | SpecId name */
  hardfork: string;
}

export type AppConfig = FrontendConfig & BackendConfig;

export const DEFAULT_CONFIG: AppConfig = {
  isDebug: false,
  useAlloyCache: true,
  usePrestate: false,
  forkMode: false,
  enableShadow: false,
  hardfork: "auto",
  pauseOpJump: true,
  rpcUrl: "https://mainnet.infura.io/v3/c60b0bb42f8a4c6481ecd229eddaca27",
  scanUrl: "https://etherscan.io/",
};

const STORE_KEY = "app.config";
let _config: AppConfig = { ...DEFAULT_CONFIG };
let _inited = false;

/** 启动时加载配置 */
export async function initAppConfig(): Promise<void> {
  if (_inited) return;
  const saved = await storeGet<Partial<AppConfig>>(STORE_KEY);
  if (saved) {
    // 兼容旧配置缺字段
    _config = { ...DEFAULT_CONFIG, ...saved };
  }
  // 兼容旧版 isDebug
  const legacyDebug = await storeGet<boolean>("app.isDebug");
  if (legacyDebug != null && !saved) {
    _config.isDebug = legacyDebug;
  }
  // 兼容旧版 rpcUrl
  if (!saved?.rpcUrl) {
    const legacyRpc = await storeGet<string>("selected_rpc_url");
    if (legacyRpc) _config.rpcUrl = legacyRpc;
  }
  _inited = true;
}

/** 当前配置快照 */
export function loadAppConfig(): { config: AppConfig } {
  return { config: { ..._config } };
}

/** 更新配置并写回 Store */
export function setConfig(patch: Partial<AppConfig>): AppConfig {
  Object.assign(_config, patch);
  storeSet(STORE_KEY, _config);
  return { ..._config };
}

/** 后端需要的配置子集 */
export function getBackendConfig(): BackendConfig {
  return {
    useAlloyCache: _config.useAlloyCache,
    rpcUrl: _config.rpcUrl,
    usePrestate: _config.usePrestate,
    forkMode: _config.forkMode,
    enableShadow: _config.enableShadow,
    hardfork: _config.hardfork,
  };
}
