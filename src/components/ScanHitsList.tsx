import { useMemo, type HTMLAttributes } from "react";
import { useDebugStore } from "@/store/debugStore";
import { condTypeToMainSub, scanHitDetailOnly, type ScanHit } from "@/lib/pauseConditions";
import { VirtualHighlightList } from "@/components/VirtualHighlightList";
import { OrderedStepJumpControls } from "@/components/OrderedStepJumpControls";

export function ScanHitsList() {
  const scanHits = useDebugStore((s) => s.scanHits);
  const currentStepIndex = useDebugStore((s) => s.currentStepIndex);
  const seekToStep = useDebugStore((s) => s.seekToStep);

  return (
    <VirtualHighlightList<ScanHit>
      scrollContainerProps={
        { "data-keyboard-scroll-root": "condList" } as HTMLAttributes<HTMLDivElement>
      }
      items={scanHits}
      getItemKey={(h, i) => `${h.step_index}-${i}`}
      isRowActive={(h) => h.step_index === currentStepIndex}
      onRowClick={(h) => seekToStep?.(h.step_index)}
      getRowTitle={(h) => `${h.step_index} — ${h.description}`}
      empty={
        <p className="px-3 py-2 text-[11px] leading-snug text-muted-foreground">
          No hits — run Scan.
        </p>
      }
      renderRow={({ item: h }) => (
        <>
          <div className="scrollbar-hidden flex max-w-[min(15rem,46%)] shrink-0 flex-nowrap items-center gap-x-1 overflow-x-auto text-[9px] font-mono leading-none">
            {(h.cond_types ?? []).map((ct, bi) => {
              const { main, sub } = condTypeToMainSub(ct);
              return (
                <span
                  key={`${ct}-${bi}`}
                  className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap"
                >
                  {bi > 0 ? (
                    <span className="text-muted-foreground/45" aria-hidden>
                      ·
                    </span>
                  ) : null}
                  <span className="text-muted-foreground">{main}</span>
                  {sub ? (
                    <>
                      <span
                        className="h-1 w-1 shrink-0 rounded-full bg-sky-500/85 dark:bg-sky-400/80"
                        aria-hidden
                      />
                      <span className="text-foreground/90">{sub}</span>
                    </>
                  ) : null}
                </span>
              );
            })}
          </div>
          <span className="shrink-0 text-sky-600 dark:text-sky-400">#{h.step_index}</span>
          <span className="shrink-0 text-muted-foreground"> · </span>
          <span className="min-w-0 flex-1 truncate text-foreground">
            {scanHitDetailOnly(h.description, h.cond_types)}
          </span>
        </>
      )}
    />
  );
}

/** 浮动标题栏里的命中跳转控制 */
export function ScanHitsJumpControls() {
  const scanHits = useDebugStore((s) => s.scanHits);
  const currentStepIndex = useDebugStore((s) => s.currentStepIndex);
  const seekToStep = useDebugStore((s) => s.seekToStep);

  const orderedSteps = useMemo(
    () => [...scanHits].map((h) => h.step_index).sort((a, b) => a - b),
    [scanHits],
  );

  return (
    <OrderedStepJumpControls
      orderedSteps={orderedSteps}
      currentStepIndex={currentStepIndex}
      onJump={(step) => seekToStep?.(step)}
    />
  );
}
