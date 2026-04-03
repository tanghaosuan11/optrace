import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { FloatingPanelFrame } from "./FloatingPanelFrame";

export type { FloatingPanelRect } from "./floatingPanelStorage";

export type ShowFloatingPanelOptions = {
  title: string;
  children: ReactNode;
  /** 标题与关闭按钮之间的区域（如跳转工具栏）；点击不触发拖动 */
  headerTrailing?: ReactNode;
};

type FloatingPanelContextValue = {
  /** 打开或替换为新的单例内容（覆盖之前） */
  showPanel: (opts: ShowFloatingPanelOptions) => void;
  closePanel: () => void;
  open: boolean;
};

const FloatingPanelContext = createContext<FloatingPanelContextValue | null>(null);

export function useFloatingPanel(): FloatingPanelContextValue {
  const v = useContext(FloatingPanelContext);
  if (!v) {
    throw new Error("useFloatingPanel must be used within FloatingPanelProvider");
  }
  return v;
}

export function FloatingPanelProvider({ children }: { children: ReactNode }) {
  const [slot, setSlot] = useState<null | {
    title: string;
    node: ReactNode;
    headerTrailing?: ReactNode;
  }>(null);

  const showPanel = useCallback((opts: ShowFloatingPanelOptions) => {
    setSlot({
      title: opts.title,
      node: opts.children,
      headerTrailing: opts.headerTrailing,
    });
  }, []);

  const closePanel = useCallback(() => {
    setSlot(null);
  }, []);

  const value = useMemo(
    () => ({
      showPanel,
      closePanel,
      open: slot !== null,
    }),
    [showPanel, closePanel, slot],
  );

  return (
    <FloatingPanelContext.Provider value={value}>
      {children}
      {typeof document !== "undefined" &&
        createPortal(
          slot ? (
            <FloatingPanelFrame
              title={slot.title}
              headerTrailing={slot.headerTrailing}
              onClose={closePanel}
            >
              {slot.node}
            </FloatingPanelFrame>
          ) : null,
          document.body,
        )}
    </FloatingPanelContext.Provider>
  );
}
