/**
 * Hint 模式（类 Vimium 的键盘点击）
 *
 * 按 f 进入：扫描页面可点击元素，生成字母标签。
 * 输入标签字母缩窄选择，唯一匹配时自动点击并退出。
 * Esc 随时退出。
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useDebugStore } from "@/store/debugStore";

// 可点击元素的 CSS 选择器
// svg[aria-label] 覆盖 Lucide 图标和 inline SVG（凡带 aria-label 的可点击图标都走这里）
// input:not([type=hidden]) 包括 text/password/email/checkbox/radio 等（原生 form 控件）
// textarea 文本域
// [data-hint] 供任意元素显式 opt-in：加 data-hint 属性即可被 hint 模式识别
const HINT_SELECTOR = [
  "button:not([disabled]):not([aria-hidden])",
  "a[href]",
  "[role='button']:not([disabled])",
  "[role='tab']",
  "[role='checkbox']",
  "[role='switch']",
  "[tabindex='0']:not([disabled])",
  "input:not([type=hidden]):not([disabled])",
  "textarea:not([disabled])",
  "svg[aria-label]:not([aria-hidden])",
  "[data-hint]",
].join(",");

// 标签优先顺序：靠近左手的键
const LABEL_CHARS = "asdfghjklqwertyuiopzxcvbnm";

function generateLabels(count: number): string[] {
  // 单字母够用时直接返回
  if (count <= LABEL_CHARS.length) {
    return LABEL_CHARS.slice(0, count).split("");
  }
  // 超出时补双字母
  const labels: string[] = [];
  for (const a of LABEL_CHARS) {
    for (const b of LABEL_CHARS) {
      labels.push(a + b);
      if (labels.length >= count) return labels;
    }
  }
  return labels;
}

interface HintItem {
  label: string;
  el: HTMLElement;
  rect: DOMRect;
}

/** 焦点在可编辑区域时 hint 应让路，避免 capture 里误伤 Tab/Enter 等 */
function isEditableTarget(el: HTMLElement | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") {
    const t = ((el as HTMLInputElement).type || "text").toLowerCase();
    const nonText = new Set(["button", "checkbox", "color", "file", "hidden", "image", "radio", "reset", "submit"]);
    return !nonText.has(t);
  }
  if (el.isContentEditable) return true;
  if (el.closest?.(".monaco-editor")) return true;
  return false;
}

export function HintOverlay() {
  const isHintMode = useDebugStore((s) => s.isHintMode);
  const [hints, setHints] = useState<HintItem[]>([]);
  const [typed, setTyped] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  // 用 ref 给事件处理器持有最新值，避免 effect 随每次按键重新注册
  // （deps 里有 typed/hints 时，每次按键都会 removeListener → addEventListener，
  //  两次调用之间存在窗口期，第二个字符可能落空）
  const hintsRef = useRef<HintItem[]>([]);
  const typedRef = useRef("");

  // 进入 hint 模式时扫描 DOM
  useEffect(() => {
    if (!isHintMode) {
      hintsRef.current = [];
      typedRef.current = "";
      setHints([]);
      setTyped("");
      return;
    }

    const elements = Array.from(
      document.querySelectorAll<HTMLElement>(HINT_SELECTOR),
    ).filter((el) => {
      // 过滤不可见元素
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.top < window.innerHeight && r.left < window.innerWidth;
    });

    const labels = generateLabels(elements.length);
    const items = elements.map((el, i) => ({
      label: labels[i],
      el,
      rect: el.getBoundingClientRect(),
    }));
    hintsRef.current = items;
    setHints(items);
  }, [isHintMode]);

  // 鼠标点进输入框等时立即退出 hint，避免仍处 hint 时所有键被拦截
  useEffect(() => {
    const onFocusIn = (e: FocusEvent) => {
      if (!useDebugStore.getState().isHintMode) return;
      const t = e.target;
      if (t instanceof HTMLElement && isEditableTarget(t)) {
        useDebugStore.getState().sync({ isHintMode: false });
      }
    };
    document.addEventListener("focusin", onFocusIn, true);
    return () => document.removeEventListener("focusin", onFocusIn, true);
  }, []);

  // 键盘 capture：仅对真正消费的键 preventDefault，避免挡住 Tab/方向键/Enter 等
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!useDebugStore.getState().isHintMode) return;

      const rawTarget = e.target instanceof HTMLElement ? e.target : null;
      if (rawTarget && isEditableTarget(rawTarget)) {
        useDebugStore.getState().sync({ isHintMode: false });
        return;
      }

      const stopHint = () => {
        e.preventDefault();
        e.stopPropagation();
      };

      if (e.key === "Escape") {
        stopHint();
        useDebugStore.getState().sync({ isHintMode: false });
        return;
      }

      if (e.key === "Backspace") {
        stopHint();
        const prev = typedRef.current.slice(0, -1);
        typedRef.current = prev;
        setTyped(prev);
        return;
      }

      // 只消费单字母；其它键（Tab、Enter、方向键等）不拦截
      if (e.key.length !== 1 || !/[a-z]/i.test(e.key)) return;

      stopHint();
      const next = typedRef.current + e.key.toLowerCase();

      const matched = hintsRef.current.filter((h) => h.label.startsWith(next));
      if (matched.length === 0) {
        typedRef.current = "";
        setTyped("");
        return;
      }
      if (matched.length === 1) {
        const target = matched[0].el;
        const tagName = target.tagName.toLowerCase();
        const inputType = (target as HTMLInputElement).type?.toLowerCase() || "";

        if ((tagName === "input" && ["text", "password", "search", "email", "url", "number"].includes(inputType)) ||
            tagName === "textarea") {
          target.focus();
          typedRef.current = "";
          Promise.resolve().then(() => {
            useDebugStore.getState().sync({ isHintMode: false });
          });
          return;
        }

        target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
        target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
        typedRef.current = "";
        useDebugStore.getState().sync({ isHintMode: false });
        return;
      }
      typedRef.current = next;
      setTyped(next);
    };

    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  if (!isHintMode) return null;

  const visibleHints = hints.filter((h) => h.label.startsWith(typed));

  return createPortal(
    <div ref={containerRef} style={{ pointerEvents: "none", position: "fixed", inset: 0, zIndex: 9999 }}>
      {visibleHints.map((h) => (
        <span
          key={h.label}
          style={{
            position: "fixed",
            left: h.rect.left + window.scrollX,
            top: h.rect.top + window.scrollY,
            background: "#fbbf24",
            color: "#000",
            fontSize: 10,
            fontFamily: "monospace",
            fontWeight: 700,
            lineHeight: "12px",
            padding: "0 1px",
            borderRadius: 2,
            opacity: 0.93,
            border: "1px solid #92400e",
            // 已输入部分变暗以提示进度
          }}
        >
          <span style={{ opacity: 0.4 }}>{typed}</span>
          {h.label.slice(typed.length)}
        </span>
      ))}
    </div>,
    document.body,
  );
}
