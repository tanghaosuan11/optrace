import { useEffect, useMemo, useRef, useState } from "react";
import { executeCommand } from "@/lib/commands";
import { getCommandPaletteItems } from "@/lib/commandPalette";
import { useDebugStore } from "@/store/debugStore";
import { toast } from "sonner";
import { frameTabId } from "@/lib/frameScope";
import {
  CommandDialog,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";

export function CommandPaletteDialog() {
  const isOpen = useDebugStore((s) => s.isCommandPaletteOpen);
  const stepCount = useDebugStore((s) => s.stepCount);
  const commandPalettePrefill = useDebugStore((s) => s.commandPalettePrefill);
  const sync = useDebugStore((s) => s.sync);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const items = useMemo(() => getCommandPaletteItems(), [isOpen]);
  const colonMode = query.trimStart().startsWith(":");
  const filtered = useMemo(() => {
    if (colonMode) return [];
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((x) => x.keywords.includes(q));
  }, [items, query, colonMode]);

  const handleSelect = (commandId: string) => {
    const picked = filtered.find((x) => x.commandId === commandId);
    if (!picked || !picked.enabled) return;
    executeCommand(picked.commandId);
    sync({ isCommandPaletteOpen: false, isHintMode: false });
    setQuery("");
  };

  const tryJumpFromColonQuery = (): boolean => {
    const mFrame = /^:\s*f\s*(\d+)\s*$/i.exec(query);
    if (mFrame) {
      const frameNo = Number(mFrame[1]);
      if (!Number.isFinite(frameNo) || frameNo <= 0) return true;
      const s = useDebugStore.getState();
      const frames = s.callFrames;
      if (frames.length === 0) {
        toast.info("No frames available");
        return true;
      }
      const targetIdx = Math.max(0, Math.min(frameNo - 1, frames.length - 1));
      const frame = frames[targetIdx];
      const tx = frame.transactionId ?? 0;
      const tabId = frameTabId(tx, frame.contextId);
      const nextHidden = new Set(s.hiddenFrameIds);
      nextHidden.delete(tabId);
      s.sync({
        activeTab: tabId,
        hiddenFrameIds: nextHidden,
        isCommandPaletteOpen: false,
        isHintMode: false,
      });
      setQuery("");
      const frameNodes = s.callTreeNodes
        .filter(
          (n) =>
            n.type === "frame" &&
            (n.transactionId ?? 0) === tx &&
            n.contextId === frame.contextId,
        )
        .sort((a, b) => a.stepIndex - b.stepIndex);
      if (frameNodes[0] && s.seekToStep) s.seekToStep(frameNodes[0].stepIndex);
      return true;
    }

    const mStep = /^:\s*(\d+)\s*$/.exec(query);
    if (!mStep) {
      if (colonMode) {
        toast.error("Use ':N' to jump to step N, or ':f N' to jump to frame N");
        return true;
      }
      return false;
    }
    const stepInput = Number(mStep[1]);
    if (!Number.isFinite(stepInput)) return true;
    if (stepCount <= 0) {
      toast.info("No trace loaded");
      return true;
    }
    const max = stepCount - 1;
    // 输入按可见 step 编号（1-based）处理，内部 seek 需要 0-based index
    const desired = Math.max(0, stepInput - 1);
    const target = Math.max(0, Math.min(desired, max));
    const seek = useDebugStore.getState().seekToStep;
    if (!seek) {
      toast.error("Seek is not ready");
      return true;
    }
    seek(target);
    if (target !== desired) {
      toast.info(`Step clamped to ${target + 1}`);
    }
    sync({ isCommandPaletteOpen: false, isHintMode: false });
    setQuery("");
    return true;
  };

  useEffect(() => {
    if (!isOpen) return;
    if (!commandPalettePrefill) return;
    setQuery(commandPalettePrefill);
    sync({ commandPalettePrefill: "" });
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      const end = commandPalettePrefill.length;
      el.focus();
      el.setSelectionRange(end, end);
    });
  }, [isOpen, commandPalettePrefill, sync]);

  return (
    <CommandDialog
      open={isOpen}
      onOpenChange={(o) => {
        sync({ isCommandPaletteOpen: o, isHintMode: false });
        if (!o) setQuery("");
      }}
    >
      <CommandInput
        ref={inputRef}
        value={query}
        onValueChange={setQuery}
        placeholder="Type a command..."
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          if (!tryJumpFromColonQuery()) return;
          e.preventDefault();
        }}
      />
      <CommandList>
        {!colonMode ? (
          <CommandEmpty className="py-4 text-[11px] text-muted-foreground">
            No matching command.
          </CommandEmpty>
        ) : null}
        {filtered.map((item) => (
          <CommandItem
            key={item.commandId}
            value={item.commandId}
            onSelect={handleSelect}
            disabled={!item.enabled}
          >
            <div className="flex min-w-0 flex-1 items-center gap-1.5">
              <span className="truncate">{item.title}</span>
            </div>
            {item.shortcut ? <CommandShortcut>{item.shortcut}</CommandShortcut> : null}
          </CommandItem>
        ))}
      </CommandList>
    </CommandDialog>
  );
}

