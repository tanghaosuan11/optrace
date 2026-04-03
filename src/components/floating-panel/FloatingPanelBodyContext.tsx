import { createContext, useContext } from "react";

/** 浮动面板缩放层 DOM，供 Radix Portal container 使用 */
export const FloatingPanelBodyContext = createContext<HTMLElement | null>(null);

export function useFloatingPanelBodyRoot(): HTMLElement | null {
  return useContext(FloatingPanelBodyContext);
}
