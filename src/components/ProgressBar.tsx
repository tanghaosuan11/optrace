import { useState, useRef, useEffect, useCallback } from "react";
import { Slider } from "@/components/ui/slider";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useDebugStore } from "@/store/debugStore";
import { Scissors } from "lucide-react";

interface ProgressBarProps {
  onSeekTo: (index: number) => void;
  onSpeedChange: (speed: number) => void;
}

// Speed mapping: slider position 0 → 1x, positions 1-20 → 5,10,...,100x
const sliderToSpeed = (v: number) => v === 0 ? 1 : v * 5;
const speedToSlider = (s: number) => s <= 1 ? 0 : Math.round(s / 5);

const THROTTLE_MS = 150;

export function ProgressBar({
  onSeekTo,
  onSpeedChange
}: ProgressBarProps) {
  const currentStepIndex = useDebugStore((s) => s.currentStepIndex);
  const stepCount = useDebugStore((s) => s.stepCount);
  const playbackSpeed = useDebugStore((s) => s.playbackSpeed);
  const isPlaying = useDebugStore((s) => s.isPlaying);
  const rangeEnabled = useDebugStore((s) => s.rangeEnabled);
  const rangeStart = useDebugStore((s) => s.rangeStart);
  const rangeEnd = useDebugStore((s) => s.rangeEnd);
  const [jumpFocused, setJumpFocused] = useState(false);
  const [jumpInput, setJumpInput] = useState("");

  // 拖动中的本地值（滑块拇指即时跟随手指，不等 IPC 返回）
  const [draggingValue, setDraggingValue] = useState<number | null>(null);
  const pendingValueRef = useRef<number | null>(null);
  const throttleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // commit 后等待 store 确认再清除 draggingValue，避免 IPC 期间闪回旧位置
  const awaitingCommitRef = useRef(false);

  // range popover 本地 input 状态
  const [rangeStartInput, setRangeStartInput] = useState("");
  const [rangeEndInput, setRangeEndInput] = useState("");
  const [popoverOpen, setPopoverOpen] = useState(false);
  // 记录当前正在拖动的 thumb index（0=rangeStart, 1=currentStep, 2=rangeEnd）
  const activeThumbRef = useRef<number | null>(null);

  // 组件卸载时清理 timer
  useEffect(() => {
    return () => {
      if (throttleTimerRef.current) clearTimeout(throttleTimerRef.current);
    };
  }, []);

  // store 的 currentStepIndex 更新后（IPC 返回），清除 draggingValue
  useEffect(() => {
    if (awaitingCommitRef.current) {
      awaitingCommitRef.current = false;
      setDraggingValue(null);
    }
  }, [currentStepIndex]);

  // popover 打开时同步 store 值到 input
  useEffect(() => {
    if (popoverOpen) {
      setRangeStartInput(String(rangeStart + 1));
      setRangeEndInput(String(rangeEnd + 1));
    }
  }, [popoverOpen, rangeStart, rangeEnd]);

  // stepCount 变化时重置 range 到全部范围
  useEffect(() => {
    if (stepCount > 0) {
      useDebugStore.getState().sync({ rangeStart: 0, rangeEnd: stepCount - 1 });
    }
  }, [stepCount]);

  // 滑块值显示：拖动中用本地值，松开后用 store 值
  const displayValue = draggingValue ?? currentStepIndex;

  const handleSliderChange = ([v]: number[]) => {
    setDraggingValue(v);
    pendingValueRef.current = v;
    if (!throttleTimerRef.current) {
      throttleTimerRef.current = setTimeout(() => {
        throttleTimerRef.current = null;
        if (pendingValueRef.current !== null) {
          onSeekTo(pendingValueRef.current);
        }
      }, THROTTLE_MS);
    }
  };

  const handleSliderCommit = ([v]: number[]) => {
    if (throttleTimerRef.current) {
      clearTimeout(throttleTimerRef.current);
      throttleTimerRef.current = null;
    }
    pendingValueRef.current = null;
    awaitingCommitRef.current = true;
    onSeekTo(v);
  };

  const handleJump = () => {
    const val = parseInt(jumpInput, 10);
    if (!isNaN(val) && val >= 1 && val <= stepCount) {
      onSeekTo(val - 1);
    }
    setJumpFocused(false);
    setJumpInput("");
  };

  // 范围滑块变化（三值：[rangeStart, currentStep, rangeEnd]）
  // 只响应 activeThumbRef 指定的那个 thumb，避免 Radix 排序推挤导致其他 thumb 误动
  const handleRangeSliderChange = useCallback((values: number[]) => {
    const activeIdx = activeThumbRef.current;
    if (activeIdx === null) return;
    const maxIdx = stepCount - 1;

    if (activeIdx === 0) {
      // 拖动 rangeStart：只更新 rangeStart，不 seek
      const newRs = Math.max(0, Math.min(values[0], maxIdx));
      useDebugStore.getState().sync({ rangeStart: newRs });
    } else if (activeIdx === 1) {
      // 拖动 currentStep：只 seek，不改范围
      const cur = values[1];
      setDraggingValue(cur);
      pendingValueRef.current = cur;
      if (!throttleTimerRef.current) {
        throttleTimerRef.current = setTimeout(() => {
          throttleTimerRef.current = null;
          if (pendingValueRef.current !== null) onSeekTo(pendingValueRef.current);
        }, THROTTLE_MS);
      }
    } else if (activeIdx === 2) {
      // 拖动 rangeEnd：只更新 rangeEnd，不 seek
      const newRe = Math.max(0, Math.min(values[2], maxIdx));
      useDebugStore.getState().sync({ rangeEnd: newRe });
    }
  }, [stepCount, onSeekTo]);

  const handleRangeSliderCommit = useCallback((values: number[]) => {
    const activeIdx = activeThumbRef.current;
    activeThumbRef.current = null;
    const maxIdx = stepCount - 1;
    if (activeIdx === 0) {
      useDebugStore.getState().sync({ rangeStart: Math.max(0, Math.min(values[0], maxIdx)) });
    } else if (activeIdx === 1) {
      if (throttleTimerRef.current) { clearTimeout(throttleTimerRef.current); throttleTimerRef.current = null; }
      pendingValueRef.current = null;
      awaitingCommitRef.current = true;
      onSeekTo(values[1]);
    } else if (activeIdx === 2) {
      useDebugStore.getState().sync({ rangeEnd: Math.max(0, Math.min(values[2], maxIdx)) });
    }
  }, [stepCount, onSeekTo]);

  // 提交 popover input
  const commitRangeInput = useCallback(() => {
    const maxIdx = stepCount - 1;
    let s = parseInt(rangeStartInput, 10) - 1;
    let e = parseInt(rangeEndInput, 10) - 1;
    if (isNaN(s)) s = 0;
    if (isNaN(e)) e = maxIdx;
    s = Math.max(0, Math.min(s, maxIdx));
    e = Math.max(0, Math.min(e, maxIdx));
    if (e - s < 1) { e = Math.min(s + 1, maxIdx); s = e - 1; }
    useDebugStore.getState().sync({ rangeStart: s, rangeEnd: e });
    setRangeStartInput(String(s + 1));
    setRangeEndInput(String(e + 1));
  }, [stepCount, rangeStartInput, rangeEndInput]);

  const maxIdx = Math.max(0, stepCount - 1);

  return (
    <div className="flex-shrink-0 flex items-center gap-2 px-2 py-1 border-b bg-muted/30">
      {/* Range checkbox + popover icon */}
      <div className="flex items-center gap-0.5 shrink-0">
        <input
          type="checkbox"
          checked={rangeEnabled}
          onChange={(ev) => useDebugStore.getState().sync({ rangeEnabled: ev.target.checked })}
          className="h-3 w-3 rounded border cursor-pointer accent-primary"
          title="Enable range playback"
        />
        <Popover open={popoverOpen} onOpenChange={rangeEnabled ? setPopoverOpen : undefined}>
          <PopoverTrigger asChild>
            <Scissors
              className={`h-3 w-3 transition-colors ${rangeEnabled ? "text-primary cursor-pointer hover:text-primary/70" : "text-muted-foreground/30 cursor-not-allowed pointer-events-none"}`}
            />
          </PopoverTrigger>
          <PopoverContent className="w-56 p-3 space-y-2" side="bottom" align="start">
            <p className="text-[11px] font-medium text-muted-foreground">Playback Range (1-based)</p>
            <div className="flex items-center gap-1.5">
              <label className="text-[10px] text-muted-foreground w-8">Start</label>
              <input
                type="number"
                min={1}
                max={stepCount}
                value={rangeStartInput}
                onChange={(e) => setRangeStartInput(e.target.value)}
                onBlur={commitRangeInput}
                onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                className="flex-1 h-6 px-1.5 text-[11px] font-mono rounded border border-input bg-background text-center focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <label className="text-[10px] text-muted-foreground w-8">End</label>
              <input
                type="number"
                min={1}
                max={stepCount}
                value={rangeEndInput}
                onChange={(e) => setRangeEndInput(e.target.value)}
                onBlur={commitRangeInput}
                onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                className="flex-1 h-6 px-1.5 text-[11px] font-mono rounded border border-input bg-background text-center focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {/* Slider: normal or range mode */}
      {rangeEnabled ? (
        <Slider
          className="flex-1 min-w-[80px] [&_[data-index='0']]:h-2.5 [&_[data-index='0']]:w-2.5 [&_[data-index='0']]:border-orange-400 [&_[data-index='2']]:h-2.5 [&_[data-index='2']]:w-2.5 [&_[data-index='2']]:border-orange-400 [&_[data-index='1']]:z-10"
          min={0}
          max={maxIdx}
          step={1}
          minStepsBetweenThumbs={0}
          value={[rangeStart, displayValue, rangeEnd]}
          onValueChange={handleRangeSliderChange}
          onValueCommit={handleRangeSliderCommit}
          onThumbPointerDown={(i) => { activeThumbRef.current = i; }}
        />
      ) : (
        <Slider
          className="flex-1 min-w-[80px]"
          min={0}
          max={maxIdx}
          step={1}
          value={[displayValue]}
          onValueChange={handleSliderChange}
          onValueCommit={handleSliderCommit}
          disabled={isPlaying}
        />
      )}

      <span className="text-[11px] text-muted-foreground font-mono shrink-0">{stepCount}</span>
      <input
        type="number"
        min="1"
        max={stepCount}
        value={jumpFocused ? jumpInput : displayValue + 1}
        onChange={(e) => setJumpInput(e.target.value)}
        onFocus={() => { setJumpFocused(true); setJumpInput(String(currentStepIndex + 1)); }}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        onBlur={() => handleJump()}
        disabled={isPlaying}
        className="w-20 h-5 py-0 px-1 leading-none text-[10px] font-mono rounded border border-input bg-background text-center focus:outline-none focus:ring-0 focus:shadow-none shadow-none disabled:opacity-50 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      <div className="w-px h-4 bg-border mx-1" />
      <span className="text-[11px] text-muted-foreground shrink-0">Speed:</span>
      <Slider
        className="w-20"
        min={0}
        max={20}
        step={1}
        value={[speedToSlider(playbackSpeed)]}
        onValueChange={([v]) => onSpeedChange(sliderToSpeed(v))}
        title={`${playbackSpeed}x speed`}
      />
      <span className="text-[11px] text-muted-foreground w-6 shrink-0">{playbackSpeed}x</span>
    </div>
  );
}
