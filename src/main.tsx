import React from "react";
import ReactDOM from "react-dom/client";
import { isTauri } from "@tauri-apps/api/core";
import App from "./App";
import "./index.css";

declare global {
  interface Window {
    /** 允许系统默认右键菜单（用于调试/开发）。由 App 在加载 config 后更新。 */
    __OPTRACE_ENABLE_CONTEXT_MENU__?: boolean;
  }
}

// dev 下默认启用（便于 Inspect/Reload），production 由 App 按 config.isDebug 决定
window.__OPTRACE_ENABLE_CONTEXT_MENU__ = Boolean(import.meta.env.DEV);

/** Tauri WebView 默认右键菜单含 Reload 等；仅在壳内按配置关闭，并保留 Monaco 与 Radix 自定义菜单（先于 window 冒泡处理） */
if (isTauri()) {
  window.addEventListener("contextmenu", (e) => {
    if (window.__OPTRACE_ENABLE_CONTEXT_MENU__) return;
    const t = e.target;
    if (t instanceof Element && t.closest(".monaco-editor")) return;
    e.preventDefault();
  });
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
