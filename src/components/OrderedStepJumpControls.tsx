import { useMemo, type MouseEvent } from "react";
import { ArrowUpToLine, ChevronDown, ChevronUp } from "lucide-react";

export type OrderedStepJumpControlsProps = {
  /** 升序步号列表 */
  orderedSteps: readonly number[];
  currentStepIndex: number;
  onJump: (step: number) => void;
  /** 是否阻止鼠标按下事件冒泡 */
  stopMouseDownPropagation?: boolean;
};

const BTN =
  "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-30";

export function OrderedStepJumpControls({
  orderedSteps,
  currentStepIndex,
  onJump,
  stopMouseDownPropagation = true,
}: OrderedStepJumpControlsProps) {
  const { firstStep, prevStep, nextStep } = useMemo(() => {
    if (orderedSteps.length === 0) {
      return {
        firstStep: null as number | null,
        prevStep: null as number | null,
        nextStep: null as number | null,
      };
    }
    const cur = currentStepIndex;
    let prev: number | null = null;
    let next: number | null = null;
    for (const s of orderedSteps) {
      if (s < cur) prev = s;
      else if (s > cur) {
        next = s;
        break;
      }
    }
    return {
      firstStep: orderedSteps[0]!,
      prevStep: prev,
      nextStep: next,
    };
  }, [orderedSteps, currentStepIndex]);

  const go = (step: number | null) => {
    if (step == null) return;
    onJump(step);
  };

  const onMouseDown = (e: MouseEvent) => {
    if (stopMouseDownPropagation) e.stopPropagation();
  };

  return (
    <span className="flex items-center gap-0.5" onMouseDown={onMouseDown}>
      <button
        type="button"
        className={BTN}
        disabled={firstStep == null}
        title="Jump to first"
        aria-label="Jump to first"
        onClick={() => go(firstStep)}
      >
        <ArrowUpToLine className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        className={BTN}
        disabled={prevStep == null}
        title="Previous"
        aria-label="Previous"
        onClick={() => go(prevStep)}
      >
        <ChevronUp className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        className={BTN}
        disabled={nextStep == null}
        title="Next"
        aria-label="Next"
        onClick={() => go(nextStep)}
      >
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
    </span>
  );
}
